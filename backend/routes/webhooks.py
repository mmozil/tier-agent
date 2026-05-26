"""Webhooks inbound — Tier WhatsApp Engine, Telegram, etc.

Cada webhook valida assinatura/secret, faz idempotency via TaWebhookEvent,
encaminha pra agent_runtime via hermes_proxy.
"""

import hashlib
import hmac
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db
from models import (
    TaConnector,
    TaPlaybook,
    TaPlaybookTriggerIndex,
    TaWebhookEvent,
)
from services import playbook_executor

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_tier_signature(body: bytes, signature: str | None) -> bool:
    if not settings.tier_whatsapp_webhook_secret or not signature:
        return False
    expected = hmac.new(
        settings.tier_whatsapp_webhook_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    sig_clean = signature.replace("sha256=", "")
    return hmac.compare_digest(expected, sig_clean)


async def _record_idempotent(
    db: AsyncSession, source: str, event_id: str, payload: dict
) -> bool:
    """Retorna True se evento já foi processado (skip)."""
    existing = await db.execute(
        select(TaWebhookEvent).where(
            TaWebhookEvent.source == source, TaWebhookEvent.event_id == event_id
        )
    )
    if existing.scalar_one_or_none():
        return True
    db.add(TaWebhookEvent(source=source, event_id=event_id, payload_json=payload))
    await db.commit()
    return False


@router.post("/whatsapp-engine")
async def whatsapp_engine_webhook(
    request: Request,
    x_tier_signature: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Recebe eventos do Tier WhatsApp Engine.

    Payload esperado (de tier-whatsapp-engine/src/services/webhook-dispatcher.ts):
    { instanceId, tenantId, event, payload, ts }
    """
    body = await request.body()
    if not _verify_tier_signature(body, x_tier_signature):
        raise HTTPException(401, "Assinatura inválida")

    data = await request.json()
    event_id = data.get("id") or f"{data.get('instanceId')}-{data.get('ts')}-{data.get('event')}"

    if await _record_idempotent(db, "whatsapp-engine", event_id, data):
        return {"status": "duplicate", "skipped": True}

    instance_id = data.get("instanceId")
    event = data.get("event")
    payload = data.get("payload", {})

    # Só processa eventos de mensagem text (image/audio próxima fase)
    if event not in {"message.text", "message"}:
        logger.debug("ignorando event %s", event)
        return {"status": "ignored", "event": event}

    from services import agent_runtime

    text_content = payload.get("text") or payload.get("body") or ""
    external_chat_id = payload.get("from") or payload.get("chat_id") or ""
    sender_name = payload.get("sender_name") or payload.get("pushName")

    if not text_content or not external_chat_id:
        return {"status": "missing_fields", "event": event}

    result = await agent_runtime.handle_inbound_message(
        db,
        connector_kind="whatsapp",
        instance_id=instance_id,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
        text_content=text_content,
    )
    logger.info("webhook WhatsApp processed: %s", result)
    return result


# ============================================================
# Trigger event — webhook externo dispara playbooks com trigger_event
# ============================================================
@router.post("/event/{event_key}")
async def trigger_event_webhook(
    event_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Dispara TODOS playbooks publicados com trigger_event matching event_key.

    Sem autenticação por padrão (URL secret-ish via event_key).
    Body JSON inteiro vira `vars.event` no execution.

    Exemplos:
        POST /webhooks/event/pedido_criado {"pedido_id": 123, "valor_cents": 19900}
        POST /webhooks/event/pagamento_aprovado {"order_id": "abc"}

    Resposta:
        {triggered: N, executions: [{playbook_id, execution_id, status}, ...]}
    """
    try:
        body_json = await request.json()
    except Exception:
        body_json = {}

    if not isinstance(body_json, dict):
        body_json = {"raw": body_json}

    # Idempotency opcional via header X-Event-Id (se cliente fornecer)
    event_id = request.headers.get("X-Event-Id") or str(uuid.uuid4())
    duplicate = await _record_idempotent(
        db, source=f"event:{event_key}", event_id=event_id, payload=body_json
    )
    if duplicate:
        return {"status": "duplicate", "event_id": event_id, "triggered": 0}

    # Busca triggers ativos pra este event_key
    rows = (
        await db.execute(
            select(TaPlaybookTriggerIndex, TaPlaybook)
            .join(TaPlaybook, TaPlaybook.id == TaPlaybookTriggerIndex.playbook_id)
            .where(
                TaPlaybookTriggerIndex.trigger_type == "trigger_event",
                TaPlaybookTriggerIndex.enabled.is_(True),
                TaPlaybook.status == "published",
            )
        )
    ).all()

    matches = []
    for idx, pb in rows:
        data = idx.trigger_data or {}
        if (data.get("event_key") or "") != event_key:
            continue
        matches.append((idx, pb))

    if not matches:
        return {"status": "no_match", "event_key": event_key, "triggered": 0}

    executions = []
    for idx, pb in matches:
        try:
            result = await playbook_executor.run_playbook(
                db,
                playbook_id=pb.id,
                trigger_node_id=idx.node_id,
                trigger_type="trigger_event",
                agent_id=pb.agent_id,
                conversation_id=None,
                inbound_text=None,
                inbound_sender=None,
                connector_kind=None,
                external_chat_id=None,
                initial_vars={"event": body_json, "event_key": event_key},
            )
            executions.append(
                {
                    "playbook_id": pb.id,
                    "execution_id": result.get("execution_id"),
                    "status": result.get("status"),
                    "steps_executed": result.get("steps_executed"),
                }
            )
        except Exception as e:
            logger.exception("trigger_event execução falhou pb=%s", pb.id)
            executions.append({"playbook_id": pb.id, "error": str(e)})

    return {
        "status": "ok",
        "event_key": event_key,
        "event_id": event_id,
        "triggered": len(executions),
        "executions": executions,
    }

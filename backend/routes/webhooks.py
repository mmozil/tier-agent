"""Webhooks inbound — Tier WhatsApp Engine, Telegram, etc.

Cada webhook valida assinatura/secret, faz idempotency via TaWebhookEvent,
encaminha pra agent_runtime via hermes_proxy.
"""

import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db
from models import TaConnector, TaWebhookEvent

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

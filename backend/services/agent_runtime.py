"""Agent runtime — orquestra recepção de mensagem → Hermes → envio de volta no canal.

Fluxo:
1. Webhook channel chega
2. resolve_agent_from_connector identifica o agente
3. ensure_conversation cria/atualiza TaConversation
4. hermes_proxy.send_message → Hermes responde
5. connectors.registry.send → envia resposta de volta no canal
6. log usage em TaMessageLog + TaUsageDaily
"""

import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaUsageDaily
from services import hermes_proxy, playbook_executor, playbook_router
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)

# Filtro de segurança: remove caracteres CJK (chinês/japonês/coreano) que o
# MiniMax ocasionalmente vaza em respostas em português. 2ª camada sobre a regra
# de idioma da persona — garante que o cliente nunca veja caractere oriental.
import re as _re

_CJK_RE = _re.compile(
    r"[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿"
    r"豈-﫿＀-￯가-힯]"
)


def _sanitize_reply(text: str | None) -> str:
    """Remove caracteres CJK vazados e limpa espaços/pontuação resultantes."""
    if not text:
        return text or ""
    if not _CJK_RE.search(text):
        return text
    cleaned = _CJK_RE.sub("", text)
    cleaned = _re.sub(r"[ \t]{2,}", " ", cleaned)  # espaços duplos
    cleaned = _re.sub(r"\s+([.,!?;:])", r"\1", cleaned)  # espaço antes de pontuação
    logger.warning("resposta tinha CJK vazado — caracteres removidos antes do envio")
    return cleaned.strip()


async def resolve_connector_by_instance(
    db: AsyncSession, kind: str, instance_id: str
) -> TaConnector | None:
    """Procura TaConnector cujo config_json_enc contenha instance_id (heurística por canal)."""
    result = await db.execute(
        select(TaConnector).where(TaConnector.kind == kind, TaConnector.enabled.is_(True))
    )
    for conn in result.scalars().all():
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:
            continue
        # WhatsApp: match instance_id direto
        if kind == "whatsapp" and cfg.get("instance_id") == instance_id:
            return conn
        # WhatsApp Cloud API (oficial): instance_id = phone_number_id
        if kind == "whatsapp_cloud" and str(cfg.get("phone_number_id") or "") == instance_id:
            return conn
        # Telegram: instance_id = bot_id (extraído do bot_token "1234567:ABCdef...")
        if kind == "telegram":
            token = cfg.get("bot_token") or ""
            bot_id = token.split(":")[0] if ":" in token else ""
            if bot_id and bot_id == instance_id:
                return conn
        # Email: instance_id = connector.id direto (webhook usa /email/{connector_id})
        if kind == "email":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Instagram: instance_id = ig_user_id (instagram business account id)
        if kind == "instagram":
            if str(cfg.get("ig_user_id") or "") == instance_id:
                return conn
        # Default fallback (compat)
        if cfg.get("instance_id") == instance_id:
            return conn
    return None


async def ensure_conversation(
    db: AsyncSession,
    agent_id: int,
    connector_kind: str,
    external_id: str,
    contact_name: str | None = None,
) -> TaConversation:
    result = await db.execute(
        select(TaConversation).where(
            TaConversation.agent_id == agent_id,
            TaConversation.connector_kind == connector_kind,
            TaConversation.external_id == external_id,
            TaConversation.status == "active",
        )
    )
    conv = result.scalar_one_or_none()
    if conv:
        conv.last_message_at = datetime.utcnow()
        conv.msg_count += 1
        await db.commit()
        return conv

    conv = TaConversation(
        agent_id=agent_id,
        connector_kind=connector_kind,
        external_id=external_id,
        contact_name=contact_name,
        msg_count=1,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


async def log_message(
    db: AsyncSession,
    *,
    conversation_id: int,
    tenant_id: int,
    role: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: int = 0,
    latency_ms: int = 0,
    model_used: str | None = None,
    content: str | None = None,
) -> None:
    log = TaMessageLog(
        conversation_id=conversation_id,
        role=role,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_cents=cost_cents,
        latency_ms=latency_ms,
        model_used=model_used,
        content=(content or "")[:8000] or None,
    )
    db.add(log)

    # Atualiza usage daily (upsert)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    result = await db.execute(
        select(TaUsageDaily).where(TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day == today)
    )
    usage = result.scalar_one_or_none()
    if usage:
        usage.messages += 1
        usage.tokens_in += tokens_in
        usage.tokens_out += tokens_out
        usage.cost_cents += cost_cents
    else:
        db.add(
            TaUsageDaily(
                tenant_id=tenant_id,
                day=today,
                messages=1,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_cents=cost_cents,
            )
        )
    await db.commit()


async def handle_inbound_message(
    db: AsyncSession,
    *,
    connector_kind: str,
    instance_id: str,
    external_chat_id: str,
    sender_name: str | None,
    text_content: str,
    attachments: list | None = None,
) -> dict:
    """Pipeline completo: webhook → Hermes → resposta no canal."""
    connector = await resolve_connector_by_instance(db, connector_kind, instance_id)
    if not connector:
        return {"status": "no_connector", "instance_id": instance_id}

    agent = await db.get(TaAgent, connector.agent_id)
    if not agent or not agent.active:
        return {"status": "agent_inactive", "agent_id": connector.agent_id}

    # Q2.4 Budget guard — bloqueia tenant suspenso
    try:
        from services import budget_guard

        budget_state = await budget_guard.check_and_enforce(db, agent.tenant_id)
        if budget_state.get("status") == "paused":
            logger.warning(
                "budget guard: tenant=%s pausado (uso %.0f%%)",
                agent.tenant_id, (budget_state.get("pct") or 0) * 100,
            )
            return {"status": "tenant_suspended", "agent_id": agent.id, **budget_state}
    except Exception:
        logger.exception("budget_guard falhou — continua processando")

    # Q3.1 Guardrails Lakera — bloqueia prompt injection / jailbreak
    # Q2.6 Azure Content Safety — bloqueia hate/violence/sexual/self-harm
    try:
        from services import content_moderation, guardrails

        blocked_by: list[str] = []
        blocked_categories: list[str] = []

        if await guardrails.is_enabled_for_tenant(db, agent.tenant_id):
            gr = await guardrails.check_lakera(text_content)
            if not gr.ok:
                blocked_by.append("lakera")
                blocked_categories.extend(gr.blocked_categories)

        if not blocked_by and await content_moderation.is_enabled_for_tenant(db, agent.tenant_id):
            mr = await content_moderation.check_text(text_content)
            if not mr.ok:
                blocked_by.append("azure_content_safety")
                blocked_categories.extend(mr.blocked_categories)

        if blocked_by:
            logger.warning(
                "moderation BLOCKED agent=%s contact=%s by=%s categories=%s",
                agent.id, external_chat_id, blocked_by, blocked_categories,
            )
            safe_reply = (
                "Desculpe, não posso processar essa mensagem. Se for dúvida legítima, "
                "reformule por favor ou peça pra falar com um humano."
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=safe_reply)
                )
            except Exception:
                logger.exception("envio safe_reply moderation falhou")
            return {
                "status": "blocked_moderation",
                "agent_id": agent.id,
                "blocked_by": blocked_by,
                "categories": blocked_categories,
            }
    except Exception:
        logger.exception("moderation check falhou — continua processando")

    conv = await ensure_conversation(
        db,
        agent_id=agent.id,
        connector_kind=connector_kind,
        external_id=external_chat_id,
        contact_name=sender_name,
    )

    # Log mensagem do user
    await log_message(
        db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="user", tokens_in=0,
        content=text_content,
    )

    # ─── Handoff para humano ───
    # Se o cliente pede explicitamente um atendente, avisa a equipe (notificação)
    # e responde com confirmação — sem acionar o LLM (curto-circuito).
    try:
        from services import handoff

        if handoff.wants_human(text_content):
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg,
                    OutboundMessage(external_chat_id=external_chat_id, content=handoff.HANDOFF_REPLY),
                )
            except Exception:
                logger.exception("envio handoff reply falhou agent=%s", agent.id)
            await log_message(
                db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="assistant",
                content=handoff.HANDOFF_REPLY,
            )
            return {"status": "handoff", "agent_id": agent.id, "conversation_id": conv.id}
    except Exception:
        logger.exception("handoff check falhou agent=%s — segue fluxo normal", agent.id)

    # ─── Playbook router (Sprint 1) ───
    # Intercepta antes do Hermes. Se nenhuma trigger matchou, cai pro fluxo padrão.
    try:
        match = await playbook_router.match_inbound_message(
            db, agent_id=agent.id, text=text_content
        )
    except Exception:
        logger.exception("playbook_router falhou agent=%s — fallback pro Hermes", agent.id)
        match = None

    if match:
        logger.info(
            "agent_runtime: matched playbook_id=%s trigger=%s agent=%s",
            match.playbook_id, match.trigger_type, agent.id,
        )
        try:
            result = await playbook_executor.run_playbook(
                db,
                playbook_id=match.playbook_id,
                trigger_node_id=match.trigger_node_id,
                trigger_type=match.trigger_type,
                agent_id=agent.id,
                conversation_id=conv.id,
                inbound_text=text_content,
                inbound_sender=sender_name,
                connector_kind=connector_kind,
                external_chat_id=external_chat_id,
            )
            return {
                "status": "ok",
                "via": "playbook",
                "playbook_id": match.playbook_id,
                "agent_id": agent.id,
                "conversation_id": conv.id,
                **result,
            }
        except Exception as e:
            logger.exception(
                "playbook_executor falhou playbook=%s agent=%s — fallback pro Hermes",
                match.playbook_id, agent.id,
            )
            # cai pro Hermes free como fallback

    # Memory cross-session: busca fatos relevantes do contato + injeta no system
    from services import memory_service

    memory_block = ""
    try:
        mem_hits = await memory_service.search(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            external_chat_id=external_chat_id,
            query=text_content,
            top_k=5,
        )
        if mem_hits:
            memory_block = memory_service.format_for_prompt(mem_hits)
    except Exception:
        logger.exception("memory.search falhou agent=%s — segue sem memory", agent.id)

    system_prompt = agent.persona or agent.system_prompt or ""
    if memory_block:
        system_prompt = f"{system_prompt}\n\n{memory_block}".strip()

    # Hermes responde (com vision se attachment image presente)
    try:
        reply = await hermes_proxy.send_message(
            tenant_id=agent.tenant_id,
            user_content=text_content,
            db=db,
            session_id=f"conv-{conv.id}",
            system_override=system_prompt,
            attachments=attachments or [],
            agent_id=agent.id,
            use_cache=not memory_block,  # cache desliga quando há memory custom no system
        )
    except Exception as e:
        logger.exception("Hermes falhou tenant=%s agent=%s", agent.tenant_id, agent.id)
        return {"status": "hermes_error", "error": str(e)}

    # Calcula custo real via TaLlmProvider lookup
    from services import cost_calculator

    cost_cents = await cost_calculator.calculate_cost_cents(
        db,
        agent.tenant_id,
        model_used=reply.model_used,
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
    )

    # Log resposta do assistant
    await log_message(
        db,
        conversation_id=conv.id,
        tenant_id=agent.tenant_id,
        role="assistant",
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
        cost_cents=cost_cents,
        latency_ms=reply.latency_ms,
        model_used=reply.model_used,
        content=reply.text,
    )

    # Envia resposta de volta no canal
    try:
        connector_impl = registry.get(connector_kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
        await connector_impl.send(
            cfg,
            OutboundMessage(external_chat_id=external_chat_id, content=_sanitize_reply(reply.text)),
        )
    except Exception as e:
        logger.exception("Falha enviando resposta agent=%s channel=%s", agent.id, connector_kind)
        return {"status": "send_error", "agent_id": agent.id, "error": str(e)}

    # Captura de lead — se o cliente demonstrou intenção de compra ou informou
    # telefone, registra um lead pra equipe (não perder oportunidades). Não bloqueia.
    try:
        from services import lead_capture

        await lead_capture.maybe_capture_lead(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            external_chat_id=external_chat_id,
            sender_name=sender_name,
            user_text=text_content,
        )
    except Exception:
        logger.exception("lead_capture falhou agent=%s — ignorando", agent.id)

    # Memory.add em background (sessão isolada — não bloqueia resposta)
    try:
        import asyncio

        from core.db import db_context

        async def _async_add_memory():
            try:
                async with db_context() as mdb:
                    await memory_service.add(
                        mdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        user_text=text_content,
                        assistant_text=reply.text,
                        contact_name=sender_name,
                    )
                # Q2.6 Style adapter — primeiras 3 mensagens classifica tom + salva como preference
                from services import style_adapter

                async with db_context() as sdb:
                    await style_adapter.maybe_extract_style(
                        sdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        text=text_content,
                        msg_count=conv.msg_count,
                    )
            except Exception:
                logger.exception("memory.add background falhou")

        asyncio.create_task(_async_add_memory())
    except Exception:
        logger.exception("agendar memory.add falhou")

    # Langfuse trace (fire-and-forget) — observability cliente
    try:
        from services import langfuse_client

        await langfuse_client.trace_event(
            name="agent_message",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            input={"text": text_content[:500], "attachments": len(attachments or [])},
            output={"text": (reply.text or "")[:500]},
            metadata={
                "channel": connector_kind,
                "external_chat_id": external_chat_id,
                "tokens_in": reply.tokens_in,
                "tokens_out": reply.tokens_out,
                "model": reply.model_used,
                "memory_used": bool(memory_block),
            },
            latency_ms=reply.latency_ms,
        )
    except Exception:
        pass

    return {
        "status": "ok",
        "agent_id": agent.id,
        "conversation_id": conv.id,
        "tokens_in": reply.tokens_in,
        "tokens_out": reply.tokens_out,
        "latency_ms": reply.latency_ms,
        "memory_used": bool(memory_block),
    }

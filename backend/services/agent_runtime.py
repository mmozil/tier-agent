"""Agent runtime — orquestra recepção de mensagem → Engine → envio de volta no canal.

Fluxo:
1. Webhook channel chega
2. resolve_agent_from_connector identifica o agente
3. ensure_conversation cria/atualiza TaConversation
4. tier_engine.send_message → Engine responde
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
from services import tier_engine, playbook_executor, playbook_router
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


def _split_into_bubbles(text: str, max_len: int = 700) -> list[str]:
    """Divide resposta longa em até 4 balões (mais humano no WhatsApp).

    Quebra em parágrafos (\\n\\n), mantém listas/blocos inteiros, agrupa blocos
    pequenos. Resposta curta → 1 balão (sem split)."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    bubbles: list[str] = []
    cur = ""
    for b in blocks:
        if len(b) > max_len:  # bloco grande (ex: lista de planos) → balão próprio
            if cur:
                bubbles.append(cur)
                cur = ""
            bubbles.append(b)
            continue
        if cur and len(cur) + 2 + len(b) > max_len:
            bubbles.append(cur)
            cur = b
        else:
            cur = (cur + "\n\n" + b) if cur else b
    if cur:
        bubbles.append(cur)
    return bubbles[:4]


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
        if conv.snoozed_until is not None:
            conv.snoozed_until = None  # cliente voltou — tira do snooze
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
    """Pipeline completo: webhook → Engine → resposta no canal."""
    connector = await resolve_connector_by_instance(db, connector_kind, instance_id)
    if not connector:
        return {"status": "no_connector", "instance_id": instance_id}

    agent = await db.get(TaAgent, connector.agent_id)
    if not agent or not agent.active:
        return {"status": "agent_inactive", "agent_id": connector.agent_id}

    # ─── Comandos de ops (DevSecOps) — resposta determinística, sem LLM ───
    # Agente marcado como template_kind="devsecops" responde status/health/ping
    # com a saúde REAL do stack (sem alucinar). Conversa normal segue o fluxo.
    if agent.template_kind == "devsecops":
        try:
            from services import ops_commands

            if ops_commands.is_ops_command(text_content):
                reply = await ops_commands.handle_ops_command(db, agent, text_content)
                if reply:
                    try:
                        connector_impl = registry.get(connector_kind)
                        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                        await connector_impl.send(
                            cfg, OutboundMessage(external_chat_id=external_chat_id, content=reply)
                        )
                    except Exception:
                        logger.exception("envio ops command falhou agent=%s", agent.id)
                    return {"status": "ops_command", "agent_id": agent.id}
        except Exception:
            logger.exception("ops_command falhou agent=%s — segue fluxo normal", agent.id)

    # ─── CSAT: resposta de avaliação (0-5) a uma conversa resolvida ───
    # Captura ANTES de ensure_conversation pra não abrir conversa nova.
    try:
        from services import csat

        thanks = await csat.maybe_capture_csat(
            db, agent_id=agent.id, external_chat_id=external_chat_id, text=text_content
        )
        if thanks:
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=thanks)
                )
            except Exception:
                logger.exception("envio csat thanks falhou agent=%s", agent.id)
            return {"status": "csat_captured", "agent_id": agent.id}
    except Exception:
        logger.exception("csat capture falhou agent=%s — segue fluxo normal", agent.id)

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

    # ─── Conversa já assumida por humano? Bot fica em silêncio ───
    # Quando alguém da equipe assumiu (status handed_off), o bot NÃO responde mais
    # automaticamente — só registra a mensagem do cliente (visível na inbox) pra o
    # humano conduzir. "Devolver para a IA" (resume) volta o status pra active.
    if conv.status == "handed_off":
        logger.info("conv=%s handed_off — bot em silêncio (humano no controle)", conv.id)
        return {"status": "handed_off_paused", "agent_id": agent.id, "conversation_id": conv.id}

    _phone_for_summary = _re.sub(r"\D", "", (external_chat_id or "").split("@")[0])

    # ─── Handoff explícito + escalonamento por frustração ───
    # Pedido explícito de humano → handoff + PAUSA o bot + confirma ao cliente.
    # Frustração detectada → ALERTA o time (warm handoff), mas o bot CONTINUA
    # tentando ajudar (ref: Fin tenta resolver antes; sentimento não pausa sozinho).
    try:
        from services import escalation, handoff

        if handoff.wants_human(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_EXPLICIT,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_EXPLICIT,
                summary=summary,
                pause=True,
            )
            # Fora do expediente → mensagem de fora-de-horário no lugar da padrão
            from services import business_hours

            try:
                aberto = await business_hours.is_open(db, agent.tenant_id)
            except Exception:
                aberto = True
            handoff_reply = (
                handoff.HANDOFF_REPLY
                if aberto
                else await business_hours.offhours_message(db, agent.tenant_id)
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg,
                    OutboundMessage(external_chat_id=external_chat_id, content=handoff_reply),
                )
            except Exception:
                logger.exception("envio handoff reply falhou agent=%s", agent.id)
            await log_message(
                db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="assistant",
                content=handoff_reply,
            )
            return {"status": "handoff", "agent_id": agent.id, "conversation_id": conv.id}

        if escalation.is_frustrated(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_FRUSTRATION,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            # pause=False: alerta o time, mas o bot segue respondendo abaixo.
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_FRUSTRATION,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("handoff/escalation check falhou agent=%s — segue fluxo normal", agent.id)

    # ─── Playbook router (Sprint 1) ───
    # Intercepta antes do Engine. Se nenhuma trigger matchou, cai pro fluxo padrão.
    try:
        match = await playbook_router.match_inbound_message(
            db, agent_id=agent.id, text=text_content
        )
    except Exception:
        logger.exception("playbook_router falhou agent=%s — fallback pro Engine", agent.id)
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
                "playbook_executor falhou playbook=%s agent=%s — fallback pro Engine",
                match.playbook_id, agent.id,
            )
            # cai pro Engine free como fallback

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

    # Contexto do contato — o agente JÁ tem nome + telefone pelo canal (WhatsApp).
    # Evita pedir ao cliente dados que já temos (irrita + cada atendente re-pergunta).
    _is_wa = connector_kind in ("whatsapp", "whatsapp_cloud")
    _phone = _re.sub(r"\D", "", (external_chat_id or "").split("@")[0]) if _is_wa else ""
    _contact = ["# Contato atual (você JÁ tem estes dados — NÃO peça ao cliente)"]
    _contact.append(f"- Nome: {sender_name or '(não informado pelo WhatsApp)'}")
    if _phone:
        _contact.append(f"- Telefone/WhatsApp: {_phone}")
    _contact.append(
        "Use esses dados diretamente. Ao agendar uma demonstração ou encaminhar a "
        "um consultor, NUNCA peça nome nem telefone (você já tem) — apenas confirme "
        "o contato e pergunte só o que falta, como o nome da empresa."
    )
    system_prompt = f"{system_prompt}\n\n" + "\n".join(_contact)

    # Engine responde (com vision se attachment image presente)
    try:
        reply = await tier_engine.send_message(
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
        logger.exception("Engine falhou tenant=%s agent=%s", agent.tenant_id, agent.id)
        return {"status": "engine_error", "error": str(e)}

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
        _clean = _sanitize_reply(reply.text)
        _bubbles = _split_into_bubbles(_clean)
        if len(_bubbles) <= 1:
            await connector_impl.send(
                cfg, OutboundMessage(external_chat_id=external_chat_id, content=_clean)
            )
        else:
            import asyncio as _asyncio

            for _i, _b in enumerate(_bubbles):
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=_b)
                )
                if _i < len(_bubbles) - 1:
                    await _asyncio.sleep(1.2)  # pausa natural entre balões
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

    # Loop sem resolução — bot respondeu "não sei" repetidas vezes. Alerta o time
    # (warm handoff) sem pausar o bot. Dedup evita spam (1 não-lida por conversa).
    try:
        from services import escalation, handoff

        if await escalation.detect_loop(db, conv.id, reply.text):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_LOOP,
                contact_name=sender_name,
                phone=_re.sub(r"\D", "", (external_chat_id or "").split("@")[0]),
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_LOOP,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("loop detection falhou agent=%s — ignorando", agent.id)

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

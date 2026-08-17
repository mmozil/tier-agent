"""APScheduler — jobs periódicos do Tier Agent.

Jobs:
- resume_waiting_playbooks (a cada 30s): retoma TaPlaybookExecution status='waiting'
  com resume_at <= NOW (saídas do nó wait)
- fire_cron_triggers (a cada minuto): consulta TaPlaybookTriggerIndex tipo
  trigger_cron, avalia cron_expr e dispara playbooks que casam

Stack: AsyncIOScheduler dentro do event loop do FastAPI.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import or_, select

from core.db import db_context
from models import (
    TaAgent,
    TaConversation,
    TaMessageLog,
    TaNotification,
    TaPlaybook,
    TaPlaybookExecution,
    TaPlaybookTriggerIndex,
    TaRuntimeParam,
)
from services import playbook_executor

logger = logging.getLogger("tier-agent.scheduler")


def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def resume_waiting_playbooks_job() -> None:
    """Retoma execuções pausadas — chama playbook_executor.resume_playbook
    pra cada execution com status='waiting' e resume_at <= NOW.

    Resume parte de execution.next_node_id (salvo no pause do nó wait).
    """
    try:
        async with db_context() as db:
            now = _now_utc_naive()
            rows = (
                await db.execute(
                    select(TaPlaybookExecution.id)
                    .where(
                        TaPlaybookExecution.status == "waiting",
                        TaPlaybookExecution.resume_at.is_not(None),
                        TaPlaybookExecution.resume_at <= now,
                    )
                    .limit(50)
                )
            ).scalars().all()

        if not rows:
            return

        logger.info("resume_waiting: %s execuções pra retomar", len(rows))
        for exec_id in rows:
            # Cada resume em sessão separada pra isolar transações
            try:
                async with db_context() as db:
                    result = await playbook_executor.resume_playbook(db, exec_id)
                    logger.info(
                        "resume_waiting: execution=%s → %s steps=%s",
                        exec_id, result.get("status"), result.get("steps_executed"),
                    )
            except Exception:
                logger.exception("resume execution=%s falhou", exec_id)
    except Exception:
        logger.exception("resume_waiting_playbooks_job falhou")


async def fire_cron_triggers_job() -> None:
    """Avalia trigger_cron via croniter e dispara playbooks que matchearam na janela [now-65s, now].

    Tolerância 65s pra cobrir interval=60s (não dispara 2x mesmo cron porque guarda
    `last_fired_at` em trigger_data e só dispara se cron expr deu match APÓS last_fired_at).
    """
    try:
        from croniter import croniter
    except ImportError:
        logger.warning("croniter não instalado — fire_cron skip")
        return

    try:
        async with db_context() as db:
            rows = (
                await db.execute(
                    select(TaPlaybookTriggerIndex, TaPlaybook)
                    .join(TaPlaybook, TaPlaybook.id == TaPlaybookTriggerIndex.playbook_id)
                    .where(
                        TaPlaybookTriggerIndex.trigger_type == "trigger_cron",
                        TaPlaybookTriggerIndex.enabled.is_(True),
                        TaPlaybook.status == "published",
                    )
                )
            ).all()
    except Exception:
        logger.exception("fire_cron query falhou")
        return

    if not rows:
        return

    now_utc = datetime.now(timezone.utc)
    fired = 0
    for idx, pb in rows:
        data = idx.trigger_data or {}
        cron_expr = (data.get("cron_expr") or "").strip()
        if not cron_expr:
            continue

        # last_fired_at pra evitar double-fire
        last_fired_str = data.get("last_fired_at")
        try:
            last_fired = (
                datetime.fromisoformat(last_fired_str.replace("Z", "+00:00"))
                if last_fired_str
                else now_utc.replace(year=now_utc.year - 1)
            )
        except Exception:
            last_fired = now_utc.replace(year=now_utc.year - 1)

        # Próximo trigger DEPOIS de last_fired
        try:
            it = croniter(cron_expr, last_fired)
            next_fire = it.get_next(datetime)
            if next_fire.tzinfo is None:
                next_fire = next_fire.replace(tzinfo=timezone.utc)
        except Exception as e:
            logger.warning("cron expr inválida playbook=%s expr=%s: %s", pb.id, cron_expr, e)
            continue

        # Se próximo trigger está NO PASSADO (ou agora), dispara
        if next_fire <= now_utc:
            try:
                async with db_context() as db:
                    result = await playbook_executor.run_playbook(
                        db,
                        playbook_id=pb.id,
                        trigger_node_id=idx.node_id,
                        trigger_type="trigger_cron",
                        agent_id=pb.agent_id,
                        conversation_id=None,
                        inbound_text=None,
                        inbound_sender=None,
                        connector_kind=None,
                        external_chat_id=None,
                        initial_vars={"cron_fired_at": now_utc.isoformat()},
                    )
                    fired += 1
                    logger.info(
                        "cron fired playbook=%s exec=%s",
                        pb.id, result.get("execution_id"),
                    )
                    # Atualiza last_fired_at em trigger_data
                    data["last_fired_at"] = now_utc.isoformat()
                    import json as _json

                    await db.execute(
                        sql_text_update_trigger(),
                        {"data": _json.dumps(data), "id": idx.id},
                    )
                    await db.commit()
            except Exception:
                logger.exception("cron fire falhou playbook=%s", pb.id)

    if fired:
        logger.info("fire_cron: %s playbooks disparados", fired)


def sql_text_update_trigger():
    """Helper pra UPDATE JSONB em trigger_data."""
    from sqlalchemy import text as sql_text

    return sql_text(
        "UPDATE ta_playbook_trigger_index SET trigger_data = CAST(:data AS jsonb) WHERE id = :id"
    )


# Singleton scheduler
_scheduler: AsyncIOScheduler | None = None


async def sla_watch_job() -> None:
    """Alerta quando um cliente está esperando resposta humana há mais que o SLA.

    Mira conversas `handed_off` (humano assumiu) cuja última mensagem é do cliente
    e está parada há > `sla_minutes` (param por tenant; 0/ausente = desligado).
    Cria TaNotification(category='sla') + alerta externo, 1x por espera
    (anti-spam via `sla_alerted_at`)."""
    try:
        from services import team_alert

        async with db_context() as db:
            now = _now_utc_naive()
            convs = (
                await db.execute(
                    select(TaConversation)
                    .where(TaConversation.status == "handed_off")
                    .limit(300)
                )
            ).scalars().all()
            if not convs:
                return

            agent_ids = {c.agent_id for c in convs}
            agent_rows = (
                await db.execute(
                    select(TaAgent.id, TaAgent.tenant_id).where(TaAgent.id.in_(agent_ids))
                )
            ).all()
            agent_tenant = {aid: tid for aid, tid in agent_rows}

            tenant_ids = set(agent_tenant.values())
            sla_rows = (
                await db.execute(
                    select(TaRuntimeParam.escopo_id, TaRuntimeParam.value).where(
                        TaRuntimeParam.escopo == "tenant",
                        TaRuntimeParam.escopo_id.in_(tenant_ids),
                        TaRuntimeParam.key == "sla_minutes",
                    )
                )
            ).all()
            sla_by_tenant: dict[int, int] = {}
            for tid, val in sla_rows:
                try:
                    sla_by_tenant[tid] = int(val)
                except (TypeError, ValueError):
                    sla_by_tenant[tid] = 0

            alerted = 0
            for c in convs:
                tenant_id = agent_tenant.get(c.agent_id)
                mins = sla_by_tenant.get(tenant_id, 0) if tenant_id else 0
                if not mins or not c.last_message_at:
                    continue
                waited_min = (now - c.last_message_at).total_seconds() / 60.0
                if waited_min < mins:
                    continue
                # já alertou esta espera? (sla_alerted_at >= última msg)
                if c.sla_alerted_at and c.sla_alerted_at >= c.last_message_at:
                    continue
                # última mensagem é do cliente? (senão não está esperando)
                last_role = (
                    await db.execute(
                        select(TaMessageLog.role)
                        .where(TaMessageLog.conversation_id == c.id)
                        .order_by(TaMessageLog.id.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if last_role != "user":
                    continue

                nome = c.contact_name or "Cliente"
                titulo = f"Cliente esperando há {int(waited_min)} min: {nome}"
                db.add(
                    TaNotification(
                        tenant_id=tenant_id,
                        agent_id=c.agent_id,
                        conversation_id=c.id,
                        category="sla",
                        queue="atendimento",
                        title=titulo,
                        body=f"Sem resposta há {int(waited_min)} min (SLA {mins} min).",
                        payload_json={"reason": "sla", "waited_min": int(waited_min), "contato": nome},
                        status="unread",
                    )
                )
                c.sla_alerted_at = now
                await db.commit()
                try:
                    await team_alert.dispatch_team_alert(
                        db, tenant_id=tenant_id, agent_id=c.agent_id,
                        category="sla", title=titulo,
                        summary=f"⏰ Sem resposta há {int(waited_min)} min (SLA {mins} min).",
                    )
                except Exception:
                    logger.exception("team_alert SLA falhou conv=%s", c.id)
                alerted += 1

            if alerted:
                logger.info("sla_watch: %s alertas de SLA disparados", alerted)
    except Exception:
        logger.exception("sla_watch_job falhou")


async def mirror_pet_conversations_job() -> None:
    """Espelha as conversas de WhatsApp dos agentes conectados ao Hovio Pet de volta
    pro Pet, pra o petshop ver o atendimento da IA no próprio painel ('Conversas').

    Push periódico (NÃO toca o hot-path de mensagem). Janela de 20min; o Pet deduplica
    por (conversa, criadaEm), então reenvio é inofensivo. Best-effort: falha só loga."""
    try:
        import httpx

        from core.encryption import decrypt
        from models import TaToolProvider
        from services import oauth_connect

        wa_kinds = ("whatsapp", "whatsapp_cloud")
        async with db_context() as db:
            providers = (
                await db.execute(
                    select(TaToolProvider).where(
                        TaToolProvider.enabled.is_(True),
                        TaToolProvider.mcp_server_url.like("%pet.hovio.com.br%"),
                    )
                )
            ).scalars().all()
            if not providers:
                return

            now = _now_utc_naive()
            since = now - timedelta(minutes=20)

            for provider in providers:
                try:
                    await oauth_connect.ensure_fresh_token(db, provider)
                    if not provider.bearer_enc:
                        continue
                    token = decrypt(provider.bearer_enc)
                    base = provider.mcp_server_url.split("/api/mcp")[0]
                    url = f"{base}/api/agent/mirror"
                    agente = await db.get(TaAgent, provider.agent_id)
                    agente_nome = (agente.nome if agente else None) or "Assistente"
                    agente_foto = (getattr(agente, "avatar_url", None) if agente else None) or None

                    convs = (
                        await db.execute(
                            select(TaConversation)
                            .where(
                                TaConversation.agent_id == provider.agent_id,
                                TaConversation.connector_kind.in_(wa_kinds),
                                TaConversation.last_message_at.isnot(None),
                                TaConversation.last_message_at > since,
                            )
                            .limit(100)
                        )
                    ).scalars().all()
                    if not convs:
                        continue

                    payload_msgs: list[dict] = []
                    for c in convs:
                        tel = re.sub(r"\D", "", (c.external_id or "").split("@")[0])
                        if not tel:
                            continue
                        rows = (
                            await db.execute(
                                select(TaMessageLog)
                                .where(
                                    TaMessageLog.conversation_id == c.id,
                                    TaMessageLog.created_at > since,
                                    TaMessageLog.role.in_(("user", "assistant", "agent")),
                                    TaMessageLog.content.isnot(None),
                                )
                                .order_by(TaMessageLog.id.asc())
                                .limit(80)
                            )
                        ).scalars().all()
                        for m in rows:
                            payload_msgs.append(
                                {
                                    "telefone": tel,
                                    "nome": c.contact_name,
                                    "papel": "user" if m.role == "user" else "assistant",
                                    "conteudo": m.content,
                                    "criadaEm": m.created_at.isoformat() + "Z",
                                }
                            )
                    if not payload_msgs:
                        continue

                    async with httpx.AsyncClient(timeout=20) as cli:
                        r = await cli.post(
                            url,
                            headers={"Authorization": f"Bearer {token}"},
                            json={
                                "messages": payload_msgs,
                                "agente_nome": agente_nome,
                                "agente_foto_url": agente_foto,
                            },
                        )
                    if r.status_code >= 400:
                        logger.warning(
                            "mirror_pet: push %s falhou %s: %s", url, r.status_code, r.text[:200]
                        )
                    else:
                        logger.info(
                            "mirror_pet: provider=%s convs=%s msgs=%s ok",
                            provider.id, len(convs), len(payload_msgs),
                        )
                except Exception:
                    logger.exception("mirror_pet: provider=%s falhou", provider.id)
    except Exception:
        logger.exception("mirror_pet_conversations_job falhou")


async def _send_proactive(db, conv: TaConversation, text_content: str) -> bool:
    """Envia uma mensagem proativa (follow-up) pro contato da conversa, via connector."""
    import json

    from core.encryption import decrypt
    from models import TaConnector
    from services.connectors.base import ConnectorConfig, OutboundMessage
    from services.connectors.registry import registry as connectors_registry

    conn = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == conv.agent_id,
                TaConnector.kind == conv.connector_kind,
                TaConnector.enabled.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not conn:
        return False
    try:
        impl = connectors_registry.get(conv.connector_kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
        await impl.send(cfg, OutboundMessage(external_chat_id=conv.external_id, content=text_content))
    except Exception:
        logger.exception("followup: envio falhou conv=%s", conv.id)
        return False
    return True


async def followup_inactivity_job() -> None:
    """Follow-up por inatividade: conversa 'active' parada > N horas → 1 nudge.

    Fecha o gap do "Follow-up" aposentado do CRM (Fase 4). Config por tenant
    (TaRuntimeParam scope=tenant): followup_enabled='true', followup_hours='24',
    followup_message. Idempotente via last_followup_at (reseta quando entra msg
    nova). DESLIGADO por padrão (enabled != 'true') → seguro.
    """
    DEFAULT_MSG = "Oi! Vi que nossa conversa parou — posso te ajudar com mais alguma coisa? 😊"
    import json as _json
    from zoneinfo import ZoneInfo as _ZoneInfo

    try:
        async with db_context() as db:
            now = _now_utc_naive()
            enabled = (
                await db.execute(
                    select(TaRuntimeParam.escopo_id).where(
                        TaRuntimeParam.escopo == "tenant",
                        TaRuntimeParam.key == "followup_enabled",
                        TaRuntimeParam.value == "true",
                    )
                )
            ).scalars().all()
            if not enabled:
                return
            cfg_rows = (
                await db.execute(
                    select(TaRuntimeParam.escopo_id, TaRuntimeParam.key, TaRuntimeParam.value).where(
                        TaRuntimeParam.escopo == "tenant",
                        TaRuntimeParam.escopo_id.in_(enabled),
                        TaRuntimeParam.key.in_(["followup_hours", "followup_message", "followup_cadence"]),
                    )
                )
            ).all()
            hours_by: dict[int, int] = {}
            msg_by: dict[int, str] = {}
            cadence_by: dict[int, list] = {}
            for tid, key, val in cfg_rows:
                if key == "followup_hours":
                    try:
                        hours_by[tid] = max(1, int(val))
                    except (TypeError, ValueError):
                        pass
                elif key == "followup_message":
                    msg_by[tid] = val
                elif key == "followup_cadence":
                    # Cadência multi-etapa: JSON [{"h": horas desde a última msg da
                    # família (cumulativo), "msg": texto}, ...]. Presente e válida,
                    # substitui o nudge único do tenant (D+1/D+3/D+7/D+10 etc).
                    try:
                        parsed = [
                            {"h": float(s["h"]), "msg": str(s["msg"]).strip()}
                            for s in _json.loads(val or "[]")
                            if str(s.get("msg", "")).strip() and float(s.get("h", 0)) > 0
                        ]
                        if parsed:
                            cadence_by[tid] = sorted(parsed, key=lambda s: s["h"])
                    except (TypeError, ValueError, KeyError):
                        logger.warning("followup_cadence inválida tenant=%s", tid)

            # Cadência só roda em dia útil / horário comercial (America/Sao_Paulo) —
            # follow-up de madrugada queima o contato. O nudge único legado mantém
            # o comportamento de sempre.
            agora_sp = datetime.now(_ZoneInfo("America/Sao_Paulo"))
            dia_util_comercial = agora_sp.isoweekday() <= 5 and 8 <= agora_sp.hour < 18

            sent_total = 0
            for tid in enabled:
                cadence = cadence_by.get(tid)
                if cadence:
                    if not dia_util_comercial:
                        continue
                    threshold = now - timedelta(hours=cadence[0]["h"])
                    convs = (
                        await db.execute(
                            select(TaConversation)
                            .where(
                                TaConversation.agent_id.in_(
                                    select(TaAgent.id).where(TaAgent.tenant_id == tid)
                                ),
                                TaConversation.status == "active",
                                TaConversation.last_message_at < threshold,
                            )
                            .limit(100)  # cap defensivo por tick
                        )
                    ).scalars().all()
                    houve = False
                    for conv in convs:
                        step = conv.followup_step or 0
                        if conv.last_followup_at and conv.last_message_at > conv.last_followup_at:
                            step = 0  # a família respondeu depois do último nudge — recomeça
                        if step >= len(cadence):
                            continue  # cadência esgotada (encerramento já foi)
                        if now < conv.last_message_at + timedelta(hours=cadence[step]["h"]):
                            continue  # etapa ainda não venceu
                        if step > 0 and conv.last_followup_at and now < conv.last_followup_at + timedelta(hours=20):
                            continue  # espaçamento mínimo: conversa velha não leva a cadência inteira de uma vez
                        msg = cadence[step]["msg"]
                        nome = (conv.contact_name or "").strip().split(" ")[0]
                        if nome:
                            msg = msg.replace("{nome}", nome)
                        else:
                            msg = msg.replace(", {nome}", "").replace("{nome}", "").replace("  ", " ")
                        if await _send_proactive(db, conv, msg):
                            conv.followup_step = step + 1
                            conv.last_followup_at = now
                            db.add(TaMessageLog(conversation_id=conv.id, role="assistant", content=msg))
                            sent_total += 1
                            houve = True
                    if houve:
                        await db.commit()
                    continue

                # ── modo legado: 1 nudge único por período de silêncio ──
                threshold = now - timedelta(hours=hours_by.get(tid, 24))
                message = (msg_by.get(tid) or DEFAULT_MSG).strip() or DEFAULT_MSG
                convs = (
                    await db.execute(
                        select(TaConversation)
                        .where(
                            TaConversation.agent_id.in_(
                                select(TaAgent.id).where(TaAgent.tenant_id == tid)
                            ),
                            TaConversation.status == "active",
                            TaConversation.last_message_at < threshold,
                            or_(
                                TaConversation.last_followup_at.is_(None),
                                TaConversation.last_followup_at < TaConversation.last_message_at,
                            ),
                        )
                        .limit(50)  # cap defensivo por tick
                    )
                ).scalars().all()
                for conv in convs:
                    if await _send_proactive(db, conv, message):
                        conv.last_followup_at = now
                        db.add(TaMessageLog(conversation_id=conv.id, role="assistant", content=message))
                        sent_total += 1
                if convs:
                    await db.commit()
            if sent_total:
                logger.info("followup_inactivity: %s nudges enviados", sent_total)
    except Exception:
        logger.exception("followup_inactivity_job falhou")


async def _job_lock(name: str, ttl: int) -> bool:
    """Lock Redis por tick — com >1 worker, só quem pega o lock roda o job.
    TTL < intervalo do job → próximo tick re-disputa (auto-recupera se 1 worker cai).
    Fail-open: se o Redis estiver fora, deixa rodar (melhor o job rodar do que parar)."""
    try:
        import redis.asyncio as redis_async

        from core.config import settings

        r = redis_async.from_url(settings.redis_url, decode_responses=True)
        try:
            ok = await r.set(f"tier-agent:sched:{name}", "1", nx=True, ex=ttl)
        finally:
            await r.aclose()
        return bool(ok)
    except Exception:
        return True


def _locked(job, name: str, ttl: int):
    """Envolve um job async com o lock por tick (anti-duplicação multi-worker)."""

    async def wrapper() -> None:
        if not await _job_lock(name, ttl):
            return
        await job()

    wrapper.__name__ = f"{getattr(job, '__name__', name)}_locked"
    return wrapper


def init_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        _locked(resume_waiting_playbooks_job, "resume_waiting", 25),
        trigger=IntervalTrigger(seconds=30),
        id="resume_waiting_playbooks",
        replace_existing=True,
        max_instances=1,
    )
    sched.add_job(
        _locked(fire_cron_triggers_job, "fire_cron", 55),
        trigger=IntervalTrigger(seconds=60),
        id="fire_cron_triggers",
        replace_existing=True,
        max_instances=1,
    )
    sched.add_job(
        _locked(sla_watch_job, "sla_watch", 110),
        trigger=IntervalTrigger(seconds=120),
        id="sla_watch",
        replace_existing=True,
        max_instances=1,
    )
    sched.add_job(
        _locked(mirror_pet_conversations_job, "mirror_pet", 50),
        trigger=IntervalTrigger(seconds=60),
        id="mirror_pet_conversations",
        replace_existing=True,
        max_instances=1,
    )
    sched.add_job(
        _locked(followup_inactivity_job, "followup_inactivity", 280),
        trigger=IntervalTrigger(seconds=300),
        id="followup_inactivity",
        replace_existing=True,
        max_instances=1,
    )
    sched.start()
    logger.info(
        "Scheduler iniciado: resume_waiting (30s) + fire_cron (60s) + sla_watch (120s) "
        "+ mirror_pet (60s) + followup_inactivity (300s) [lock Redis por tick]"
    )
    _scheduler = sched
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            logger.exception("shutdown_scheduler falhou")
        _scheduler = None

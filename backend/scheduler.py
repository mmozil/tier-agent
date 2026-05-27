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
from datetime import datetime, timezone
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from core.db import db_context
from models import TaPlaybook, TaPlaybookExecution, TaPlaybookTriggerIndex
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


def init_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        resume_waiting_playbooks_job,
        trigger=IntervalTrigger(seconds=30),
        id="resume_waiting_playbooks",
        replace_existing=True,
        max_instances=1,
    )
    sched.add_job(
        fire_cron_triggers_job,
        trigger=IntervalTrigger(seconds=60),
        id="fire_cron_triggers",
        replace_existing=True,
        max_instances=1,
    )
    sched.start()
    logger.info("Scheduler iniciado: resume_waiting (30s) + fire_cron (60s)")
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

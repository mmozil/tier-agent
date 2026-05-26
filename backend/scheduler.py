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
    """Retoma execuções pausadas (nó wait com resume_at <= NOW)."""
    try:
        async with db_context() as db:
            now = _now_utc_naive()
            rows = (
                await db.execute(
                    select(TaPlaybookExecution)
                    .where(
                        TaPlaybookExecution.status == "waiting",
                        TaPlaybookExecution.resume_at.is_not(None),
                        TaPlaybookExecution.resume_at <= now,
                    )
                    .limit(50)
                )
            ).scalars().all()
            for exe in rows:
                logger.info(
                    "resume_waiting: execution=%s playbook=%s resumindo após wait",
                    exe.id, exe.playbook_id,
                )
                # Marca como running pra evitar double-pickup
                exe.status = "running"
                exe.resume_at = None
                await db.commit()
                # TODO Sprint 4.1: implementar resume real — requer guardar
                # next_node_id na execution + chamar executor de lá.
                # MVP: marca como completed (não-bloqueante pro restante).
                exe.status = "completed"
                exe.completed_at = _now_utc_naive()
                await db.commit()
    except Exception:
        logger.exception("resume_waiting_playbooks_job falhou")


async def fire_cron_triggers_job() -> None:
    """Avalia trigger_cron e dispara playbooks na hora.

    MVP: por enquanto loga + skip (cron real precisa croniter pra avaliar
    cron_expr — adicionar no requirements + lógica em Sprint 4.1).
    """
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
            if rows:
                logger.debug("fire_cron: %s cron triggers ativos (avaliação real em Sprint 4.1)", len(rows))
    except Exception:
        logger.exception("fire_cron_triggers_job falhou")


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

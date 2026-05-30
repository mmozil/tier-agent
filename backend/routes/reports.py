"""Relatórios de atendimento — agregados por tenant pro painel.

Métricas: volume de conversas, status, handoffs/leads/SLA, CSAT (média +
distribuição), conversas por etiqueta e por atendente. Janela em dias.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaConversation, TaNotification

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/atendimento", response_model=dict)
async def atendimento(
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    since = datetime.utcnow() - timedelta(days=days)

    agent_ids = (
        await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == user.tenant_id))
    ).scalars().all()
    agent_ids = list(agent_ids)
    if not agent_ids:
        return {"days": days, "empty": True}

    # Conversas no período (por started_at)
    convs = (
        await db.execute(
            select(TaConversation).where(
                TaConversation.agent_id.in_(agent_ids),
                TaConversation.started_at >= since,
            )
        )
    ).scalars().all()

    by_status: dict[str, int] = {}
    by_tag: dict[str, int] = {}
    by_agent: dict[str, int] = {}
    csat_scores: list[int] = []
    csat_dist = {str(i): 0 for i in range(6)}

    for c in convs:
        by_status[c.status] = by_status.get(c.status, 0) + 1
        for t in c.tags or []:
            by_tag[t] = by_tag.get(t, 0) + 1
        if c.assigned_to:
            by_agent[c.assigned_to] = by_agent.get(c.assigned_to, 0) + 1
        if c.csat_score is not None:
            csat_scores.append(c.csat_score)
            csat_dist[str(c.csat_score)] = csat_dist.get(str(c.csat_score), 0) + 1

    # Notificações no período (por categoria)
    notif_rows = (
        await db.execute(
            select(TaNotification.category, func.count(TaNotification.id))
            .where(
                TaNotification.tenant_id == user.tenant_id,
                TaNotification.created_at >= since,
            )
            .group_by(TaNotification.category)
        )
    ).all()
    by_category = {cat: cnt for cat, cnt in notif_rows}

    csat_avg = round(sum(csat_scores) / len(csat_scores), 2) if csat_scores else None

    return {
        "days": days,
        "total_conversas": len(convs),
        "por_status": by_status,
        "handoffs": by_category.get("handoff", 0),
        "leads": by_category.get("lead", 0),
        "sla_alertas": by_category.get("sla", 0),
        "csat": {
            "respostas": len(csat_scores),
            "media": csat_avg,
            "distribuicao": csat_dist,
        },
        "por_etiqueta": dict(sorted(by_tag.items(), key=lambda kv: -kv[1])),
        "por_atendente": dict(sorted(by_agent.items(), key=lambda kv: -kv[1])),
    }

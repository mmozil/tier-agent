"""Relatórios de atendimento — agregados por tenant pro painel.

Métricas: volume de conversas, status, handoffs/leads/SLA, CSAT (média +
distribuição), conversas por etiqueta e por atendente. Janela em dias.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaConversation, TaMember, TaNotification

router = APIRouter(prefix="/reports", tags=["reports"])

# rótulos pt-BR por dia-da-semana (0=segunda, padrão datetime.weekday())
_DOW_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]


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

    # Deflection — % de conversas resolvidas SEM humano (o número que prova a IA).
    # "Precisou de humano" = conversa distinta com notificação de handoff no período.
    handoff_conv_ids = (
        await db.execute(
            select(func.count(func.distinct(TaNotification.conversation_id))).where(
                TaNotification.tenant_id == user.tenant_id,
                TaNotification.category == "handoff",
                TaNotification.created_at >= since,
                TaNotification.conversation_id.isnot(None),
            )
        )
    ).scalar() or 0
    _total = len(convs)
    _sem_humano = max(_total - handoff_conv_ids, 0)
    _taxa = round(_sem_humano / _total, 3) if _total else None

    return {
        "days": days,
        "total_conversas": len(convs),
        "deflection": {
            "total_conversas": _total,
            "precisaram_humano": handoff_conv_ids,
            "resolvidas_pela_ia": _sem_humano,
            "taxa": _taxa,  # 0..1 (None se sem conversas)
        },
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


@router.get("/overview-live", response_model=dict)
async def overview_live(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Home "ao vivo" estilo Chatwoot Overview: contadores de status atuais
    (sem janela de data), atendentes online e heatmap 7d×hora.

    - conversas: em_aberto (active) / sem_atendente (active sem responsável) /
      aguardando_humano (handed_off) / adiadas (snooze ativo)
    - atendentes: online / total
    - heatmap: matriz 7 dias × 24h por started_at (volume de conversas)
    """
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    tenant_id = user.tenant_id

    # atendentes (independe de ter agente)
    total_atend = (
        await db.execute(
            select(func.count(TaMember.id)).where(
                TaMember.tenant_id == tenant_id, TaMember.status != "disabled"
            )
        )
    ).scalar_one()
    online_atend = (
        await db.execute(
            select(func.count(TaMember.id)).where(
                TaMember.tenant_id == tenant_id,
                TaMember.status != "disabled",
                TaMember.online.is_(True),
            )
        )
    ).scalar_one()

    agent_ids = list(
        (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))).scalars().all()
    )

    now = datetime.utcnow()
    # janela do heatmap: últimos 7 dias-calendário terminando hoje (UTC)
    today = now.date()
    days = [today - timedelta(days=6 - i) for i in range(7)]  # [hoje-6 ... hoje]
    day_index = {d: i for i, d in enumerate(days)}
    cells = [[0] * 24 for _ in range(7)]

    conversas = {"em_aberto": 0, "sem_atendente": 0, "aguardando_humano": 0, "adiadas": 0}

    if agent_ids:
        base = TaConversation.agent_id.in_(agent_ids)

        async def _count(*conds) -> int:
            return (
                await db.execute(select(func.count(TaConversation.id)).where(base, *conds))
            ).scalar_one()

        conversas["em_aberto"] = await _count(TaConversation.status == "active")
        conversas["sem_atendente"] = await _count(
            TaConversation.status == "active",
            TaConversation.assigned_member_id.is_(None),
            or_(TaConversation.assigned_to.is_(None), TaConversation.assigned_to == ""),
        )
        conversas["aguardando_humano"] = await _count(TaConversation.status == "handed_off")
        conversas["adiadas"] = await _count(TaConversation.snoozed_until > now)

        # heatmap — bucket em Python (volume pequeno; evita date_trunc específico de dialeto)
        since7 = datetime.combine(days[0], datetime.min.time())
        started = (
            await db.execute(
                select(TaConversation.started_at).where(base, TaConversation.started_at >= since7)
            )
        ).scalars().all()
        for ts in started:
            if ts is None:
                continue
            idx = day_index.get(ts.date())
            if idx is not None:
                cells[idx][ts.hour] += 1

    max_cell = max((max(row) for row in cells), default=0)

    return {
        "conversas": conversas,
        "atendentes": {"online": int(online_atend or 0), "total": int(total_atend or 0)},
        "heatmap": {
            "days": [{"date": d.isoformat(), "label": _DOW_PT[d.weekday()]} for d in days],
            "cells": cells,
            "max": int(max_cell),
        },
    }

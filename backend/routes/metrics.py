"""Métricas de uso/custo do tenant — pra dashboard /admin/metricas.

Agrega TaMessageLog + TaUsageDaily + TaPlaybookExecution/StepLog em endpoints
prontos pra consumo direto pelo frontend (sem agregar no client).
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import (
    TaAgent,
    TaConversation,
    TaMessageLog,
    TaPlaybook,
    TaPlaybookExecution,
    TaPlaybookStepLog,
    TaUsageDaily,
)

router = APIRouter(prefix="/metrics", tags=["metrics"])


# ─── Schemas
class OverviewResponse(BaseModel):
    period_days: int
    messages_total: int
    tokens_in_total: int
    tokens_out_total: int
    cost_cents_total: int
    cost_brl_total: float
    avg_latency_ms: float
    agents_count: int
    conversations_count: int
    playbook_executions_count: int


class DailyPoint(BaseModel):
    day: str  # YYYY-MM-DD
    messages: int
    tokens_in: int
    tokens_out: int
    cost_cents: int


class ByAgentRow(BaseModel):
    agent_id: int
    agent_nome: str
    messages: int
    cost_cents: int
    avg_latency_ms: float


class ByModelRow(BaseModel):
    model: str
    messages: int
    tokens_in: int
    tokens_out: int
    cost_cents: int


class TopConversationRow(BaseModel):
    conversation_id: int
    agent_id: int
    contact_name: str | None
    external_id: str
    cost_cents: int
    msg_count: int


# ─── Helpers
async def _ensure_tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant")
    return user.tenant_id


def _period_start(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _period_start_str(days: int) -> str:
    return _period_start(days).strftime("%Y-%m-%d")


# ─── Endpoints
@router.get("/overview", response_model=OverviewResponse)
async def overview(
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """KPIs principais do tenant nos últimos N dias."""
    tenant_id = await _ensure_tenant(user)
    since = _period_start(days)
    since_day = since.strftime("%Y-%m-%d")

    # Totais via TaUsageDaily (mais barato que sumar TaMessageLog)
    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(TaUsageDaily.messages), 0),
                func.coalesce(func.sum(TaUsageDaily.tokens_in), 0),
                func.coalesce(func.sum(TaUsageDaily.tokens_out), 0),
                func.coalesce(func.sum(TaUsageDaily.cost_cents), 0),
            ).where(TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day >= since_day)
        )
    ).one()

    msgs_total, tin, tout, cost = totals

    # Avg latency (via TaMessageLog — não cabe em UsageDaily)
    avg_lat = (
        await db.execute(
            select(func.coalesce(func.avg(TaMessageLog.latency_ms), 0))
            .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
            .join(TaAgent, TaAgent.id == TaConversation.agent_id)
            .where(
                TaAgent.tenant_id == tenant_id,
                TaMessageLog.created_at >= since,
                TaMessageLog.role == "assistant",
                TaMessageLog.latency_ms > 0,
            )
        )
    ).scalar_one()

    agents_count = (
        await db.execute(
            select(func.count(TaAgent.id)).where(TaAgent.tenant_id == tenant_id)
        )
    ).scalar_one()

    conv_count = (
        await db.execute(
            select(func.count(TaConversation.id))
            .join(TaAgent, TaAgent.id == TaConversation.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaConversation.started_at >= since)
        )
    ).scalar_one()

    exec_count = (
        await db.execute(
            select(func.count(TaPlaybookExecution.id))
            .join(TaAgent, TaAgent.id == TaPlaybookExecution.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaPlaybookExecution.started_at >= since)
        )
    ).scalar_one()

    return OverviewResponse(
        period_days=days,
        messages_total=int(msgs_total or 0),
        tokens_in_total=int(tin or 0),
        tokens_out_total=int(tout or 0),
        cost_cents_total=int(cost or 0),
        cost_brl_total=round((int(cost or 0)) / 100, 2),
        avg_latency_ms=float(avg_lat or 0),
        agents_count=int(agents_count or 0),
        conversations_count=int(conv_count or 0),
        playbook_executions_count=int(exec_count or 0),
    )


@router.get("/daily", response_model=list[DailyPoint])
async def daily(
    days: int = Query(30, ge=1, le=180),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Série diária pra gráfico de área."""
    tenant_id = await _ensure_tenant(user)
    since_day = _period_start_str(days)

    rows = (
        await db.execute(
            select(
                TaUsageDaily.day,
                TaUsageDaily.messages,
                TaUsageDaily.tokens_in,
                TaUsageDaily.tokens_out,
                TaUsageDaily.cost_cents,
            )
            .where(TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day >= since_day)
            .order_by(TaUsageDaily.day.asc())
        )
    ).all()

    return [
        DailyPoint(
            day=str(r[0]),
            messages=int(r[1] or 0),
            tokens_in=int(r[2] or 0),
            tokens_out=int(r[3] or 0),
            cost_cents=int(r[4] or 0),
        )
        for r in rows
    ]


@router.get("/by-agent", response_model=list[ByAgentRow])
async def by_agent(
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Breakdown por agente."""
    tenant_id = await _ensure_tenant(user)
    since = _period_start(days)

    rows = (
        await db.execute(
            select(
                TaAgent.id,
                TaAgent.nome,
                func.count(TaMessageLog.id),
                func.coalesce(func.sum(TaMessageLog.cost_cents), 0),
                func.coalesce(func.avg(TaMessageLog.latency_ms), 0),
            )
            .join(TaConversation, TaConversation.agent_id == TaAgent.id)
            .join(TaMessageLog, TaMessageLog.conversation_id == TaConversation.id)
            .where(
                TaAgent.tenant_id == tenant_id,
                TaMessageLog.created_at >= since,
                TaMessageLog.role == "assistant",
            )
            .group_by(TaAgent.id, TaAgent.nome)
            .order_by(desc(func.coalesce(func.sum(TaMessageLog.cost_cents), 0)))
        )
    ).all()

    return [
        ByAgentRow(
            agent_id=int(r[0]),
            agent_nome=str(r[1]),
            messages=int(r[2] or 0),
            cost_cents=int(r[3] or 0),
            avg_latency_ms=float(r[4] or 0),
        )
        for r in rows
    ]


@router.get("/by-model", response_model=list[ByModelRow])
async def by_model(
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Breakdown por modelo LLM usado."""
    tenant_id = await _ensure_tenant(user)
    since = _period_start(days)

    rows = (
        await db.execute(
            select(
                TaMessageLog.model_used,
                func.count(TaMessageLog.id),
                func.coalesce(func.sum(TaMessageLog.tokens_in), 0),
                func.coalesce(func.sum(TaMessageLog.tokens_out), 0),
                func.coalesce(func.sum(TaMessageLog.cost_cents), 0),
            )
            .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
            .join(TaAgent, TaAgent.id == TaConversation.agent_id)
            .where(
                TaAgent.tenant_id == tenant_id,
                TaMessageLog.created_at >= since,
                TaMessageLog.role == "assistant",
                TaMessageLog.model_used.is_not(None),
            )
            .group_by(TaMessageLog.model_used)
            .order_by(desc(func.coalesce(func.sum(TaMessageLog.cost_cents), 0)))
        )
    ).all()

    return [
        ByModelRow(
            model=str(r[0] or "?"),
            messages=int(r[1] or 0),
            tokens_in=int(r[2] or 0),
            tokens_out=int(r[3] or 0),
            cost_cents=int(r[4] or 0),
        )
        for r in rows
    ]


@router.get("/top-conversations", response_model=list[TopConversationRow])
async def top_conversations(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Top N conversas mais caras."""
    tenant_id = await _ensure_tenant(user)
    since = _period_start(days)

    rows = (
        await db.execute(
            select(
                TaConversation.id,
                TaConversation.agent_id,
                TaConversation.contact_name,
                TaConversation.external_id,
                func.coalesce(func.sum(TaMessageLog.cost_cents), 0),
                TaConversation.msg_count,
            )
            .join(TaMessageLog, TaMessageLog.conversation_id == TaConversation.id)
            .join(TaAgent, TaAgent.id == TaConversation.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaMessageLog.created_at >= since)
            .group_by(
                TaConversation.id,
                TaConversation.agent_id,
                TaConversation.contact_name,
                TaConversation.external_id,
                TaConversation.msg_count,
            )
            .order_by(desc(func.coalesce(func.sum(TaMessageLog.cost_cents), 0)))
            .limit(limit)
        )
    ).all()

    return [
        TopConversationRow(
            conversation_id=int(r[0]),
            agent_id=int(r[1]),
            contact_name=r[2],
            external_id=str(r[3] or "?"),
            cost_cents=int(r[4] or 0),
            msg_count=int(r[5] or 0),
        )
        for r in rows
    ]

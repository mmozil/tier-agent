"""Budget guard — pausa tenant que estourou quota mensal de custo LLM.

Quotas default por SKU (configurável via TaRuntimeParam):
- trial:        R$  20/mês
- ta-starter:   R$  50/mês
- ta-pro:       R$ 200/mês
- ta-business:  R$ 800/mês

Alert em 80% (cria TaNotification). Hard pause em 120% (TaTenant.status='suspended').
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaNotification, TaTenant, TaUsageDaily

logger = logging.getLogger(__name__)

DEFAULT_QUOTAS_BRL = {
    "trial": 20,
    "ta-starter": 50,
    "ta-pro": 200,
    "ta-business": 800,
}
ALERT_THRESHOLD = 0.80
PAUSE_THRESHOLD = 1.20


async def get_tenant_usage_cents(db: AsyncSession, tenant_id: int) -> int:
    """Soma cost_cents de TaUsageDaily no mês atual."""
    month_start = datetime.utcnow().strftime("%Y-%m-01")
    row = (
        await db.execute(
            select(func.coalesce(func.sum(TaUsageDaily.cost_cents), 0)).where(
                TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day >= month_start
            )
        )
    ).scalar_one()
    return int(row or 0)


def get_quota_cents(sku: str) -> int:
    """Quota em cents BRL por SKU."""
    return DEFAULT_QUOTAS_BRL.get(sku, DEFAULT_QUOTAS_BRL["trial"]) * 100


async def check_and_enforce(db: AsyncSession, tenant_id: int) -> dict:
    """Retorna {usage_cents, quota_cents, pct, status: 'ok'|'alert'|'paused'}.

    Cria Notification em alert. Suspende tenant em pause.
    Chamada inline em agent_runtime ANTES de processar — se paused, bloqueia.
    """
    tenant = await db.get(TaTenant, tenant_id)
    if not tenant:
        return {"status": "unknown"}

    quota = get_quota_cents(tenant.sku or "trial")
    usage = await get_tenant_usage_cents(db, tenant_id)
    pct = usage / quota if quota > 0 else 0

    if pct >= PAUSE_THRESHOLD and tenant.status != "suspended":
        tenant.status = "suspended"
        await db.commit()
        try:
            db.add(
                TaNotification(
                    tenant_id=tenant_id,
                    category="error",
                    title=f"Tenant suspenso — quota mensal estourada ({pct * 100:.0f}%)",
                    body=(
                        f"Uso R$ {usage / 100:.2f} de quota R$ {quota / 100:.2f} (SKU {tenant.sku}). "
                        f"Tenant pausado. Reativar via /admin/cobranca após upgrade ou início do próximo mês."
                    ),
                    payload_json={"usage_cents": usage, "quota_cents": quota, "pct": pct},
                    status="unread",
                )
            )
            await db.commit()
        except Exception:
            logger.exception("notification pause falhou tenant=%s", tenant_id)
        return {"status": "paused", "usage_cents": usage, "quota_cents": quota, "pct": pct}

    if pct >= ALERT_THRESHOLD and pct < PAUSE_THRESHOLD:
        # Verifica se já não tem notif recente (anti-spam)
        last = (
            await db.execute(
                select(TaNotification.id)
                .where(
                    TaNotification.tenant_id == tenant_id,
                    TaNotification.category == "info",
                    TaNotification.title.like("Alerta orçamento%"),
                )
                .order_by(TaNotification.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not last:
            try:
                db.add(
                    TaNotification(
                        tenant_id=tenant_id,
                        category="info",
                        title=f"Alerta orçamento — {pct * 100:.0f}% usado",
                        body=(
                            f"R$ {usage / 100:.2f} de R$ {quota / 100:.2f} consumidos este mês. "
                            f"Em 120% o tenant será pausado automaticamente."
                        ),
                        payload_json={"usage_cents": usage, "quota_cents": quota, "pct": pct},
                        status="unread",
                    )
                )
                await db.commit()
            except Exception:
                logger.exception("notification alert falhou tenant=%s", tenant_id)
        return {"status": "alert", "usage_cents": usage, "quota_cents": quota, "pct": pct}

    return {"status": "ok", "usage_cents": usage, "quota_cents": quota, "pct": pct}

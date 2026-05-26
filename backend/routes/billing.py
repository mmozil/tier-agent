"""Endpoints de billing — SKUs + checkout + assinatura."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaSubscription, TaTenant
from services import billing as bill

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/skus")
async def get_skus(_: CurrentUser = Depends(get_current_user)):
    return {"skus": bill.list_skus()}


@router.get("/subscription")
async def my_subscription(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        return None
    tenant = await db.get(TaTenant, user.tenant_id)
    sub = await db.get(TaSubscription, user.tenant_id)
    sku = bill.get_sku(tenant.sku if tenant else "trial")
    return {
        "tenant_id": user.tenant_id,
        "current_sku": tenant.sku if tenant else None,
        "sku_details": {
            "key": sku.key,
            "label": sku.label,
            "monthly_brl": sku.monthly_brl,
            "max_agents": sku.max_agents,
            "daily_messages": sku.daily_messages,
        } if sku else None,
        "subscription": {
            "status": sub.status,
            "tierpay_subscription_id": sub.tierpay_subscription_id,
            "next_billing_at": sub.next_billing_at.isoformat() if sub and sub.next_billing_at else None,
        } if sub else None,
    }


class CheckoutIn(BaseModel):
    sku: str


@router.post("/checkout")
async def checkout(
    payload: CheckoutIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(400, "Sem tenant")
    sku = bill.get_sku(payload.sku)
    if not sku:
        raise HTTPException(400, f"SKU inválido")

    try:
        result = await bill.create_subscription_checkout(
            tenant_id=user.tenant_id, sku_key=payload.sku, customer_email=user.email
        )
    except Exception as e:
        raise HTTPException(502, f"Tier Pay: {e}")
    return result

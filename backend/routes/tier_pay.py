"""Tier Pay multi-tenant config (Q3.7 fechamento).

Cada tenant configura própria conta Pagar.me (secret_key sk_*) + recipient_id
opcional pra split. Sem config tenant, fallback pro TIER_PAY_SECRET_KEY env
(master Tier — MVP single-account).

Endpoints:
- GET /tier-pay/config — retorna config do meu tenant (masked)
- POST /tier-pay/config — cria/atualiza config (valida sk_ via Pagar.me /merchants/me)
- DELETE /tier-pay/config — desativa
"""

import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt, encrypt
from models import TaTierPayConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tier-pay", tags=["tier-pay"])


class TierPayConfigOut(BaseModel):
    id: int
    tenant_id: int
    secret_key_masked: str
    recipient_id: str | None
    statement_descriptor: str | None
    fee_percent: float
    active: bool


class TierPayConfigIn(BaseModel):
    secret_key: str  # sk_test_* ou sk_live_*
    recipient_id: str | None = None
    statement_descriptor: str | None = None
    fee_percent: float = 0.0


def _mask(sk: str) -> str:
    if not sk or len(sk) < 12:
        return "***"
    return f"{sk[:8]}...{sk[-4:]}"


async def _validate_pagarme_key(sk: str) -> bool:
    """Valida sk_* via Pagar.me /merchants/me (auth Basic)."""
    try:
        async with httpx.AsyncClient(timeout=10, auth=(sk, "")) as cli:
            r = await cli.get("https://api.pagar.me/core/v5/merchants/me")
        return r.status_code == 200
    except Exception:
        return False


@router.get("/config", response_model=TierPayConfigOut | None)
async def get_config(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    cfg = (
        await db.execute(
            select(TaTierPayConfig).where(TaTierPayConfig.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if not cfg:
        return None
    try:
        sk = decrypt(cfg.secret_key_enc)
    except Exception:
        sk = ""
    return TierPayConfigOut(
        id=cfg.id,
        tenant_id=cfg.tenant_id,
        secret_key_masked=_mask(sk),
        recipient_id=cfg.recipient_id,
        statement_descriptor=cfg.statement_descriptor,
        fee_percent=cfg.fee_percent,
        active=cfg.active,
    )


@router.post("/config", response_model=TierPayConfigOut)
async def upsert_config(
    payload: TierPayConfigIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    sk = payload.secret_key.strip()
    if not sk.startswith(("sk_test_", "sk_live_")):
        raise HTTPException(400, "secret_key inválida (deve começar com sk_test_ ou sk_live_)")

    if not await _validate_pagarme_key(sk):
        raise HTTPException(
            400,
            "Falha autenticando na Pagar.me com essa secret_key. Confira se está ativa em dashboard.pagar.me",
        )

    existing = (
        await db.execute(
            select(TaTierPayConfig).where(TaTierPayConfig.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if existing:
        existing.secret_key_enc = encrypt(sk)
        existing.recipient_id = payload.recipient_id
        existing.statement_descriptor = payload.statement_descriptor
        existing.fee_percent = max(0.0, min(payload.fee_percent, 50.0))
        existing.active = True
        cfg = existing
    else:
        cfg = TaTierPayConfig(
            tenant_id=user.tenant_id,
            secret_key_enc=encrypt(sk),
            recipient_id=payload.recipient_id,
            statement_descriptor=payload.statement_descriptor,
            fee_percent=max(0.0, min(payload.fee_percent, 50.0)),
            active=True,
        )
        db.add(cfg)
    await db.commit()
    await db.refresh(cfg)

    return TierPayConfigOut(
        id=cfg.id,
        tenant_id=cfg.tenant_id,
        secret_key_masked=_mask(sk),
        recipient_id=cfg.recipient_id,
        statement_descriptor=cfg.statement_descriptor,
        fee_percent=cfg.fee_percent,
        active=cfg.active,
    )


@router.delete("/config", status_code=204)
async def delete_config(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    cfg = (
        await db.execute(
            select(TaTierPayConfig).where(TaTierPayConfig.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if cfg:
        await db.delete(cfg)
        await db.commit()


@router.get("/status")
async def status(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Status combinado: tem config tenant? master env disponível? feature ready?"""
    has_master = bool(os.environ.get("TIER_PAY_SECRET_KEY"))
    has_tenant = False
    if user.tenant_id:
        has_tenant = bool(
            (
                await db.execute(
                    select(TaTierPayConfig).where(
                        TaTierPayConfig.tenant_id == user.tenant_id,
                        TaTierPayConfig.active.is_(True),
                    )
                )
            ).scalar_one_or_none()
        )
    return {
        "ready": has_tenant or has_master,
        "has_tenant_config": has_tenant,
        "has_master_fallback": has_master,
        "mode": "tenant" if has_tenant else ("master_fallback" if has_master else "unconfigured"),
    }

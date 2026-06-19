"""Integração Tier Empresas (ERP) ↔ Tier Agent — provisiona/linka tenant + SSO.

O ERP chama estes endpoints backend-to-backend, autenticado por shared secret
(`TIER_ERP_INTEGRATION_SECRET`, env nos 2 lados). Fase 3 do inbox federado:
  1. /provision → cria-ou-linka 1 TaTenant por empresa (idempotente por CNPJ/email).
  2. /sso       → emite um JWT de sessão (Bearer) pro tenant linkado, sem 2º login.

🔒 Bearer (NÃO cookie) de propósito: o cookie `tier_session` colide entre ERP e Agent
(mesmo nome, `.tier.finance`, secrets diferentes) — usar Bearer evita sobrescrever a
sessão do ERP. O secret vive só no backend dos 2 lados, nunca no browser.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_token
from core.config import get_settings
from core.db import get_db
from models import TaTenant

router = APIRouter(prefix="/integrations/tier", tags=["integrations-tier"])
settings = get_settings()


def _check_secret(secret: str | None) -> None:
    expected = settings.tier_erp_integration_secret or ""
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Integração ERP não configurada")
    if not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Secret inválido")


def _digits(s: str | None) -> str | None:
    if not s:
        return None
    d = "".join(c for c in s if c.isdigit())
    return d or None


class ProvisionIn(BaseModel):
    nome: str
    email: str
    cnpj: str | None = None


class ProvisionOut(BaseModel):
    tenant_id: int
    created: bool


@router.post("/provision", response_model=ProvisionOut)
async def provision_tenant(
    payload: ProvisionIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Cria-ou-linka 1 tenant do Agent pra uma empresa do ERP. Idempotente por CNPJ → email."""
    _check_secret(x_tier_integration_secret)
    cnpj = _digits(payload.cnpj)

    tenant: TaTenant | None = None
    if cnpj:
        tenant = (await db.execute(select(TaTenant).where(TaTenant.cnpj == cnpj))).scalar_one_or_none()
    if not tenant:
        tenant = (await db.execute(select(TaTenant).where(TaTenant.email == payload.email))).scalar_one_or_none()
    if tenant:
        return ProvisionOut(tenant_id=tenant.id, created=False)

    tenant = TaTenant(nome=payload.nome, email=payload.email, cnpj=cnpj, sku="trial", status="active")
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return ProvisionOut(tenant_id=tenant.id, created=True)


class SsoIn(BaseModel):
    tenant_id: int
    email: str | None = None


class SsoOut(BaseModel):
    access_token: str
    tenant_id: int
    expires_in_hours: int


@router.post("/sso", response_model=SsoOut)
async def sso_mint(
    payload: SsoIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Emite um JWT de sessão (owner) pro tenant linkado. O ERP embute o inbox com este Bearer."""
    _check_secret(x_tier_integration_secret)
    tenant = await db.get(TaTenant, payload.tenant_id)
    if not tenant or tenant.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant não encontrado ou inativo")
    token = create_token(
        str(tenant.id),
        {"tenant_id": tenant.id, "email": payload.email or tenant.email, "role": "owner"},
    )
    return SsoOut(access_token=token, tenant_id=tenant.id, expires_in_hours=settings.jwt_ttl_hours)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user, require_admin
from core.db import get_db
from models import TaTenant

router = APIRouter(prefix="/tenants", tags=["tenants"])


class TenantCreate(BaseModel):
    nome: str
    email: str
    cnpj: str | None = None
    sku: str = "trial"


class TenantOut(BaseModel):
    id: int
    nome: str
    email: str
    cnpj: str | None
    sku: str
    status: str

    model_config = {"from_attributes": True}


@router.get("/me", response_model=TenantOut)
async def get_my_tenant(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(404, "Usuário sem tenant")
    tenant = await db.get(TaTenant, user.tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant não encontrado")
    return tenant


@router.get("", response_model=list[TenantOut])
async def list_tenants(
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TaTenant).order_by(TaTenant.id.desc()).limit(200))
    return list(result.scalars().all())


@router.post("", response_model=TenantOut, status_code=201)
async def create_tenant(
    payload: TenantCreate,
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tenant = TaTenant(**payload.model_dump())
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


# ── «Fechar o Atendimento» — modo incidente (31/10/2026) ────────────────────────
# No incidente da M7 a contenção foi derrubar número por número. Aqui é um interruptor:
# fechado, só o dono da conta entra (a trava está em `core.auth.get_current_user`).
# Fechar: dono ou gestor (fechar é sempre seguro — e o gestor que fecha também fica de fora).
# Reabrir: só o dono (ou a equipe Tier), para ninguém de dentro reabrir por conta própria.


@router.get("/me/atendimento")
async def estado_do_atendimento(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    t = await db.get(TaTenant, user.tenant_id)
    em = getattr(t, "atendimento_fechado_em", None) if t else None
    return {"fechado": bool(em), "fechado_em": em.isoformat() if em else None}


@router.post("/me/atendimento/fechar")
async def fechar_atendimento(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import datetime

    from services import visao_conversas as visao

    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    visao.exigir_gestor(user, "fechar o Atendimento")
    t = await db.get(TaTenant, user.tenant_id)
    if t.atendimento_fechado_em is None:
        t.atendimento_fechado_em = datetime.utcnow()
        await db.commit()
    return {"fechado": True, "fechado_em": t.atendimento_fechado_em.isoformat()}


@router.post("/me/atendimento/abrir")
async def abrir_atendimento(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    if user.member_id is not None and not user.is_admin:
        raise HTTPException(403, "Só o dono da conta reabre o Atendimento. O que fazer: entre com o login do dono.")
    t = await db.get(TaTenant, user.tenant_id)
    if t.atendimento_fechado_em is not None:
        t.atendimento_fechado_em = None
        await db.commit()
    return {"fechado": False, "fechado_em": None}

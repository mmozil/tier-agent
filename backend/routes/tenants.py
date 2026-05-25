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

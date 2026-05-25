"""Routes admin pra gerenciar containers Hermes (provision/restart/health)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user, require_admin
from core.db import get_db
from models import TaContainer
from services import container_orchestrator as orch

router = APIRouter(prefix="/containers", tags=["containers"])


class ContainerOut(BaseModel):
    id: int
    tenant_id: int
    docker_container_id: str | None
    status: str
    host: str
    port: int | None
    image_version: str | None
    last_health_check_at: str | None
    restart_count: int

    model_config = {"from_attributes": True}


@router.post("/{tenant_id}/provision", response_model=ContainerOut)
async def provision_container(
    tenant_id: int,
    _admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria ou recria container Hermes pro tenant lendo config LLM ativa."""
    spec = await orch.build_spec_from_db(tenant_id, db)
    record = await orch.create_container(spec, db)
    return record


@router.post("/{tenant_id}/restart")
async def restart(
    tenant_id: int,
    _admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await orch.restart_container(tenant_id, db)
    return {"status": "restarted"}


@router.post("/{tenant_id}/stop")
async def stop(
    tenant_id: int,
    _admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await orch.stop_container(tenant_id, db)
    return {"status": "stopped"}


@router.delete("/{tenant_id}", status_code=204)
async def remove(
    tenant_id: int,
    drop_volume: bool = False,
    _admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await orch.remove_container(tenant_id, db, drop_volume=drop_volume)


@router.get("/{tenant_id}/health")
async def health(
    tenant_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin and user.tenant_id != tenant_id:
        raise HTTPException(403, "Sem permissão")
    ok = await orch.health_check(tenant_id, db)
    return {"healthy": ok}


@router.get("/{tenant_id}", response_model=ContainerOut)
async def get_container(
    tenant_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin and user.tenant_id != tenant_id:
        raise HTTPException(403, "Sem permissão")
    record = await db.get(TaContainer, tenant_id)
    if not record:
        raise HTTPException(404, "Container não provisionado")
    return record

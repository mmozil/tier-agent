"""Respostas prontas (canned responses) — atalhos do atendente por tenant.

CRUD simples; o atendente insere com 1 clique na caixa de resposta do painel.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaCannedResponse

router = APIRouter(prefix="/canned-responses", tags=["canned-responses"])


class CannedIn(BaseModel):
    shortcut: str
    content: str


class CannedOut(BaseModel):
    id: int
    shortcut: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[CannedOut])
async def list_canned(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(
            select(TaCannedResponse)
            .where(TaCannedResponse.tenant_id == user.tenant_id)
            .order_by(TaCannedResponse.shortcut.asc())
        )
    ).scalars().all()
    return rows


@router.post("", response_model=CannedOut)
async def create_canned(
    body: CannedIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    shortcut = (body.shortcut or "").strip()
    content = (body.content or "").strip()
    if not shortcut or not content:
        raise HTTPException(422, "Atalho e conteúdo são obrigatórios")
    item = TaCannedResponse(tenant_id=user.tenant_id, shortcut=shortcut[:64], content=content)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{item_id}", response_model=CannedOut)
async def update_canned(
    item_id: int,
    body: CannedIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    item = await db.get(TaCannedResponse, item_id)
    if not item or item.tenant_id != user.tenant_id:
        raise HTTPException(404, "Resposta não encontrada")
    item.shortcut = (body.shortcut or item.shortcut).strip()[:64]
    item.content = (body.content or item.content).strip()
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=dict)
async def delete_canned(
    item_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    item = await db.get(TaCannedResponse, item_id)
    if not item or item.tenant_id != user.tenant_id:
        raise HTTPException(404, "Resposta não encontrada")
    await db.delete(item)
    await db.commit()
    return {"deleted": item_id}

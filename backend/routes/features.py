"""Feature flags — toggle on/off de capacidades sem deploy."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaFeatureFlag

router = APIRouter(prefix="/feature-flags", tags=["features"])


KNOWN_FLAGS = {
    "enable_self_improving_skills": "Skills auto-aprendidas (curator lifecycle)",
    "enable_curator_lifecycle": "Curator subagent (consolida skills idle)",
    "enable_cron_scheduler": "Agendamento de tarefas pelo agente",
    "enable_voice_in": "Receber áudio via canais",
    "enable_voice_out": "Responder em áudio (TTS)",
    "enable_subagents": "Sub-agents paralelos (research)",
    "enable_honcho_user_modeling": "User model dialectic (Honcho)",
    "enable_web_browsing": "Agente pode navegar na web",
    "enable_code_execution": "Agente pode executar código (risco)",
    "enable_human_handoff": "Escalar pra atendente humano",
    "enable_sleep_time_compute": "Consolidação noturna offline",
    "enable_mcp_client": "MCP client (tools externas)",
}


class FlagIn(BaseModel):
    escopo: str  # global | tenant | agent
    escopo_id: int | None = None
    key: str
    value: str | None = None
    enabled: bool = True


class FlagOut(BaseModel):
    id: int
    escopo: str
    escopo_id: int | None
    key: str
    value: str | None
    enabled: bool

    model_config = {"from_attributes": True}


@router.get("/known")
async def known_flags():
    return {"flags": [{"key": k, "description": v} for k, v in KNOWN_FLAGS.items()]}


def _can_write_scope(user: CurrentUser, escopo: str, escopo_id: int | None) -> None:
    if escopo == "global" and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode mudar flag global")
    if escopo == "tenant":
        if not user.is_admin and escopo_id != user.tenant_id:
            raise HTTPException(403, "Flag de outro tenant")
    # agent: TODO validar dono do agent (skipped por enquanto)


@router.get("", response_model=list[FlagOut])
async def list_flags(
    todos: bool = False,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Flags globais + as do próprio tenant. Visão de plataforma = `?todos=true` (admin).

    Mesmo escopo dos providers (ago/2026): ser admin não pode significar "sem filtro
    nenhum" numa rota que a tela normal consome, senão a lista devolve quais features
    cada cliente tem ligada. Hoje não vaza nada de fato — só existe flag global e
    ninguém no front consome — mas a primeira flag por tenant acordaria o problema.
    """
    stmt = select(TaFeatureFlag)
    if not (user.is_admin and todos):
        stmt = stmt.where(
            (TaFeatureFlag.escopo == "global")
            | ((TaFeatureFlag.escopo == "tenant") & (TaFeatureFlag.escopo_id == user.tenant_id))
        )
    result = await db.execute(stmt.order_by(TaFeatureFlag.escopo, TaFeatureFlag.key))
    return list(result.scalars().all())


@router.post("", response_model=FlagOut, status_code=201)
async def upsert_flag(
    payload: FlagIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _can_write_scope(user, payload.escopo, payload.escopo_id)
    # Upsert: se existe (escopo+id+key), atualiza; senão cria
    existing = await db.execute(
        select(TaFeatureFlag).where(
            TaFeatureFlag.escopo == payload.escopo,
            TaFeatureFlag.escopo_id == payload.escopo_id,
            TaFeatureFlag.key == payload.key,
        )
    )
    item = existing.scalar_one_or_none()
    if item:
        item.value = payload.value
        item.enabled = payload.enabled
    else:
        item = TaFeatureFlag(**payload.model_dump())
        db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{flag_id}", status_code=204)
async def delete_flag(
    flag_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaFeatureFlag, flag_id)
    if not item:
        raise HTTPException(404, "Flag não encontrada")
    _can_write_scope(user, item.escopo, item.escopo_id)
    await db.delete(item)
    await db.commit()

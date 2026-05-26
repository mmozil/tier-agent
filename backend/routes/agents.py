from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent
from services import templates as tpl

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentCreate(BaseModel):
    nome: str
    persona: str | None = None
    system_prompt: str | None = None
    template_kind: str | None = None


class AgentOut(BaseModel):
    id: int
    tenant_id: int
    nome: str
    persona: str | None
    system_prompt: str | None
    template_kind: str | None
    active: bool

    model_config = {"from_attributes": True}


async def _ensure_tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant — finalize signup")
    return user.tenant_id


@router.get("", response_model=list[AgentOut])
async def list_agents(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    result = await db.execute(
        select(TaAgent).where(TaAgent.tenant_id == tenant_id).order_by(TaAgent.id.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    payload: AgentCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    data = payload.model_dump()

    # Se template_kind bate em template conhecido, aplica persona + system_prompt do template
    # (user ainda pode sobrescrever passando os campos explicitamente)
    if data.get("template_kind"):
        t = tpl.get_template(data["template_kind"])
        if t:
            if not data.get("persona"):
                data["persona"] = t.persona
            if not data.get("system_prompt"):
                data["system_prompt"] = t.system_prompt

    agent = TaAgent(tenant_id=tenant_id, **data)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    return agent


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: int,
    payload: AgentCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(agent, k, v)
    await db.commit()
    await db.refresh(agent)
    return agent

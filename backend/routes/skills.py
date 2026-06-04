"""Routes pra skills auto-criadas pelo Engine Curator (Q3.2).

Cliente vê o que o agente "aprendeu" sozinho. Pode arquivar skills ruins
ou ver conteúdo full pra entender o aprendizado.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent

router = APIRouter(prefix="/agents", tags=["skills"])


class SkillInfoOut(BaseModel):
    path: str
    name: str
    relative_dir: str
    size_bytes: int
    modified_at: datetime | None
    title: str | None
    description: str | None
    is_user_uploaded: bool


@router.get("/{agent_id}/skills", response_model=list[SkillInfoOut])
async def list_agent_skills(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista TODAS as skills no container Engine do agente (auto + uploaded)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != user.tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    from services import skill_extractor

    try:
        skills = skill_extractor.list_skills_in_container(agent.tenant_id)
    except Exception as e:
        raise HTTPException(500, f"Falha listando skills: {e}")

    return [
        SkillInfoOut(
            path=s.path,
            name=s.name,
            relative_dir=s.relative_dir,
            size_bytes=s.size_bytes,
            modified_at=s.modified_at,
            title=s.title,
            description=s.description,
            is_user_uploaded=s.is_user_uploaded,
        )
        for s in skills
    ]


class ArchiveIn(BaseModel):
    skill_path: str


@router.post("/{agent_id}/skills/archive")
async def archive_skill(
    agent_id: int,
    payload: ArchiveIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move skill pra arquivo (não deleta — restore possível via SSH)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != user.tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    from services import skill_extractor

    # Safety: skill_path deve começar com /opt/data/.engine/skills
    if not payload.skill_path.startswith("/opt/data/.engine/skills"):
        raise HTTPException(400, "skill_path inválido")

    ok = skill_extractor.archive_skill_in_container(agent.tenant_id, payload.skill_path)
    if not ok:
        raise HTTPException(500, "Arquivamento falhou")
    return {"archived": True, "path": payload.skill_path}


class SkillContentOut(BaseModel):
    path: str
    content: str


@router.get("/{agent_id}/skills/content", response_model=SkillContentOut)
async def get_skill_content(
    agent_id: int,
    skill_path: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lê o conteúdo full de uma skill (até 50KB)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != user.tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    if not skill_path.startswith("/opt/data/.engine/skills"):
        raise HTTPException(400, "skill_path inválido")

    from services import skill_extractor

    content = skill_extractor.read_skill_content(agent.tenant_id, skill_path)
    if content is None:
        raise HTTPException(404, "Skill não encontrada ou falha ao ler")
    return SkillContentOut(path=skill_path, content=content)

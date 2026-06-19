"""Equipe — atendentes (TaMember) do tenant.

O dono (TaTenant) gerencia os membros: cria com login próprio, define papel,
ativa/desativa. Atendentes logam pela mesma tela (/login) e veem só o tenant
deles. Base pra fila/round-robin e @menção.
"""

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaMember, TaTeam, TaTenant

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/team", tags=["team"])
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


class MemberOut(BaseModel):
    id: int
    nome: str
    email: str
    role: str
    status: str
    online: bool
    max_conversas: int
    invite_token: str | None = None

    model_config = {"from_attributes": True}


class MemberIn(BaseModel):
    nome: str
    email: EmailStr
    password: str | None = None  # se vazio → cria convite (atendente define a senha)
    role: str = "atendente"
    max_conversas: int = 0


class MemberUpdate(BaseModel):
    nome: str | None = None
    role: str | None = None
    status: str | None = None
    max_conversas: int | None = None
    password: str | None = None


class OnlineIn(BaseModel):
    online: bool


def _require_manager(user: CurrentUser) -> None:
    if user.role not in ("owner", "admin"):
        raise HTTPException(403, "Apenas dono/admin pode gerenciar a equipe")


@router.get("/me", response_model=dict)
async def whoami(user: CurrentUser = Depends(get_current_user)):
    """Quem sou eu — usado pelo frontend pra saber papel/permissões."""
    return {
        "tenant_id": user.tenant_id,
        "email": user.email,
        "role": user.role,
        "is_owner": user.is_owner,
        "member_id": user.member_id,
        "member_name": user.member_name,
    }


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(
            select(TaMember).where(TaMember.tenant_id == user.tenant_id).order_by(TaMember.nome.asc())
        )
    ).scalars().all()
    return rows


@router.post("/members", response_model=MemberOut, status_code=201)
async def create_member(
    body: MemberIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    _require_manager(user)
    role = body.role if body.role in ("admin", "atendente") else "atendente"

    # e-mail único (tabela toda)
    existing = (await db.execute(select(TaMember.id).where(TaMember.email == body.email))).first()
    if existing:
        raise HTTPException(400, "E-mail já cadastrado")

    # Com senha → ativo direto. Sem senha → convite (atendente define a senha via link).
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(400, "Senha precisa de pelo menos 6 caracteres")
        m = TaMember(
            tenant_id=user.tenant_id,
            nome=body.nome.strip(),
            email=str(body.email).lower(),
            password_hash=pwd_ctx.hash(body.password),
            role=role,
            status="active",
            max_conversas=max(0, body.max_conversas or 0),
        )
    else:
        m = TaMember(
            tenant_id=user.tenant_id,
            nome=body.nome.strip(),
            email=str(body.email).lower(),
            password_hash=None,
            role=role,
            status="invited",
            max_conversas=max(0, body.max_conversas or 0),
            invite_token=secrets.token_urlsafe(24),
        )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.put("/members/{member_id}", response_model=MemberOut)
async def update_member(
    member_id: int,
    body: MemberUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    _require_manager(user)
    m = await db.get(TaMember, member_id)
    if not m or m.tenant_id != user.tenant_id:
        raise HTTPException(404, "Membro não encontrado")
    if body.nome is not None:
        m.nome = body.nome.strip()
    if body.role in ("admin", "atendente"):
        m.role = body.role
    if body.status in ("active", "disabled"):
        m.status = body.status
    if body.max_conversas is not None:
        m.max_conversas = max(0, body.max_conversas)
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(400, "Senha precisa de pelo menos 6 caracteres")
        m.password_hash = pwd_ctx.hash(body.password)
    await db.commit()
    await db.refresh(m)
    return m


@router.delete("/members/{member_id}", response_model=dict)
async def delete_member(
    member_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    _require_manager(user)
    m = await db.get(TaMember, member_id)
    if not m or m.tenant_id != user.tenant_id:
        raise HTTPException(404, "Membro não encontrado")
    await db.delete(m)
    await db.commit()
    return {"deleted": member_id}


@router.post("/online", response_model=dict)
async def set_online(
    body: OnlineIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atendente marca-se disponível/indisponível (entra/sai do round-robin)."""
    if user.is_owner or not user.member_id:
        # dono não entra no rodízio; no-op amigável
        return {"online": True, "owner": True}
    m = await db.get(TaMember, user.member_id)
    if not m:
        raise HTTPException(404, "Membro não encontrado")
    m.online = bool(body.online)
    await db.commit()
    return {"online": m.online}


# ─────────────────────────────────────────────────────────────
# Times (grupos pra organizar/atribuir conversas) — paridade Chatwoot
# ─────────────────────────────────────────────────────────────
class TeamOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class TeamIn(BaseModel):
    name: str


@router.get("/teams", response_model=list[TeamOut])
async def list_teams(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(select(TaTeam).where(TaTeam.tenant_id == user.tenant_id).order_by(TaTeam.name.asc()))
    ).scalars().all()
    return rows


@router.post("/teams", response_model=TeamOut, status_code=201)
async def create_team(
    body: TeamIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    _require_manager(user)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Nome do time é obrigatório")
    t = TaTeam(tenant_id=user.tenant_id, name=name[:120])
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/teams/{team_id}", response_model=dict)
async def delete_team(
    team_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    _require_manager(user)
    t = await db.get(TaTeam, team_id)
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Time não encontrado")
    await db.delete(t)
    await db.commit()
    return {"deleted": team_id}


# ─────────────────────────────────────────────────────────────
# Convite por link (público — sem auth)
# ─────────────────────────────────────────────────────────────
class AcceptInviteIn(BaseModel):
    password: str


@router.get("/invite/{token}", response_model=dict)
async def invite_info(token: str, db: AsyncSession = Depends(get_db)):
    """Dados do convite pra renderizar a tela pública (sem auth)."""
    m = (
        await db.execute(select(TaMember).where(TaMember.invite_token == token))
    ).scalar_one_or_none()
    if not m or m.status != "invited":
        raise HTTPException(404, "Convite inválido ou já utilizado")
    tenant = await db.get(TaTenant, m.tenant_id)
    return {"nome": m.nome, "email": m.email, "empresa": tenant.nome if tenant else None}


@router.post("/invite/{token}/accept", response_model=dict)
async def accept_invite(token: str, body: AcceptInviteIn, db: AsyncSession = Depends(get_db)):
    """Atendente define a senha e ativa a conta (sem auth)."""
    m = (
        await db.execute(select(TaMember).where(TaMember.invite_token == token))
    ).scalar_one_or_none()
    if not m or m.status != "invited":
        raise HTTPException(404, "Convite inválido ou já utilizado")
    if len(body.password) < 6:
        raise HTTPException(400, "Senha precisa de pelo menos 6 caracteres")
    m.password_hash = pwd_ctx.hash(body.password)
    m.status = "active"
    m.invite_token = None
    await db.commit()
    return {"ok": True, "email": m.email}

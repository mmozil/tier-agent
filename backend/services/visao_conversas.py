"""Quem vê qual conversa — Etapa 2 do caminho A (09/09/2026). Uma regra, um lugar.

Dono e admin veem todas as conversas do tenant. Atendente vê as conversas dos SEUS
números (`ta_connector.member_id`) e as atribuídas a ela (`assigned_member_id`). É a
mesma régua da visão por registro do CRM do ERP («só os próprios»), de onde o papel
vem no SSO. O filtro é aplicado no servidor — lista, detalhe e toda ação passam por aqui.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaAgent, TaConnector, TaConversation

if TYPE_CHECKING:  # só anotação — o módulo não carrega settings (a regra pura testa sem env)
    from core.auth import CurrentUser

PAPEIS_QUE_VEEM_TUDO = ("owner", "admin")


def ve_tudo(role: str | None) -> bool:
    return (role or "owner") in PAPEIS_QUE_VEEM_TUDO


def pode_ver(
    role: str | None,
    member_id: int | None,
    *,
    assigned_member_id: int | None,
    connector_id: int | None,
    meus_conectores: list[int] | set[int] | tuple[int, ...],
) -> bool:
    """Decisão pura (testável sem banco): esta pessoa enxerga esta conversa?"""
    if ve_tudo(role):
        return True
    if not member_id:
        return False  # atendente sem identidade não vê nada — o lado seguro
    if assigned_member_id == member_id:
        return True
    return bool(connector_id) and connector_id in set(meus_conectores)


def exigir_gestor(user: CurrentUser, acao: str = "fazer isto") -> None:
    if not ve_tudo(user.role):
        raise HTTPException(403, f"Apenas dono/admin pode {acao}")


async def conectores_do_membro(db: AsyncSession, tenant_id: int, member_id: int | None) -> list[int]:
    """Os números (ta_connector.id) que pertencem a esta pessoa, dentro do tenant."""
    if not member_id:
        return []
    rows = (
        await db.execute(
            select(TaConnector.id)
            .join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaConnector.member_id == member_id)
        )
    ).all()
    return [r[0] for r in rows]


async def filtro_para(db: AsyncSession, user: CurrentUser):
    """Cláusula SQL para a listagem: `true()` para quem vê tudo; senão, os meus números ∪ atribuídas a mim."""
    if ve_tudo(user.role):
        return true()
    if not user.member_id:
        return TaConversation.id == -1  # nada
    meus = await conectores_do_membro(db, user.tenant_id, user.member_id)
    cond = TaConversation.assigned_member_id == user.member_id
    if meus:
        cond = or_(cond, TaConversation.connector_id.in_(meus))
    return cond


async def pode_ver_conversa(db: AsyncSession, user: CurrentUser, conv: TaConversation) -> bool:
    if ve_tudo(user.role):
        return True
    meus = await conectores_do_membro(db, user.tenant_id, user.member_id)
    return pode_ver(
        user.role,
        user.member_id,
        assigned_member_id=conv.assigned_member_id,
        connector_id=getattr(conv, "connector_id", None),
        meus_conectores=meus,
    )

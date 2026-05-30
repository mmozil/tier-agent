"""Distribuição de conversas — fila + round-robin entre atendentes online.

Estratégia: menor carga (least-loaded) — a próxima conversa vai pro atendente
online com menos conversas abertas, respeitando o limite `max_conversas`. É o
round-robin "justo" (equaliza carga em vez de só alternar).

O dono (TaTenant) NÃO entra no rodízio — é supervisor e pode pegar qualquer
conversa manualmente. Só TaMember status=active + online=true participam.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaAgent, TaConversation, TaMember

logger = logging.getLogger(__name__)


async def pick_next_member(db: AsyncSession, tenant_id: int) -> TaMember | None:
    """Escolhe o atendente online com menos conversas abertas (respeita cap)."""
    members = (
        await db.execute(
            select(TaMember).where(
                TaMember.tenant_id == tenant_id,
                TaMember.status == "active",
                TaMember.online.is_(True),
            )
        )
    ).scalars().all()
    if not members:
        return None

    # carga atual por membro (conversas active/handed_off atribuídas)
    agent_ids = (
        await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))
    ).scalars().all()
    load: dict[int, int] = {m.id: 0 for m in members}
    if agent_ids:
        rows = (
            await db.execute(
                select(TaConversation.assigned_member_id, func.count(TaConversation.id))
                .where(
                    TaConversation.agent_id.in_(agent_ids),
                    TaConversation.status.in_(["active", "handed_off"]),
                    TaConversation.assigned_member_id.in_(list(load.keys())),
                )
                .group_by(TaConversation.assigned_member_id)
            )
        ).all()
        for mid, cnt in rows:
            if mid in load:
                load[mid] = cnt

    # candidatos abaixo do cap (0 = ilimitado), ordenados por menor carga
    candidates = [m for m in members if m.max_conversas == 0 or load[m.id] < m.max_conversas]
    if not candidates:
        return None
    candidates.sort(key=lambda m: load[m.id])
    return candidates[0]


async def auto_assign(db: AsyncSession, conv: TaConversation, tenant_id: int) -> TaMember | None:
    """Atribui a conversa ao próximo atendente do rodízio, se houver. Não commita
    (o caller faz o commit). Retorna o membro escolhido ou None (fica na fila)."""
    if conv.assigned_member_id:
        return None  # já tem dono
    member = await pick_next_member(db, tenant_id)
    if not member:
        return None
    conv.assigned_member_id = member.id
    conv.assigned_to = member.nome
    logger.info("auto_assign conv=%s -> member=%s (%s)", conv.id, member.id, member.nome)
    return member

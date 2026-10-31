"""Quem vê qual conversa — Etapa 2 do caminho A (09/09/2026). Uma regra, um lugar.

Dono e admin veem todas as conversas do tenant. Atendente vê as conversas dos SEUS
números (`ta_connector.member_id`) e as atribuídas a ela (`assigned_member_id`). É a
mesma régua da visão por registro do CRM do ERP («só os próprios»), de onde o papel
vem no SSO. O filtro é aplicado no servidor — lista, detalhe e toda ação passam por aqui.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import or_, select, text, true
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
    """Os números (ta_connector.id) desta pessoa dentro do tenant: os que ela é a
    RESPONSÁVEL (`ta_connector.member_id`) e os que divide com outras pessoas
    (`ta_connector_membro`, 16/10/2026 — padrão Chatwoot/Zendesk: o número da
    Secretaria é da equipe inteira, não de uma pessoa só)."""
    if not member_id:
        return []
    rows = (
        await db.execute(
            select(TaConnector.id)
            .join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaConnector.member_id == member_id)
        )
    ).all()
    ids = {r[0] for r in rows}
    compartilhados = (
        await db.execute(
            text(
                "SELECT cm.connector_id FROM ta_connector_membro cm"
                " JOIN ta_connector k ON k.id = cm.connector_id"
                " JOIN ta_agent a ON a.id = k.agent_id"
                " WHERE a.tenant_id = :t AND cm.member_id = :m"
            ),
            {"t": tenant_id, "m": member_id},
        )
    ).all()
    ids.update(r[0] for r in compartilhados)
    return sorted(ids)


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


# ── Segunda conferência na saída (31/10/2026) ──────────────────────────────────
# Lição do ChatGPT (março/2023): o vazamento veio de uma camada que ninguém olhava (o cache),
# e a correção incluiu conferir, item a item, que o dado devolvido é de quem pediu. Aqui a
# consulta já filtra (`filtro_para`); esta conferência é INDEPENDENTE dela — refeita em Python,
# linha por linha, a partir dos campos da própria conversa. Se as duas discordarem, a conversa
# NÃO sai e fica um erro no log: divergência entre as duas é defeito, nunca dado a mostrar.

_log = __import__("logging").getLogger(__name__)


async def conferir_saida(db: AsyncSession, user: CurrentUser, conversas, onde: str) -> list:
    conversas = list(conversas or [])
    if not conversas:
        return conversas
    agentes = set((await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == user.tenant_id))).scalars().all())
    if ve_tudo(user.role):
        ok = [c for c in conversas if c.agent_id in agentes]
    else:
        meus = set(await conectores_do_membro(db, user.tenant_id, user.member_id))
        ok = [
            c for c in conversas
            if c.agent_id in agentes
            and pode_ver(user.role, user.member_id, assigned_member_id=c.assigned_member_id,
                         connector_id=getattr(c, "connector_id", None), meus_conectores=meus)
        ]
    if len(ok) != len(conversas):
        barradas = [c.id for c in conversas if c not in ok]
        _log.error("conferência dupla BARROU %d conversa(s) em %s — membro=%s papel=%s ids=%s",
                   len(barradas), onde, user.member_id, user.role, barradas[:20])
    return ok


async def conferir_avisos(db: AsyncSession, user: CurrentUser, avisos, onde: str) -> list:
    """Mesma conferência para o sino e a fila: empresa certa, destinatário certo e, quando o
    aviso é de uma conversa, a conversa tem de passar em `conferir_saida`."""
    avisos = list(avisos or [])
    if not avisos:
        return avisos
    ok = [n for n in avisos if n.tenant_id == user.tenant_id
          and (user.member_id is None or n.target_member_id in (None, user.member_id))]
    ids = {n.conversation_id for n in ok if n.conversation_id}
    if ids:
        convs = (await db.execute(select(TaConversation).where(TaConversation.id.in_(ids)))).scalars().all()
        visiveis = {c.id for c in await conferir_saida(db, user, convs, onde)}
        ok = [n for n in ok if not n.conversation_id or n.conversation_id in visiveis]
    if len(ok) != len(avisos):
        barrados = [n.id for n in avisos if n not in ok]
        _log.error("conferência dupla BARROU %d aviso(s) em %s — membro=%s ids=%s", len(barrados), onde, user.member_id, barrados[:20])
    return ok

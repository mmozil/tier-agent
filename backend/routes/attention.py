"""Fila de atenção — "Precisa de você".

Junta em um lugar tudo que demanda um humano: conversas aguardando atendimento,
conversas sem atendente atribuído e leads/alertas não lidos. Resolve o gap de UX
(antes espalhado entre sino, inbox e leads).
"""

import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaConversation, TaNotification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attention", tags=["attention"])

_ATTN_CATEGORIES = ("lead", "handoff", "sla", "mention", "error")


def _phone(external_id: str | None) -> str | None:
    if not external_id:
        return None
    d = re.sub(r"\D", "", external_id.split("@")[0])
    return d or None


async def _tenant_agent_ids(db: AsyncSession, tenant_id: int) -> list[int]:
    rows = (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))).all()
    return [r[0] for r in rows]


@router.get("")
async def attention_queue(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Tudo que precisa de um humano agora, em 3 buckets + contadores."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    agent_ids = await _tenant_agent_ids(db, user.tenant_id)
    if not agent_ids:
        return {"counts": {"aguardando": 0, "nao_atribuidas": 0, "alertas": 0, "total": 0},
                "aguardando": [], "nao_atribuidas": [], "alertas": []}

    now = datetime.utcnow()
    nao_snoozed = or_(TaConversation.snoozed_until.is_(None), TaConversation.snoozed_until <= now)

    # 1. Aguardando humano — conversas em handed_off (humano assumiu / precisa conduzir)
    aguardando_rows = (
        await db.execute(
            select(TaConversation)
            .where(
                TaConversation.agent_id.in_(agent_ids),
                TaConversation.status == "handed_off",
                nao_snoozed,
            )
            .order_by(TaConversation.last_message_at.desc().nulls_last())
            .limit(100)
        )
    ).scalars().all()

    # 2. Não atribuídas — ativas, sem atendente
    nao_atrib_rows = (
        await db.execute(
            select(TaConversation)
            .where(
                TaConversation.agent_id.in_(agent_ids),
                TaConversation.status == "active",
                TaConversation.assigned_member_id.is_(None),
                nao_snoozed,
            )
            .order_by(TaConversation.last_message_at.desc().nulls_last())
            .limit(100)
        )
    ).scalars().all()

    # 3. Leads / alertas — notificações não lidas (lead, handoff, sla, mention, error)
    alerta_rows = (
        await db.execute(
            select(TaNotification)
            .where(
                TaNotification.tenant_id == user.tenant_id,
                TaNotification.status == "unread",
                TaNotification.category.in_(_ATTN_CATEGORIES),
            )
            .order_by(TaNotification.created_at.desc())
            .limit(100)
        )
    ).scalars().all()

    def conv_item(c: TaConversation) -> dict:
        return {
            "conversation_id": c.id,
            "agent_id": c.agent_id,
            "contato": c.contact_name or _phone(c.external_id),
            "telefone": _phone(c.external_id),
            "preview": c.last_preview,
            "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
            "tags": c.tags or [],
        }

    def notif_item(n: TaNotification) -> dict:
        return {
            "notification_id": n.id,
            "category": n.category,
            "conversation_id": n.conversation_id,
            "contato": n.contato,
            "telefone": n.telefone,
            "title": n.title,
            "body": n.body,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }

    aguardando = [conv_item(c) for c in aguardando_rows]
    nao_atribuidas = [conv_item(c) for c in nao_atrib_rows]
    alertas = [notif_item(n) for n in alerta_rows]

    return {
        "counts": {
            "aguardando": len(aguardando),
            "nao_atribuidas": len(nao_atribuidas),
            "alertas": len(alertas),
            "total": len(aguardando) + len(nao_atribuidas) + len(alertas),
        },
        "aguardando": aguardando,
        "nao_atribuidas": nao_atribuidas,
        "alertas": alertas,
    }

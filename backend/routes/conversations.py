"""Inbox de conversas — o dono do tenant vê as conversas do agente e o histórico.

Read-only por enquanto (acompanhar). Assumir/responder manualmente = V2.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaConversation, TaMessageLog

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationOut(BaseModel):
    id: int
    agent_id: int
    connector_kind: str | None = None
    external_id: str
    contact_name: str | None = None
    status: str
    msg_count: int
    last_message_at: datetime | None = None
    last_preview: str | None = None

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    role: str
    content: str | None = None
    model_used: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


async def _tenant_agent_ids(db: AsyncSession, tenant_id: int) -> list[int]:
    rows = (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))).all()
    return [r[0] for r in rows]


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    agent_id: int | None = None,
    status: str | None = None,
    limit: int = Query(100, ge=1, le=300),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    agent_ids = await _tenant_agent_ids(db, user.tenant_id)
    if not agent_ids:
        return []

    stmt = select(TaConversation).where(TaConversation.agent_id.in_(agent_ids))
    if agent_id is not None:
        if agent_id not in agent_ids:
            raise HTTPException(403, "Agente de outro tenant")
        stmt = stmt.where(TaConversation.agent_id == agent_id)
    if status:
        stmt = stmt.where(TaConversation.status == status)
    stmt = stmt.order_by(TaConversation.last_message_at.desc().nulls_last()).limit(limit)

    convs = (await db.execute(stmt)).scalars().all()

    out: list[ConversationOut] = []
    for c in convs:
        # preview da última mensagem com texto
        last = (
            await db.execute(
                select(TaMessageLog.content)
                .where(TaMessageLog.conversation_id == c.id, TaMessageLog.content.isnot(None))
                .order_by(TaMessageLog.id.desc())
                .limit(1)
            )
        ).first()
        preview = (last[0][:120] if last and last[0] else None)
        out.append(
            ConversationOut(
                id=c.id,
                agent_id=c.agent_id,
                connector_kind=c.connector_kind,
                external_id=c.external_id,
                contact_name=c.contact_name,
                status=c.status,
                msg_count=c.msg_count,
                last_message_at=c.last_message_at,
                last_preview=preview,
            )
        )
    return out


@router.get("/{conversation_id}", response_model=dict)
async def conversation_detail(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    conv = await db.get(TaConversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    agent_ids = await _tenant_agent_ids(db, user.tenant_id)
    if conv.agent_id not in agent_ids:
        raise HTTPException(403, "Conversa de outro tenant")

    msgs = (
        await db.execute(
            select(TaMessageLog)
            .where(TaMessageLog.conversation_id == conversation_id)
            .order_by(TaMessageLog.id.asc())
            .limit(500)
        )
    ).scalars().all()

    return {
        "conversation": ConversationOut(
            id=conv.id,
            agent_id=conv.agent_id,
            connector_kind=conv.connector_kind,
            external_id=conv.external_id,
            contact_name=conv.contact_name,
            status=conv.status,
            msg_count=conv.msg_count,
            last_message_at=conv.last_message_at,
        ).model_dump(),
        "messages": [MessageOut.model_validate(m).model_dump() for m in msgs],
    }

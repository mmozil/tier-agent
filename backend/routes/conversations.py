"""Inbox de conversas — o dono do tenant vê as conversas do agente e o histórico.

Permite assumir (pausar a IA), devolver pra IA e resolver uma conversa.
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt
from models import TaAgent, TaConnector, TaConversation, TaMessageLog
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)

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
    tags: list[str] = []

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
    tag: str | None = None,
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
        ctags = c.tags or []
        if tag and tag not in ctags:
            continue
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
                tags=ctags,
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
            tags=conv.tags or [],
        ).model_dump(),
        "messages": [MessageOut.model_validate(m).model_dump() for m in msgs],
    }


class TagsIn(BaseModel):
    tags: list[str]


@router.put("/{conversation_id}/tags", response_model=dict)
async def set_tags(
    conversation_id: int,
    body: TagsIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Define as etiquetas da conversa (substitui a lista)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    # normaliza: trim, sem vazios, sem duplicatas, minúsculas, max 8
    seen: list[str] = []
    for t in body.tags or []:
        tt = (t or "").strip().lower()[:24]
        if tt and tt not in seen:
            seen.append(tt)
    conv.tags = seen[:8]
    await db.commit()
    return {"conversation_id": conv.id, "tags": conv.tags}


async def _get_owned_conversation(
    db: AsyncSession, conversation_id: int, tenant_id: int
) -> TaConversation:
    conv = await db.get(TaConversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    agent_ids = await _tenant_agent_ids(db, tenant_id)
    if conv.agent_id not in agent_ids:
        raise HTTPException(403, "Conversa de outro tenant")
    return conv


@router.post("/{conversation_id}/handoff", response_model=dict)
async def take_over(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Assumir manualmente: pausa a IA — o humano passa a conduzir a conversa."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    conv.status = "handed_off"
    await db.commit()
    return {"status": "handed_off", "conversation_id": conv.id}


@router.post("/{conversation_id}/resume", response_model=dict)
async def resume_ai(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devolver pra IA: o bot volta a responder automaticamente."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    conv.status = "active"
    await db.commit()
    return {"status": "active", "conversation_id": conv.id}


@router.post("/{conversation_id}/resolve", response_model=dict)
async def resolve(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resolver: encerra a conversa (sai da fila de ativas)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    conv.status = "closed"
    await db.commit()
    return {"status": "closed", "conversation_id": conv.id}


class ReplyIn(BaseModel):
    content: str


@router.post("/{conversation_id}/reply", response_model=MessageOut)
async def reply_manual(
    conversation_id: int,
    body: ReplyIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atendente responde pelo painel — envia no canal do cliente e pausa a IA.

    A mensagem vai pelo mesmo conector do agente (WhatsApp/Telegram/e-mail) e é
    gravada com role='agent' (humano). Assumir = a IA não responde mais sozinha
    até "Devolver para a IA" (resume)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(422, "Mensagem vazia")

    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)

    # Conector do agente pra este canal
    conn = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == conv.agent_id,
                TaConnector.kind == conv.connector_kind,
                TaConnector.enabled.is_(True),
            )
        )
    ).scalars().first()
    if not conn:
        raise HTTPException(409, f"Sem canal {conv.connector_kind} ativo pra enviar")

    # Email: 1ª linha vira assunto (padrão do adapter)
    out_content = content
    if conv.connector_kind == "email" and not content.lower().startswith("subject:"):
        out_content = f"Subject: Resposta do atendimento\n\n{content}"

    try:
        impl = registry.get(conv.connector_kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
        await impl.send(cfg, OutboundMessage(external_chat_id=conv.external_id, content=out_content))
    except Exception as e:
        logger.exception("reply manual falhou conv=%s", conversation_id)
        raise HTTPException(502, f"Falha ao enviar: {e}")

    # Grava a mensagem do atendente + pausa a IA
    msg = TaMessageLog(conversation_id=conv.id, role="agent", content=content[:8000])
    db.add(msg)
    conv.status = "handed_off"
    conv.last_message_at = datetime.utcnow()
    conv.msg_count += 1
    await db.commit()
    await db.refresh(msg)
    return msg

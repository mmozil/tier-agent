"""Inbox de conversas — o dono do tenant vê as conversas do agente e o histórico.

Permite assumir (pausar a IA), devolver pra IA e resolver uma conversa.
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, or_, select, update as sa_update
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
    assigned_to: str | None = None
    assigned_member_id: int | None = None
    csat_state: str = "none"
    csat_score: int | None = None
    snoozed_until: datetime | None = None

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
    scope: str | None = None,  # "mine" | "unassigned" | None (todas)
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
    now = datetime.utcnow()
    if scope == "unassigned":
        stmt = stmt.where(TaConversation.assigned_member_id.is_(None))
    elif scope == "mine" and user.member_id:
        stmt = stmt.where(TaConversation.assigned_member_id == user.member_id)
    if scope == "snoozed":
        stmt = stmt.where(TaConversation.snoozed_until.isnot(None), TaConversation.snoozed_until > now)
    else:
        # esconde adiadas das demais visões até a hora chegar
        stmt = stmt.where(
            or_(TaConversation.snoozed_until.is_(None), TaConversation.snoozed_until <= now)
        )
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
                assigned_to=c.assigned_to,
                assigned_member_id=c.assigned_member_id,
                csat_state=c.csat_state,
                csat_score=c.csat_score,
                snoozed_until=c.snoozed_until,
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
            assigned_to=conv.assigned_to,
            assigned_member_id=conv.assigned_member_id,
            csat_state=conv.csat_state,
            csat_score=conv.csat_score,
            snoozed_until=conv.snoozed_until,
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


async def _send_via_channel(db: AsyncSession, conv: TaConversation, content: str) -> None:
    """Envia uma mensagem pro cliente no canal da conversa. Levanta HTTPException
    em caso de erro (caller decide tratar)."""
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
    out = content
    if conv.connector_kind == "email" and not content.lower().startswith("subject:"):
        out = f"Subject: Atendimento\n\n{content}"
    impl = registry.get(conv.connector_kind)
    cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
    await impl.send(cfg, OutboundMessage(external_chat_id=conv.external_id, content=out))


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
    # quem assume manualmente vira o responsável (se for atendente)
    if user.member_id:
        conv.assigned_member_id = user.member_id
        conv.assigned_to = user.member_name or conv.assigned_to
    await db.commit()
    return {"status": "handed_off", "conversation_id": conv.id, "assigned_member_id": conv.assigned_member_id}


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
    csat: bool = True,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resolver: encerra a conversa. Por padrão envia a pesquisa de satisfação
    (CSAT) no canal — a próxima resposta numérica do cliente vira a nota."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    conv.status = "closed"

    csat_sent = False
    if csat and conv.csat_state != "done":
        from services import csat as csat_svc

        try:
            await _send_via_channel(db, conv, csat_svc.CSAT_QUESTION)
            conv.csat_state = "pending"
            csat_sent = True
        except HTTPException:
            pass  # sem canal pra enviar — encerra mesmo assim
        except Exception:
            logger.exception("envio CSAT falhou conv=%s", conversation_id)

    await db.commit()
    return {"status": "closed", "conversation_id": conv.id, "csat_sent": csat_sent}


class NoteIn(BaseModel):
    content: str
    mentions: list[int] = []  # member_ids marcados com @


@router.post("/{conversation_id}/note", response_model=MessageOut)
async def add_note(
    conversation_id: int,
    body: NoteIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nota interna — visível só pra equipe, NÃO é enviada ao cliente.
    Se houver @menções (member_ids), cria notificação direcionada a cada um."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(422, "Nota vazia")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    note = TaMessageLog(conversation_id=conv.id, role="note", content=content[:8000])
    db.add(note)

    # @menções → notificação direcionada por atendente
    from models import TaMember, TaNotification

    autor = user.member_name or "Equipe"
    for mid in set(body.mentions or []):
        m = await db.get(TaMember, mid)
        if not m or m.tenant_id != user.tenant_id:
            continue
        db.add(
            TaNotification(
                tenant_id=user.tenant_id,
                agent_id=conv.agent_id,
                conversation_id=conv.id,
                category="mention",
                queue="atendimento",
                title=f"{autor} te marcou numa conversa",
                body=content[:500],
                payload_json={"contato": conv.contact_name, "autor": autor},
                status="unread",
                target_member_id=mid,
            )
        )
    await db.commit()
    await db.refresh(note)
    return note


class SnoozeIn(BaseModel):
    minutes: int = 60


@router.post("/{conversation_id}/snooze", response_model=dict)
async def snooze(
    conversation_id: int,
    body: SnoozeIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adia a conversa por N minutos — some da inbox ativa até a hora chegar."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    from datetime import timedelta

    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    mins = max(1, min(body.minutes or 60, 60 * 24 * 30))
    conv.snoozed_until = datetime.utcnow() + timedelta(minutes=mins)
    await db.commit()
    return {"conversation_id": conv.id, "snoozed_until": conv.snoozed_until.isoformat()}


@router.post("/{conversation_id}/unsnooze", response_model=dict)
async def unsnooze(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    conv.snoozed_until = None
    await db.commit()
    return {"conversation_id": conv.id, "snoozed_until": None}


class AssignIn(BaseModel):
    member_id: int | None = None  # null = desatribuir


@router.put("/{conversation_id}/assign", response_model=dict)
async def assign(
    conversation_id: int,
    body: AssignIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atribui a conversa a um atendente (member_id) ou desatribui (null)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    if body.member_id is None:
        conv.assigned_member_id = None
        conv.assigned_to = None
    else:
        from models import TaMember

        m = await db.get(TaMember, body.member_id)
        if not m or m.tenant_id != user.tenant_id:
            raise HTTPException(404, "Atendente não encontrado")
        conv.assigned_member_id = m.id
        conv.assigned_to = m.nome
    await db.commit()
    return {"conversation_id": conv.id, "assigned_member_id": conv.assigned_member_id, "assigned_to": conv.assigned_to}


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


async def _purge_conversations(db: AsyncSession, ids: list[int]) -> int:
    """Apaga conversas + filhas (mensagens, execuções de playbook, notificações).

    Limpa os filhos explicitamente (defensivo — não depende do ON DELETE do schema):
    mensagens são removidas, referências em playbook/notificação viram NULL.
    """
    if not ids:
        return 0
    from models import TaNotification, TaPlaybookExecution

    await db.execute(sa_delete(TaMessageLog).where(TaMessageLog.conversation_id.in_(ids)))
    await db.execute(
        sa_update(TaPlaybookExecution)
        .where(TaPlaybookExecution.conversation_id.in_(ids))
        .values(conversation_id=None)
    )
    await db.execute(
        sa_update(TaNotification)
        .where(TaNotification.conversation_id.in_(ids))
        .values(conversation_id=None)
    )
    res = await db.execute(sa_delete(TaConversation).where(TaConversation.id.in_(ids)))
    return res.rowcount if res.rowcount and res.rowcount > 0 else len(ids)


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exclui uma conversa e todo o histórico dela. Irreversível."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conv = await _get_owned_conversation(db, conversation_id, user.tenant_id)
    await _purge_conversations(db, [conv.id])
    await db.commit()
    return {"deleted": [conv.id], "count": 1}


class BulkDeleteIn(BaseModel):
    ids: list[int] | None = None
    status: str | None = None  # "active" | "handed_off" | "closed"
    agent_id: int | None = None
    all: bool = False


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete(
    body: BulkDeleteIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Limpa várias conversas de uma vez. Escopo (sempre restrito ao tenant):
    por `ids`, por `status` (ex: só resolvidas), ou `all=true` (todas). Irreversível."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    agent_ids = await _tenant_agent_ids(db, user.tenant_id)
    if not agent_ids:
        return {"deleted": [], "count": 0}

    stmt = select(TaConversation.id).where(TaConversation.agent_id.in_(agent_ids))
    if body.ids:
        stmt = stmt.where(TaConversation.id.in_(body.ids))
    elif body.status:
        stmt = stmt.where(TaConversation.status == body.status)
    elif not body.all:
        raise HTTPException(422, "Informe ids, status ou all=true")
    if body.agent_id is not None:
        if body.agent_id not in agent_ids:
            raise HTTPException(403, "Agente de outro tenant")
        stmt = stmt.where(TaConversation.agent_id == body.agent_id)

    ids = [r[0] for r in (await db.execute(stmt)).all()]
    count = await _purge_conversations(db, ids)
    await db.commit()
    return {"deleted": ids, "count": count}

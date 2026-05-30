"""Notifications inbox — eventos dirigidos à equipe do tenant.

Criadas principalmente pelo nó handoff_human de playbooks, mas pode
hospedar outros tipos (errors, alerts billing) no futuro.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaNotification, TaRuntimeParam

router = APIRouter(prefix="/notifications", tags=["notifications"])

_ALERT_KEYS = ("alert_whatsapp", "alert_email", "alert_enabled", "sla_minutes")


class NotificationOut(BaseModel):
    id: int
    tenant_id: int
    agent_id: int | None
    conversation_id: int | None
    playbook_execution_id: int | None
    category: str
    title: str
    body: str | None
    queue: str | None
    payload_json: dict | None
    status: str
    read_at: datetime | None
    created_at: datetime
    # Enriquecidos a partir da conversa vinculada (pra sempre mostrar quem é o cliente)
    contato: str | None = None
    telefone: str | None = None

    model_config = {"from_attributes": True}


class NotificationStats(BaseModel):
    unread: int
    by_category: dict[str, int]


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    status: Literal["unread", "read", "archived", "all"] = "unread",
    limit: int = Query(50, ge=1, le=200),
    agent_id: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    stmt = select(TaNotification).where(TaNotification.tenant_id == user.tenant_id)
    if status != "all":
        stmt = stmt.where(TaNotification.status == status)
    if agent_id is not None:
        stmt = stmt.where(TaNotification.agent_id == agent_id)
    # Atendente vê broadcasts (target null) + as direcionadas a ele. Dono vê tudo.
    if user.member_id:
        stmt = stmt.where(
            or_(
                TaNotification.target_member_id.is_(None),
                TaNotification.target_member_id == user.member_id,
            )
        )
    stmt = stmt.order_by(TaNotification.id.desc()).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()

    # Enriquece com nome/telefone do cliente da conversa vinculada (cobre
    # notificações sem contato no payload, ex: handoff de playbook).
    import re as _re

    from models import TaConversation

    conv_ids = {n.conversation_id for n in rows if n.conversation_id}
    conv_map: dict[int, TaConversation] = {}
    if conv_ids:
        convs = (
            await db.execute(select(TaConversation).where(TaConversation.id.in_(conv_ids)))
        ).scalars().all()
        conv_map = {c.id: c for c in convs}

    out: list[NotificationOut] = []
    for n in rows:
        pj = n.payload_json or {}
        conv = conv_map.get(n.conversation_id) if n.conversation_id else None
        contato = pj.get("contato") or (conv.contact_name if conv else None)
        telefone = pj.get("telefone") or pj.get("whatsapp")
        if not telefone and conv and conv.external_id:
            telefone = _re.sub(r"\D", "", conv.external_id.split("@")[0]) or None
        out.append(
            NotificationOut(
                id=n.id, tenant_id=n.tenant_id, agent_id=n.agent_id,
                conversation_id=n.conversation_id, playbook_execution_id=n.playbook_execution_id,
                category=n.category, title=n.title, body=n.body, queue=n.queue,
                payload_json=n.payload_json, status=n.status, read_at=n.read_at,
                created_at=n.created_at, contato=contato, telefone=telefone,
            )
        )
    return out


class AlertConfig(BaseModel):
    alert_whatsapp: str | None = None
    alert_email: str | None = None
    alert_enabled: bool = True
    sla_minutes: int = 0  # 0 = SLA desligado


@router.get("/alert-config", response_model=AlertConfig)
async def get_alert_config(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Destinos do alerta externo (WhatsApp/e-mail) que avisa a equipe."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(
            select(TaRuntimeParam.key, TaRuntimeParam.value).where(
                TaRuntimeParam.escopo == "tenant",
                TaRuntimeParam.escopo_id == user.tenant_id,
                TaRuntimeParam.key.in_(_ALERT_KEYS),
            )
        )
    ).all()
    vals = {k: v for k, v in rows}
    try:
        sla = int(vals.get("sla_minutes", "0") or 0)
    except (TypeError, ValueError):
        sla = 0
    return AlertConfig(
        alert_whatsapp=vals.get("alert_whatsapp") or None,
        alert_email=vals.get("alert_email") or None,
        alert_enabled=vals.get("alert_enabled", "1") != "0",
        sla_minutes=sla,
    )


@router.put("/alert-config", response_model=AlertConfig)
async def put_alert_config(
    cfg: AlertConfig,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    desired = {
        "alert_whatsapp": (cfg.alert_whatsapp or "").strip(),
        "alert_email": (cfg.alert_email or "").strip(),
        "alert_enabled": "1" if cfg.alert_enabled else "0",
        "sla_minutes": str(max(0, cfg.sla_minutes or 0)),
    }
    existing = (
        await db.execute(
            select(TaRuntimeParam).where(
                TaRuntimeParam.escopo == "tenant",
                TaRuntimeParam.escopo_id == user.tenant_id,
                TaRuntimeParam.key.in_(_ALERT_KEYS),
            )
        )
    ).scalars().all()
    by_key = {p.key: p for p in existing}
    for key, val in desired.items():
        if key in by_key:
            by_key[key].value = val
        else:
            db.add(
                TaRuntimeParam(escopo="tenant", escopo_id=user.tenant_id, key=key, value=val)
            )
    await db.commit()
    return AlertConfig(
        alert_whatsapp=desired["alert_whatsapp"] or None,
        alert_email=desired["alert_email"] or None,
        alert_enabled=cfg.alert_enabled,
        sla_minutes=max(0, cfg.sla_minutes or 0),
    )


@router.get("/stats", response_model=NotificationStats)
async def notification_stats(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")

    # unread count (respeita visibilidade por atendente)
    member_filter = []
    if user.member_id:
        member_filter = [
            or_(
                TaNotification.target_member_id.is_(None),
                TaNotification.target_member_id == user.member_id,
            )
        ]
    unread = (
        await db.execute(
            select(func.count(TaNotification.id)).where(
                TaNotification.tenant_id == user.tenant_id,
                TaNotification.status == "unread",
                *member_filter,
            )
        )
    ).scalar_one() or 0

    # by_category
    rows = (
        await db.execute(
            select(TaNotification.category, func.count(TaNotification.id))
            .where(
                TaNotification.tenant_id == user.tenant_id,
                TaNotification.status == "unread",
                *member_filter,
            )
            .group_by(TaNotification.category)
        )
    ).all()
    by_cat = {cat: cnt for cat, cnt in rows}

    return NotificationStats(unread=unread, by_category=by_cat)


@router.patch("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notif = await db.get(TaNotification, notification_id)
    if not notif or notif.tenant_id != user.tenant_id:
        raise HTTPException(404, "Notificação não encontrada")
    if notif.status != "read":
        notif.status = "read"
        notif.read_at = datetime.utcnow()
        await db.commit()
        await db.refresh(notif)
    return notif


@router.patch("/{notification_id}/archive", response_model=NotificationOut)
async def archive_notification(
    notification_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notif = await db.get(TaNotification, notification_id)
    if not notif or notif.tenant_id != user.tenant_id:
        raise HTTPException(404, "Notificação não encontrada")
    notif.status = "archived"
    await db.commit()
    await db.refresh(notif)
    return notif


@router.post("/mark-all-read", response_model=dict)
async def mark_all_read(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    res = await db.execute(
        update(TaNotification)
        .where(
            TaNotification.tenant_id == user.tenant_id,
            TaNotification.status == "unread",
        )
        .values(status="read", read_at=datetime.utcnow())
    )
    await db.commit()
    return {"updated": res.rowcount or 0}

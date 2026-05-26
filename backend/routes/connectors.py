"""CRUD de conectores (canais) + provisionamento WhatsApp via Tier Engine."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt, encrypt
from models import TaAgent, TaConnector
from services import engine_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/connectors", tags=["connectors"])


class ConnectorOut(BaseModel):
    id: int
    agent_id: int
    kind: str
    enabled: bool
    config_summary: dict
    last_event_at: str | None = None

    model_config = {"from_attributes": True}


def _summary(kind: str, cfg: dict) -> dict:
    """Resumo seguro pra UI (sem expor api_key)."""
    if kind == "whatsapp":
        return {
            "instance_id": cfg.get("instance_id"),
            "phone": cfg.get("phone") or "—",
            "status": cfg.get("status") or "pending",
        }
    if kind == "telegram":
        return {"bot_username": cfg.get("bot_username") or "—"}
    return {}


def _serialize(c: TaConnector) -> dict:
    try:
        cfg = json.loads(decrypt(c.config_json_enc))
    except Exception:
        cfg = {}
    return {
        "id": c.id,
        "agent_id": c.agent_id,
        "kind": c.kind,
        "enabled": c.enabled,
        "config_summary": _summary(c.kind, cfg),
        "last_event_at": c.last_event_at.isoformat() if c.last_event_at else None,
    }


async def _ensure_agent_owned(db: AsyncSession, agent_id: int, user: CurrentUser) -> TaAgent:
    agent = await db.get(TaAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Agente não encontrado")
    if not user.is_admin and agent.tenant_id != user.tenant_id:
        raise HTTPException(403, "Agente de outro tenant")
    return agent


@router.get("")
async def list_connectors(
    agent_id: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TaConnector)
    if agent_id:
        await _ensure_agent_owned(db, agent_id, user)
        stmt = stmt.where(TaConnector.agent_id == agent_id)
    else:
        # Lista todos do tenant: join com agent
        if not user.tenant_id:
            return []
        stmt = stmt.join(TaAgent, TaAgent.id == TaConnector.agent_id).where(
            TaAgent.tenant_id == user.tenant_id
        )
    result = await db.execute(stmt.order_by(TaConnector.id.desc()))
    return [_serialize(c) for c in result.scalars().all()]


class WhatsAppProvisionIn(BaseModel):
    agent_id: int
    label: str | None = None


@router.post("/whatsapp/provision")
async def provision_whatsapp(
    payload: WhatsAppProvisionIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria instância WhatsApp na Engine + grava TaConnector."""
    agent = await _ensure_agent_owned(db, payload.agent_id, user)
    label = payload.label or f"tier-agent-{agent.tenant_id}-{agent.id}"

    try:
        instance = await engine_client.create_instance(agent.tenant_id, label)
    except engine_client.EngineError as e:
        raise HTTPException(502, f"Tier Engine: {e}")

    # Tier Engine retorna { id, apiKey } (camelCase Fastify)
    instance_id = instance.get("id") or instance.get("instance_id")
    api_key = instance.get("apiKey") or instance.get("api_key")
    if not instance_id or not api_key:
        raise HTTPException(502, f"Engine não retornou instance_id/api_key: {instance}")

    cfg = {
        "instance_id": instance_id,
        "api_key": api_key,
        "label": label,
        "status": "pending",
    }

    # Upsert connector
    existing = await db.execute(
        select(TaConnector).where(
            TaConnector.agent_id == agent.id, TaConnector.kind == "whatsapp"
        )
    )
    conn = existing.scalar_one_or_none()
    if conn:
        conn.config_json_enc = encrypt(json.dumps(cfg))
        conn.enabled = True
    else:
        conn = TaConnector(
            agent_id=agent.id, kind="whatsapp", config_json_enc=encrypt(json.dumps(cfg)), enabled=True
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return _serialize(conn)


@router.post("/{connector_id}/connect")
async def connect(
    connector_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Inicia pairing + retorna QR code (base64)."""
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    await _ensure_agent_owned(db, conn.agent_id, user)

    cfg = json.loads(decrypt(conn.config_json_enc))
    try:
        await engine_client.connect_instance(cfg["instance_id"], cfg["api_key"])
        # QR pode demorar 1-2s — busca em endpoint separado
        qr_result = {}
        try:
            qr_result = await engine_client.get_qr(cfg["instance_id"], cfg["api_key"])
        except engine_client.EngineError:
            pass
    except engine_client.EngineError as e:
        raise HTTPException(502, f"Tier Engine: {e}")
    return {
        "qr_code": qr_result.get("qr") or qr_result.get("qrCode") or qr_result.get("qr_code"),
        "status": qr_result.get("status") or "pending",
    }


@router.get("/{connector_id}/status")
async def status(
    connector_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    await _ensure_agent_owned(db, conn.agent_id, user)

    cfg = json.loads(decrypt(conn.config_json_enc))
    try:
        result = await engine_client.get_status(cfg["instance_id"], cfg["api_key"])
    except engine_client.EngineError as e:
        raise HTTPException(502, f"Tier Engine: {e}")

    # Atualiza status local se mudou
    new_status = result.get("status") or "unknown"
    new_phone = result.get("phoneNumber") or result.get("phone") or cfg.get("phone")
    if new_status != cfg.get("status") or new_phone != cfg.get("phone"):
        cfg["status"] = new_status
        cfg["phone"] = new_phone
        conn.config_json_enc = encrypt(json.dumps(cfg))
        await db.commit()

    qr = result.get("qr") or result.get("qrCode") or result.get("qr_code")
    # Se status pending mas QR não veio inline, busca dedicado
    if not qr and new_status in {"pending", "qr", "connecting"}:
        try:
            qr_result = await engine_client.get_qr(cfg["instance_id"], cfg["api_key"])
            qr = qr_result.get("qr") or qr_result.get("qrCode")
        except engine_client.EngineError:
            pass

    return {"status": new_status, "phone": new_phone, "qr_code": qr}


@router.post("/{connector_id}/disconnect")
async def disconnect(
    connector_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    await _ensure_agent_owned(db, conn.agent_id, user)

    cfg = json.loads(decrypt(conn.config_json_enc))
    try:
        await engine_client.disconnect_instance(cfg["instance_id"], cfg["api_key"])
    except engine_client.EngineError as e:
        raise HTTPException(502, f"Tier Engine: {e}")
    cfg["status"] = "disconnected"
    conn.config_json_enc = encrypt(json.dumps(cfg))
    conn.enabled = False
    await db.commit()
    return {"status": "disconnected"}


@router.delete("/{connector_id}", status_code=204)
async def delete_connector(
    connector_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    await _ensure_agent_owned(db, conn.agent_id, user)

    try:
        cfg = json.loads(decrypt(conn.config_json_enc))
        if cfg.get("instance_id"):
            await engine_client.delete_instance(cfg["instance_id"])
    except Exception as e:
        logger.warning("delete engine instance falhou: %s", e)

    await db.delete(conn)
    await db.commit()

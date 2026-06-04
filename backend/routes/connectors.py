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
    """Resumo seguro pra UI (NUNCA expor api_key/token)."""
    if kind == "whatsapp":
        return {
            "instance_id": cfg.get("instance_id"),
            "phone": cfg.get("phone") or "—",
            "status": cfg.get("status") or "pending",
            "tipo": "WhatsApp (Baileys)",
        }
    if kind == "whatsapp_cloud":
        return {
            "phone": cfg.get("phone") or cfg.get("display_phone") or "—",
            "phone_number_id": cfg.get("phone_number_id"),
            "waba_id": cfg.get("waba_id"),
            # Cloud não pareia (OAuth): tem token => conectado
            "status": "connected" if cfg.get("token") else "pending",
            "tipo": "WhatsApp Cloud API (oficial)",
        }
    if kind == "telegram":
        return {"bot_username": cfg.get("bot_username") or "—", "tipo": "Telegram"}
    if kind == "email":
        return {"email": cfg.get("email") or "—", "tipo": "E-mail"}
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
    """Inicia pairing + retorna QR code (base64).

    Se a instância atual já está conectada, retorna sem recriar. Caso contrário
    **reprovisiona uma instância fresca** antes de gerar o QR — uma sessão Baileys
    nova sempre devolve um QR válido que pareia de primeira. Reusar a instância
    antiga (sessão expirada/meio-pareada) faz a Engine servir um QR velho que não
    conecta ("não foi possível conectar o dispositivo"). É o mesmo comportamento
    do Tier Empresas, que cria instância nova a cada tentativa de pairing.
    """
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    agent = await _ensure_agent_owned(db, conn.agent_id, user)

    cfg = json.loads(decrypt(conn.config_json_enc))

    # Já conectado? Não recria — devolve direto.
    if cfg.get("instance_id") and cfg.get("api_key"):
        try:
            st = await engine_client.get_status(cfg["instance_id"], cfg["api_key"])
            if (st.get("status") or "").lower() in ("connected", "open"):
                return {"qr_code": None, "status": "connected"}
        except engine_client.EngineError:
            # Instância sumiu/stale na Engine — segue pro reprovisionamento.
            pass

    old_instance_id = cfg.get("instance_id")
    old_api_key = cfg.get("api_key")
    label = cfg.get("label") or f"tier-agent-{agent.tenant_id}-{agent.id}"

    # Instância FRESCA → socket Baileys novo → QR que pareia de primeira.
    try:
        instance = await engine_client.create_instance(agent.tenant_id, label)
    except engine_client.EngineError as e:
        raise HTTPException(502, f"Tier Engine: {e}")

    instance_id = instance.get("id") or instance.get("instance_id")
    api_key = instance.get("apiKey") or instance.get("api_key")
    if not instance_id or not api_key:
        raise HTTPException(502, f"Engine não retornou instance_id/api_key: {instance}")

    cfg.update({"instance_id": instance_id, "api_key": api_key, "label": label, "status": "pending"})
    conn.config_json_enc = encrypt(json.dumps(cfg))
    conn.enabled = True
    await db.commit()

    # Descarta a instância antiga (best-effort — não bloqueia o pairing novo).
    if old_instance_id and old_instance_id != instance_id:
        try:
            if old_api_key:
                await engine_client.disconnect_instance(old_instance_id, old_api_key)
        except engine_client.EngineError:
            pass
        try:
            await engine_client.delete_instance(old_instance_id)
        except engine_client.EngineError:
            pass

    try:
        await engine_client.connect_instance(instance_id, api_key)
        # QR pode demorar 1-2s — busca em endpoint separado
        qr_result = {}
        try:
            qr_result = await engine_client.get_qr(instance_id, api_key)
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


class WhatsAppCloudOnboardIn(BaseModel):
    """Payload do Embedded Signup: o FB SDK devolve `code` + waba_id + phone_number_id."""

    agent_id: int
    code: str
    waba_id: str
    phone_number_id: str


@router.post("/whatsapp-cloud/onboard")
async def onboard_whatsapp_cloud(
    payload: WhatsAppCloudOnboardIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Núcleo do Embedded Signup (API oficial Meta).

    1. Troca o `code` do Facebook Login for Business por um **token permanente**
       (Business Integration System User token) — não expira como o temporário.
    2. Assina o app na WABA do cliente (webhook passa a chegar pro Tier).
    3. Cria/atualiza o conector `whatsapp_cloud` ligado ao agente.

    O cliente paga as próprias mensagens (WABA dele) → Tier sem responsabilidade
    financeira. Requer App Review aprovado (Advanced Access) pra clientes reais.
    """
    import os

    import httpx

    agent = await _ensure_agent_owned(db, payload.agent_id, user)

    app_id = os.environ.get("WHATSAPP_CLOUD_APP_ID")
    app_secret = os.environ.get("WHATSAPP_CLOUD_APP_SECRET")
    if not app_id or not app_secret:
        raise HTTPException(500, "WHATSAPP_CLOUD_APP_ID/APP_SECRET não configurados")

    graph = "https://graph.facebook.com/v21.0"

    # 1. code -> token permanente (Business Integration System User token)
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.get(
            f"{graph}/oauth/access_token",
            params={"client_id": app_id, "client_secret": app_secret, "code": payload.code},
        )
    if r.status_code >= 400:
        raise HTTPException(502, f"Falha trocando code por token: {r.text[:300]}")
    token = r.json().get("access_token")
    if not token:
        raise HTTPException(502, f"Token não retornado: {r.text[:200]}")

    # 2. assina o app na WABA do cliente (pra receber os webhooks de mensagem)
    try:
        async with httpx.AsyncClient(timeout=30) as cli:
            await cli.post(
                f"{graph}/{payload.waba_id}/subscribed_apps",
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception as e:
        logger.warning("subscribe WABA falhou (segue): %s", e)

    # 3. upsert conector whatsapp_cloud
    cfg = {
        "phone_number_id": payload.phone_number_id,
        "token": token,
        "waba_id": payload.waba_id,
    }
    existing = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == agent.id, TaConnector.kind == "whatsapp_cloud"
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.config_json_enc = encrypt(json.dumps(cfg))
        existing.enabled = True
        conn = existing
    else:
        conn = TaConnector(
            agent_id=agent.id,
            kind="whatsapp_cloud",
            config_json_enc=encrypt(json.dumps(cfg)),
            enabled=True,
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    logger.info("whatsapp-cloud onboard ok agent=%s waba=%s", agent.id, payload.waba_id)
    return _serialize(conn)


class GenericSetupIn(BaseModel):
    agent_id: int
    kind: str  # 'telegram' | 'email' | 'instagram'
    config: dict  # campos específicos por kind (bot_token / smtp_* / page_access_token+ig_user_id)
    enabled: bool = True


@router.post("/generic", response_model=ConnectorOut, status_code=201)
async def setup_generic_connector(
    payload: GenericSetupIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria/atualiza conector genérico (Telegram/Email/Instagram).

    Valida config via adapter.validate_config() antes de persistir.
    Se já existe um conector do mesmo kind+agent, atualiza config.
    """
    kind = (payload.kind or "").strip().lower()
    allowed = {"telegram", "email", "instagram"}
    if kind not in allowed:
        raise HTTPException(400, f"kind deve ser um de: {sorted(allowed)}")

    await _ensure_agent_owned(db, payload.agent_id, user)

    from services.connectors import registry as conn_registry
    from services.connectors.base import ConnectorConfig

    try:
        adapter = conn_registry.get(kind)
    except Exception:
        raise HTTPException(400, f"Adapter '{kind}' não registrado")

    # Valida config (cada adapter implementa validate_config)
    try:
        ok = await adapter.validate_config(ConnectorConfig(data=payload.config))
    except Exception as e:
        raise HTTPException(400, f"Validação falhou: {e}")
    if not ok:
        raise HTTPException(400, f"Config '{kind}' inválida (credenciais ou campos faltando)")

    # Upsert por (agent_id, kind)
    from sqlalchemy import select as _sel

    existing = (
        await db.execute(
            _sel(TaConnector).where(
                TaConnector.agent_id == payload.agent_id,
                TaConnector.kind == kind,
            )
        )
    ).scalar_one_or_none()

    cfg_enc = encrypt(json.dumps(payload.config))
    if existing:
        existing.config_json_enc = cfg_enc
        existing.enabled = payload.enabled
        conn_out = existing
    else:
        conn_out = TaConnector(
            agent_id=payload.agent_id,
            kind=kind,
            config_json_enc=cfg_enc,
            enabled=payload.enabled,
        )
        db.add(conn_out)
    await db.commit()
    await db.refresh(conn_out)
    return conn_out


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

"""CRUD de conectores (canais) + provisionamento WhatsApp via Tier Engine."""

import json
import logging
import re as _re
import secrets as _secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.config import get_settings
from core.db import get_db
from core.encryption import decrypt, encrypt
from models import TaAgent, TaConnector, TaNotification
from services import engine_client

logger = logging.getLogger(__name__)
settings = get_settings()

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
            "oficial": False,
            "transporte": "Tier WhatsApp Engine (Baileys / WhatsApp Web)",
            "host": "whats.tier.finance",
            "webhook": "https://api-agent.tier.finance/api/v1/webhooks/whatsapp-engine",
            "pareamento": "QR Code (vincula como aparelho)",
        }
    if kind == "whatsapp_cloud":
        return {
            "phone": cfg.get("phone") or cfg.get("display_phone") or "—",
            "phone_number_id": cfg.get("phone_number_id"),
            "waba_id": cfg.get("waba_id"),
            # Cloud não pareia (OAuth): tem token => conectado. Respeita um
            # status explícito (ex: "disconnected" gravado no /disconnect).
            "status": cfg.get("status") or ("connected" if cfg.get("token") else "pending"),
            "tipo": "WhatsApp Cloud API (oficial)",
            "oficial": True,
            "transporte": "Meta Graph API v21.0",
            "host": "graph.facebook.com",
            "webhook": "Meta → webhook oficial (Cloud API)",
            "pareamento": "Login Facebook / Embedded Signup (sem QR)",
            "janela": "Janela 24h: texto livre dentro; fora, só template aprovado",
            "tem_token": bool(cfg.get("token")),
        }
    if kind == "webchat":
        slug = str(cfg.get("slug") or "")
        return {
            "tipo": "Demonstração (link público)",
            # Não pareia com nada: existindo o link, ele responde. Só sai do ar
            # no /disconnect, que grava status explícito e desliga o conector.
            "status": cfg.get("status") or "connected",
            "slug": slug,
            "url": _url_publica(slug) if slug else "—",
            "transporte": "Página pública no próprio domínio",
            "pareamento": "Nenhum — basta abrir o link",
        }
    if kind == "telegram":
        return {"bot_username": cfg.get("bot_username") or "—", "tipo": "Telegram"}
    if kind == "email":
        return {"email": cfg.get("email") or "—", "tipo": "E-mail"}
    if kind == "instagram":
        return {
            "tipo": "Instagram Direct",
            "conta": cfg.get("username") or cfg.get("ig_user_id") or "—",
            "ig_user_id": cfg.get("ig_user_id"),
            # Não pareia: tendo token e a página assinada nos eventos, responde.
            "status": cfg.get("status") or ("connected" if cfg.get("page_access_token") else "pending"),
            "oficial": True,
            "transporte": "Meta Graph API",
            "webhook": "Callback única do app da Tier (roteada pelo ID da conta)",
            "pareamento": "Token da página (sem QR)",
            "janela": "Janela 24h: só dá pra responder até 24h da última mensagem da pessoa",
            "eventos_assinados": bool(cfg.get("subscribed_at")),
        }
    if kind == "slack":
        return {"tipo": "Slack", "team": cfg.get("team") or cfg.get("team_id") or "—"}
    if kind == "discord":
        return {
            "tipo": "Discord",
            "bot": cfg.get("bot_username") or "—",
            "transporte": "Gateway (websocket)",
        }
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


# Canais "traga sua chave" conectáveis pelo form genérico (token → valida → cria).
_TOKEN_CHANNELS = {"slack", "telegram", "discord", "instagram"}
# Permissões do convite Discord: View Channels + Send + Read History + Embed + Attach + Reactions.
_DISCORD_INVITE_PERMS = 117824


class ConnectorCreateIn(BaseModel):
    agent_id: int
    kind: str
    config: dict


@router.post("", status_code=201)
async def create_connector(
    payload: ConnectorCreateIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria um conector 'traga sua chave' (Slack, Telegram) a partir de kind + config.

    Valida as credenciais no adapter ANTES de salvar. Retorna o conector + a URL de
    webhook que o usuário configura no app do canal."""
    agent = await _ensure_agent_owned(db, payload.agent_id, user)
    kind = (payload.kind or "").strip().lower()
    if kind not in _TOKEN_CHANNELS:
        raise HTTPException(400, f"Canal não suportado por este fluxo. Use: {sorted(_TOKEN_CHANNELS)}")
    # Slack: o Signing Secret é OBRIGATÓRIO — o webhook autentica cada evento com ele
    # (sem ele qualquer um forja um POST pro connector_id e queima LLM / injeta prompt).
    if kind == "slack" and not str((payload.config or {}).get("signing_secret") or "").strip():
        raise HTTPException(400, "Slack exige o Signing Secret (autentica os eventos do webhook).")
    # Instagram: os dois campos vêm do painel da Meta e o webhook resolve o
    # conector pelo ig_user_id — sem ele a mensagem chega e não acha o agente.
    if kind == "instagram":
        cfg_in = payload.config or {}
        if not str(cfg_in.get("page_access_token") or "").strip():
            raise HTTPException(400, "Instagram exige o token de acesso da página (page_access_token).")
        if not str(cfg_in.get("ig_user_id") or "").strip():
            raise HTTPException(400, "Instagram exige o ID da conta profissional (ig_user_id).")

    from services.connectors import registry
    from services.connectors.base import ConnectorConfig

    try:
        impl = registry.get(kind)
        cfg_val = ConnectorConfig(data=payload.config or {})
        # Adapter que sabe explicar a falha (Instagram) devolve o motivo: "confira o
        # token" é resposta errada quando o token está certo e o que falta é Advanced
        # Access nas permissões do app — manda quem depura pro lugar errado.
        diagnosticar = getattr(impl, "diagnosticar", None)
        if diagnosticar is not None:
            ok, motivo = await diagnosticar(cfg_val)
        else:
            ok = await impl.validate_config(cfg_val)
            motivo = "Credenciais inválidas — confira o token."
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Falha ao validar credenciais: {e}")
    if not ok:
        raise HTTPException(400, motivo or "Credenciais inválidas — confira o token.")

    cfg = dict(payload.config or {})
    # Discord: guarda a identidade do bot (id vira client_id do convite; username pro resumo).
    if kind == "discord":
        from services.connectors.adapters.discord import DiscordConnector

        ident = await DiscordConnector().get_bot_identity(cfg.get("bot_token") or "")
        if ident:
            cfg["bot_id"] = ident.get("id")
            cfg["bot_username"] = ident.get("username")

    # Instagram: assina a página nos eventos. Sem isso a Meta NÃO entrega nada —
    # é o modo de falha "conectou, validou e nunca chega mensagem".
    if kind == "instagram":
        assinar = getattr(impl, "assinar_webhook", None)
        if assinar is not None:
            assinou, motivo_assinatura = await assinar(ConnectorConfig(data=cfg))
            if not assinou:
                raise HTTPException(400, motivo_assinatura)
            from datetime import datetime as _dt

            cfg["subscribed_at"] = _dt.utcnow().isoformat()

    # Reconectar a MESMA conta atualiza o conector em vez de criar outro: com dois
    # conectores do mesmo ig_user_id, resolve_connector_by_instance devolve um
    # qualquer (não há ORDER BY) e metade das mensagens iria pro token velho.
    conn = None
    if kind == "instagram":
        ig_novo = str(cfg.get("ig_user_id") or "").strip()
        existentes = (
            await db.execute(
                select(TaConnector).where(
                    TaConnector.agent_id == agent.id, TaConnector.kind == "instagram"
                )
            )
        ).scalars().all()
        for c in existentes:
            try:
                if str((json.loads(decrypt(c.config_json_enc)) or {}).get("ig_user_id") or "") == ig_novo:
                    conn = c
                    break
            except Exception:  # noqa: BLE001
                continue

    if conn is not None:
        conn.config_json_enc = encrypt(json.dumps(cfg))
        conn.enabled = True
    else:
        conn = TaConnector(
            agent_id=agent.id,
            kind=kind,
            config_json_enc=encrypt(json.dumps(cfg)),
            enabled=True,
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)

    out = _serialize(conn)
    base = "https://api-agent.tier.finance/api/v1/webhooks"
    if kind == "slack":
        out["webhook_url"] = f"{base}/slack/{conn.id}"
    elif kind == "telegram":
        token = (payload.config or {}).get("bot_token") or ""
        bot_id = token.split(":")[0] if ":" in token else ""
        out["webhook_url"] = f"{base}/telegram/{bot_id}" if bot_id else None
    elif kind == "instagram":
        # URL FIXA e informativa: a Meta só aceita UMA Callback URL + UM Verify
        # Token por objeto `instagram`, no App Dashboard do app da Tier — e não
        # tem override por conta como o WhatsApp. Quem configura isso é a Tier,
        # uma vez; o cliente não cola nada. O roteamento sai do entry[].id.
        out["webhook_url"] = f"{base}/instagram"
        out["webhook_gerenciado"] = True
    elif kind == "discord":
        # Discord é Gateway (sem webhook). Devolve o convite pra adicionar o bot ao servidor.
        bid = cfg.get("bot_id")
        if bid:
            out["invite_url"] = (
                f"https://discord.com/oauth2/authorize?client_id={bid}"
                f"&scope=bot&permissions={_DISCORD_INVITE_PERMS}"
            )
        out["bot_username"] = cfg.get("bot_username")
        out["gateway"] = True
    return out


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
    # Cloud API (Meta) não tem instância na Engine — devolve status local (sem QR).
    if conn.kind == "whatsapp_cloud" or not cfg.get("instance_id"):
        st = cfg.get("status") or ("connected" if cfg.get("token") else "pending")
        return {"status": st, "phone": cfg.get("display_phone") or cfg.get("phone"), "qr_code": None}
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
    # Baileys tem instância remota na Engine pra encerrar; Cloud API (Meta) não.
    # LOGOUT, não disconnect: disconnect só fecha o socket e o vigia da Engine
    # religa a sessão — a instância vira zumbi e continua recebendo mensagem sem
    # conector (e, pareada no mesmo número de outro tenant, rouba a entrega dele
    # via dedupe — incidente 31/08). Desconectou no painel = sessão apagada.
    if conn.kind == "whatsapp" and cfg.get("instance_id"):
        try:
            await engine_client.logout_instance(cfg["instance_id"], cfg["api_key"])
        except engine_client.EngineError:
            # fallback: pelo menos derruba o socket se o logout não estiver disponível
            try:
                await engine_client.disconnect_instance(cfg["instance_id"], cfg["api_key"])
            except engine_client.EngineError as e:
                raise HTTPException(502, f"Tier Engine: {e}") from e
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


@router.post("/generic", status_code=201)
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

    cfg = dict(payload.config or {})

    # Segredo do webhook: gerado uma vez e PRESERVADO no update — se mudasse a
    # cada save, a URL que o cliente configurou no provedor parava de funcionar.
    campo_segredo = {"email": "webhook_secret"}.get(kind)
    if campo_segredo:
        anterior = ""
        if existing:
            try:
                anterior = str(
                    (json.loads(decrypt(existing.config_json_enc)) or {}).get(campo_segredo) or ""
                ).strip()
            except Exception:  # noqa: BLE001
                anterior = ""
        if not str(cfg.get(campo_segredo) or "").strip():
            cfg[campo_segredo] = anterior or _secrets.token_urlsafe(24)

    cfg_enc = encrypt(json.dumps(cfg))
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

    out = _serialize(conn_out)
    base = "https://api-agent.tier.finance/api/v1/webhooks"
    if kind == "email":
        # A URL só serve com o token: é ele que autentica o POST do provedor.
        out["webhook_url"] = f"{base}/email/{conn_out.id}?token={cfg['webhook_secret']}"
    elif kind == "instagram":
        out["webhook_url"] = f"{base}/instagram"
        out["webhook_gerenciado"] = True
    elif kind == "telegram":
        token = str(cfg.get("bot_token") or "")
        bot_id = token.split(":")[0] if ":" in token else ""
        out["webhook_url"] = f"{base}/telegram/{bot_id}" if bot_id else None
    return out


# ============================================================
# Webchat — canal de DEMONSTRAÇÃO (link público, sem canal externo)
# ============================================================
_SLUG_RE = _re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")


class WebchatSetupIn(BaseModel):
    agent_id: int
    slug: str
    titulo: str | None = None
    subtitulo: str | None = None
    saudacao: str | None = None
    cor: str | None = None
    logo_url: str | None = None
    rodape: str | None = None
    sugestoes: list[str] = []
    pede_contato: bool = False
    limite_dia: int = 500
    enabled: bool = True


def _url_publica(slug: str) -> str:
    base = (getattr(settings, "public_app_url", None) or "https://agent.tier.finance").rstrip("/")
    return f"{base}/c/{slug}"


@router.post("/webchat", status_code=201)
async def setup_webchat(
    payload: WebchatSetupIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria/atualiza o link público de demonstração de um agente.

    O slug é global (é o caminho da URL), então a checagem de duplicidade olha
    TODOS os conectores webchat, não só os do tenant.
    """
    slug = (payload.slug or "").strip().lower()
    if not _SLUG_RE.match(slug):
        raise HTTPException(
            400,
            "Slug inválido. Use letras minúsculas, números e hífen (ex: escola-ccda).",
        )

    await _ensure_agent_owned(db, payload.agent_id, user)

    from sqlalchemy import select as _sel

    todos = (await db.execute(_sel(TaConnector).where(TaConnector.kind == "webchat"))).scalars().all()

    meu = None
    for conn in todos:
        try:
            cfg_existente = json.loads(decrypt(conn.config_json_enc))
        except Exception:
            continue
        if conn.agent_id == payload.agent_id:
            meu = conn
        elif str(cfg_existente.get("slug") or "") == slug:
            raise HTTPException(409, f"O endereço '{slug}' já está em uso por outro agente.")

    cfg = {
        "slug": slug,
        "titulo": (payload.titulo or "").strip() or None,
        "subtitulo": (payload.subtitulo or "").strip() or None,
        "saudacao": (payload.saudacao or "").strip() or None,
        "cor": (payload.cor or "").strip() or None,
        "logo_url": (payload.logo_url or "").strip() or None,
        "rodape": (payload.rodape or "").strip() or None,
        "sugestoes": [s.strip() for s in (payload.sugestoes or []) if s and s.strip()][:6],
        "pede_contato": bool(payload.pede_contato),
        "limite_dia": max(1, int(payload.limite_dia or 500)),
    }

    cfg_enc = encrypt(json.dumps(cfg))
    if meu:
        meu.config_json_enc = cfg_enc
        meu.enabled = payload.enabled
        conn_out = meu
    else:
        conn_out = TaConnector(
            agent_id=payload.agent_id,
            kind="webchat",
            config_json_enc=cfg_enc,
            enabled=payload.enabled,
        )
        db.add(conn_out)
    await db.commit()
    await db.refresh(conn_out)

    return {
        "id": conn_out.id,
        "agent_id": conn_out.agent_id,
        "enabled": conn_out.enabled,
        "config": cfg,
        "url": _url_publica(slug),
    }


@router.get("/webchat/{agent_id}")
async def get_webchat(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Config atual do link de demonstração do agente (ou `configurado: false`)."""
    await _ensure_agent_owned(db, agent_id, user)

    from sqlalchemy import select as _sel

    conn = (
        await db.execute(_sel(TaConnector).where(TaConnector.agent_id == agent_id, TaConnector.kind == "webchat"))
    ).scalar_one_or_none()

    if not conn:
        return {"configurado": False}

    try:
        cfg = json.loads(decrypt(conn.config_json_enc))
    except Exception:
        cfg = {}

    return {
        "configurado": True,
        "id": conn.id,
        "enabled": conn.enabled,
        "config": cfg,
        "url": _url_publica(str(cfg.get("slug") or "")),
    }


@router.delete("/{connector_id}", status_code=204)
async def delete_connector(
    connector_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise HTTPException(404, "Conector não encontrado")
    agent = await _ensure_agent_owned(db, conn.agent_id, user)

    try:
        cfg = json.loads(decrypt(conn.config_json_enc))
    except Exception:
        cfg = {}
    kind = conn.kind
    phone = cfg.get("phone") or cfg.get("phone_number_id") or "—"
    inst = cfg.get("instance_id")

    # Só deleta a instância no Engine se NENHUM outro conector a usa — evita
    # derrubar um número COMPARTILHADO (ex: DevSecOps reusa a instância dos alertas).
    if inst:
        shared = False
        others = (await db.execute(select(TaConnector).where(TaConnector.id != conn.id))).scalars().all()
        for o in others:
            try:
                if json.loads(decrypt(o.config_json_enc)).get("instance_id") == inst:
                    shared = True
                    break
            except Exception:
                continue
        if shared:
            logger.info("instância %s compartilhada — NÃO deletada do Engine (preserva o número)", inst)
        else:
            try:
                await engine_client.delete_instance(inst)
            except Exception as e:
                logger.warning("delete engine instance falhou: %s", e)

    await db.delete(conn)

    # 🔔 Alerta de deleção — canal nunca some calado (lição: conector Cloud apagado
    # levou o token junto e ninguém soube). Defensivo: nunca bloqueia o delete.
    try:
        db.add(
            TaNotification(
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                category="connector_deleted",
                queue="config",
                title=f"Canal removido: {kind} ({phone})",
                body=f"O conector {kind} do agente '{agent.nome}' (tel {phone}) foi removido. Se foi sem querer, reconecte em Canais.",
                payload_json={"connector_id": connector_id, "kind": kind, "phone": phone, "agent_id": agent.id},
            )
        )
    except Exception:
        logger.exception("falha ao criar notificação de deleção de conector")

    await db.commit()
    logger.warning("CONNECTOR DELETADO id=%s kind=%s agent=%s phone=%s", connector_id, kind, agent.id, phone)

"""Integração Tier Empresas (ERP) ↔ Tier Agent — provisiona/linka tenant + SSO.

O ERP chama estes endpoints backend-to-backend, autenticado por shared secret
(`TIER_ERP_INTEGRATION_SECRET`, env nos 2 lados). Fase 3 do inbox federado:
  1. /provision → cria-ou-linka 1 TaTenant por empresa (idempotente por CNPJ/email).
  2. /sso       → emite um JWT de sessão (Bearer) pro tenant linkado, sem 2º login.

🔒 Bearer (NÃO cookie) de propósito: o cookie `tier_session` colide entre ERP e Agent
(mesmo nome, `.tier.finance`, secrets diferentes) — usar Bearer evita sobrescrever a
sessão do ERP. O secret vive só no backend dos 2 lados, nunca no browser.
"""
from __future__ import annotations

import hmac
import json

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_token
from core.config import get_settings
from core.db import get_db
from core.encryption import decrypt
from models import TaAgent, TaConnector, TaTenant
from services.connectors import registry
from services.connectors.base import ConnectorConfig

router = APIRouter(prefix="/integrations/tier", tags=["integrations-tier"])
settings = get_settings()


def _check_secret(secret: str | None) -> None:
    expected = settings.tier_erp_integration_secret or ""
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Integração ERP não configurada")
    if not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Secret inválido")


def _digits(s: str | None) -> str | None:
    if not s:
        return None
    d = "".join(c for c in s if c.isdigit())
    return d or None


# ─── Disparo ativo via WhatsApp Cloud API (oficial) — chamado pelo worker de disparos do ERP ───
async def _resolve_cloud_connector(db: AsyncSession, tenant_id: int, agent_id: int | None = None) -> TaConnector:
    """Acha o conector whatsapp_cloud ATIVO do tenant (via agente). Base do disparo Cloud."""
    q = (
        select(TaConnector)
        .join(TaAgent, TaConnector.agent_id == TaAgent.id)
        .where(
            TaAgent.tenant_id == tenant_id,
            TaConnector.kind == "whatsapp_cloud",
            TaConnector.enabled.is_(True),
        )
    )
    if agent_id:
        q = q.where(TaConnector.agent_id == agent_id)
    conn = (await db.execute(q)).scalars().first()
    if not conn:
        raise HTTPException(status.HTTP_409_CONFLICT, "tenant sem canal WhatsApp Oficial (Cloud) ativo")
    return conn


@router.get("/whatsapp-cloud/templates")
async def cloud_templates(
    tenant_id: int,
    agent_id: int | None = None,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Lista os templates APROVADOS da WABA do tenant (pro disparo ativo via Cloud API)."""
    _check_secret(x_tier_integration_secret)
    conn = await _resolve_cloud_connector(db, tenant_id, agent_id)
    impl = registry.get("whatsapp_cloud")
    cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
    try:
        templates = await impl.list_templates(cfg)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"falha ao listar templates: {e}")
    return {"templates": templates, "connector_id": conn.id}


class CloudSendTemplateIn(BaseModel):
    tenant_id: int
    to: str
    template_name: str
    lang: str = "pt_BR"
    components: list | None = None
    agent_id: int | None = None


@router.post("/whatsapp-cloud/send-template")
async def cloud_send_template(
    body: CloudSendTemplateIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Envia 1 template aprovado pra um número (disparo ATIVO via Cloud API oficial).
    O worker de disparos do ERP chama isto por contato."""
    _check_secret(x_tier_integration_secret)
    to = (body.to or "").strip()
    if not to or not body.template_name:
        raise HTTPException(422, "to e template_name são obrigatórios")
    conn = await _resolve_cloud_connector(db, body.tenant_id, body.agent_id)
    impl = registry.get("whatsapp_cloud")
    cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
    try:
        res = await impl.send_template(cfg, to, body.template_name, body.lang, body.components)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"falha ao enviar template: {e}")
    msg_id = None
    try:
        msg_id = (res.get("messages") or [{}])[0].get("id")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "message_id": msg_id, "raw": res}


class ProvisionIn(BaseModel):
    nome: str
    email: str
    cnpj: str | None = None


class ProvisionOut(BaseModel):
    tenant_id: int
    created: bool


@router.post("/provision", response_model=ProvisionOut)
async def provision_tenant(
    payload: ProvisionIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Cria-ou-linka 1 tenant do Agent pra uma empresa do ERP. Idempotente por CNPJ → email."""
    _check_secret(x_tier_integration_secret)
    cnpj = _digits(payload.cnpj)

    tenant: TaTenant | None = None
    if cnpj:
        tenant = (await db.execute(select(TaTenant).where(TaTenant.cnpj == cnpj))).scalar_one_or_none()
    if not tenant:
        tenant = (await db.execute(select(TaTenant).where(TaTenant.email == payload.email))).scalar_one_or_none()
    if tenant:
        return ProvisionOut(tenant_id=tenant.id, created=False)

    tenant = TaTenant(nome=payload.nome, email=payload.email, cnpj=cnpj, sku="trial", status="active")
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return ProvisionOut(tenant_id=tenant.id, created=True)


class SsoIn(BaseModel):
    tenant_id: int
    email: str | None = None


class SsoOut(BaseModel):
    access_token: str
    tenant_id: int
    expires_in_hours: int


@router.post("/sso", response_model=SsoOut)
async def sso_mint(
    payload: SsoIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Emite um JWT de sessão (owner) pro tenant linkado. O ERP embute o inbox com este Bearer."""
    _check_secret(x_tier_integration_secret)
    tenant = await db.get(TaTenant, payload.tenant_id)
    if not tenant or tenant.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant não encontrado ou inativo")
    token = create_token(
        str(tenant.id),
        {"tenant_id": tenant.id, "email": payload.email or tenant.email, "role": "owner"},
    )
    return SsoOut(access_token=token, tenant_id=tenant.id, expires_in_hours=settings.jwt_ttl_hours)


# ─── QA de Ligações (CRM do ERP) — reusa o motor do Agent ─────────────────────
# O tier-finance chama estes 2 endpoints (mesmo shared secret) pra:
#   /transcribe   → faster-whisper self-host (grátis, sem tenant — motor global)
#   /llm-complete → LLM DO TENANT (provider por cliente) rodando 1 prompt → texto
# Assim o QA de Ligações não sobe worker de STT novo nem paga API: reusa o que já roda.


class TranscribeIn(BaseModel):
    audio_url: str
    language: str = "pt"


class TranscribeOut(BaseModel):
    ok: bool
    text: str
    duration_seconds: float | None = None
    language: str | None = None
    error: str | None = None


@router.post("/transcribe", response_model=TranscribeOut)
async def transcribe_audio(
    payload: TranscribeIn,
    x_tier_integration_secret: str | None = Header(default=None),
):
    """STT self-host (faster-whisper) pro ERP. Sem tenant — motor global grátis."""
    _check_secret(x_tier_integration_secret)
    from services.voice import whisper_local

    res = await whisper_local.transcribe_url(payload.audio_url, language=payload.language)
    return TranscribeOut(
        ok=bool(res.ok),
        text=res.text or "",
        duration_seconds=getattr(res, "duration_seconds", None),
        language=getattr(res, "language", None),
        error=getattr(res, "error", None),
    )


class LlmCompleteIn(BaseModel):
    tenant_id: int
    prompt: str
    system: str | None = None


class LlmCompleteOut(BaseModel):
    text: str
    model_used: str | None = None


@router.post("/llm-complete", response_model=LlmCompleteOut)
async def llm_complete(
    payload: LlmCompleteIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Roda 1 prompt no LLM DO TENANT (provider por cliente) → devolve texto.

    Usado pelo QA de Ligações do ERP pra pontuar a transcrição contra o roteiro.
    Sem cache (cada ligação é única). Se o tenant não tem LLM ativa → 502 (o ERP
    faz fallback pro AgentOptimus).
    """
    _check_secret(x_tier_integration_secret)
    tenant = await db.get(TaTenant, payload.tenant_id)
    if not tenant or tenant.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant não encontrado ou inativo")
    from services import tier_engine

    try:
        reply = await tier_engine.send_message(
            payload.tenant_id,
            payload.prompt,
            db,
            system_override=payload.system,
            use_cache=False,
        )
    except Exception as e:  # noqa: BLE001 — inclui ProvidersAllDisabled (tenant sem LLM)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"LLM do tenant falhou: {e}") from e
    return LlmCompleteOut(text=reply.text or "", model_used=getattr(reply, "model_used", None))


# ─── Histórico de conversa para a aba Conversas do card do CRM (ERP lê daqui) ───
@router.get("/conversas/{conversa_id}/mensagens")
async def conversa_mensagens(
    conversa_id: int,
    agent_tenant_id: int,
    limite: int = 200,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Transcrição de uma conversa, para o card do CRM mostrar o histórico.

    O ERP guarda só o ponteiro da conversa; as mensagens vivem aqui e continuam
    chegando depois que o card nasce — por isso ele lê ao vivo em vez de receber
    uma cópia no momento do envio.

    🔒 `agent_tenant_id` não é enfeite: sem conferir que a conversa pertence ao
    tenant que pediu, o shared secret viraria chave-mestra para ler a conversa de
    qualquer cliente pelo id. O secret prova que é o ERP; o tenant prova de quem.
    """
    _check_secret(x_tier_integration_secret)

    from models import TaConversation, TaMessageLog

    conv = await db.get(TaConversation, conversa_id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")

    agent_ids = [
        r[0] for r in (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == agent_tenant_id))).all()
    ]
    if conv.agent_id not in agent_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conversa de outro tenant")

    msgs = (
        await db.execute(
            select(TaMessageLog)
            .where(TaMessageLog.conversation_id == conversa_id)
            .order_by(TaMessageLog.id.asc())
            .limit(max(1, min(limite, 500)))
        )
    ).scalars().all()

    return {
        "conversa": {
            "id": conv.id,
            "canal": conv.connector_kind,
            "contato_nome": conv.contact_name,
            "contato_externo": conv.external_id,
            "status": conv.status,
            "total_mensagens": conv.msg_count,
            "ultima_mensagem_em": conv.last_message_at.isoformat() if conv.last_message_at else None,
        },
        "mensagens": [
            {
                "id": m.id,
                "papel": m.role,
                "texto": m.content,
                "em": m.created_at.isoformat() if m.created_at else None,
                "anexos": m.attachments_json or [],
            }
            for m in msgs
        ],
    }

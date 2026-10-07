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
from models import TaAgent, TaConnector, TaMember, TaTenant
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
    # Etapa 3 do caminho A (09/09/2026): a PESSOA por trás da sessão do ERP.
    # Sem `owner_id` o comportamento é o antigo (token de dono) — caller legado.
    owner_id: str | None = None
    nome: str | None = None
    role: str | None = None  # admin | atendente (o ERP deriva do cargo)


class SsoOut(BaseModel):
    access_token: str
    tenant_id: int
    expires_in_hours: int
    member_id: int | None = None
    role: str = "owner"


async def _membro_do_erp(db: AsyncSession, tenant: TaTenant, payload: SsoIn) -> TaMember:
    """Acha (ou cria) o membro que É esta pessoa do ERP. O ERP é a fonte de nome e
    papel: a cada entrada os dois são reaplicados. O e-mail precisa ser único na
    tabela inteira — a mesma pessoa pode estar em dois tenants (Marcos está na
    conta de teste e na escola), então quando o e-mail real já pertence a outro
    membro, este ganha um e-mail sintético; ele nunca faz login por senha mesmo."""
    role = "admin" if (payload.role or "").strip() == "admin" else "atendente"
    nome = (payload.nome or payload.email or "Membro do ERP").strip()[:120]
    row = await db.execute(
        select(TaMember).where(TaMember.tenant_id == tenant.id, TaMember.erp_owner_id == payload.owner_id)
    )
    member = row.scalars().first()
    reatado = False
    email_erp = (payload.email or "").strip().lower()
    if member is None and email_erp:
        # A mesma pessoa, apagada e criada de novo no ERP (owner_id novo, e-mail igual):
        # é o MESMO membro aqui — reatado ao owner novo e reativado, com o histórico
        # dela. Só vale para membro que já veio do ERP; membro nativo (senha) não é tocado.
        row = await db.execute(
            select(TaMember).where(
                TaMember.tenant_id == tenant.id, TaMember.email == email_erp, TaMember.erp_owner_id.isnot(None)
            )
        )
        member = row.scalars().first()
        if member is not None:
            member.erp_owner_id, reatado = payload.owner_id, True
    if member:
        mudou = reatado
        if member.nome != nome:
            member.nome, mudou = nome, True
        if member.role != role:
            member.role, mudou = role, True
        if member.status != "active":
            member.status, mudou = "active", True
        if mudou:
            await db.commit()
        return member
    email = (payload.email or "").strip().lower()
    if email:
        dono_do_email = (await db.execute(select(TaMember).where(TaMember.email == email))).scalars().first()
        if dono_do_email is not None:
            email = ""
    if not email:
        email = f"sso-{tenant.id}-{str(payload.owner_id)[:8]}@erp.tier.finance"
    member = TaMember(
        tenant_id=tenant.id, nome=nome, email=email, password_hash=None, role=role, status="active",
        erp_owner_id=payload.owner_id,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.post("/sso", response_model=SsoOut)
async def sso_mint(
    payload: SsoIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Emite um JWT de sessão pro tenant linkado. O ERP embute o inbox com este Bearer.

    Com `owner_id` (Etapa 3): a sessão é da PESSOA — token de membro, com o papel
    que o ERP mandou. Sem: token de dono, como sempre foi.
    """
    _check_secret(x_tier_integration_secret)
    tenant = await db.get(TaTenant, payload.tenant_id)
    if not tenant or tenant.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant não encontrado ou inativo")
    if payload.owner_id:
        member = await _membro_do_erp(db, tenant, payload)
        token = create_token(
            str(tenant.id),
            {
                "tenant_id": tenant.id, "email": member.email, "role": member.role,
                "member_id": member.id, "member_name": member.nome,
            },
        )
        return SsoOut(
            access_token=token, tenant_id=tenant.id, expires_in_hours=settings.jwt_ttl_hours,
            member_id=member.id, role=member.role,
        )
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


class DesligarMembroIn(BaseModel):
    tenant_id: int
    owner_id: str


@router.post("/members/desligar")
async def desligar_membro(
    payload: DesligarMembroIn,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """O ERP removeu a pessoa da equipe: aqui ela é desativada e os números dela
    ficam sem dona (o próximo a atender por eles é outra pessoa). A sessão dela
    morre na próxima requisição (checagem de status no auth). O histórico fica."""
    _check_secret(x_tier_integration_secret)
    row = await db.execute(
        select(TaMember).where(TaMember.tenant_id == payload.tenant_id, TaMember.erp_owner_id == payload.owner_id)
    )
    member = row.scalars().first()
    if member is None:
        return {"ok": True, "member_id": None, "numeros_desvinculados": 0}
    member.status = "disabled"
    member.online = False
    conns = (await db.execute(select(TaConnector).where(TaConnector.member_id == member.id))).scalars().all()
    for c in conns:
        c.member_id = None
    await db.commit()
    return {"ok": True, "member_id": member.id, "numeros_desvinculados": len(conns)}


@router.get("/metricas-atendimento")
async def metricas_atendimento(
    agent_tenant_id: int,
    days: int = 30,
    x_tier_integration_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Etapa 4 do caminho A (09/09/2026): as métricas de atendimento (por pessoa e por
    número) para o Dashboard do ERP — definidas UMA vez, aqui, e lidas de lá.

    🔒 O secret prova que é o ERP; `agent_tenant_id` diz de quem, e escopa tudo."""
    _check_secret(x_tier_integration_secret)
    from services import metricas_atendimento as svc

    return await svc.calcular(db, agent_tenant_id, max(1, min(days, 365)))


class TranscribeIn(BaseModel):
    audio_url: str
    language: str = "pt"


class TranscribeOut(BaseModel):
    ok: bool
    text: str
    duration_seconds: float | None = None
    language: str | None = None
    error: str | None = None
    # Trechos com tempo ({inicio, fim, texto}) quando o motor souber informar —
    # hoje o whisper local sabe. Campo opcional de propósito: quem não usa
    # (QA de Ligações) ignora, e nenhum caller antigo quebra.
    segments: list[dict] | None = None


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
        segments=getattr(res, "segments", None),
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
    """Histórico do CONTATO desta conversa, para o card do CRM.

    O ERP guarda só o ponteiro de uma conversa; as mensagens vivem aqui e continuam
    chegando depois que o card nasce — por isso ele lê ao vivo em vez de receber
    uma cópia no momento do envio.

    07/10/2026 — o ponteiro é a PORTA, não o limite: a mesma família fala com o
    número da IA e com o celular de cada consultora (modo registro), e cada número
    é uma conversa. Devolve as mensagens de TODAS as conversas do mesmo contato no
    tenant, em ordem, com o número por onde cada uma andou e quem falou do nosso
    lado. As `limite` mais RECENTES — num card, o que importa é onde a conversa está.
    Os campos de antes continuam iguais; os novos só se somam.

    🔒 `agent_tenant_id` não é enfeite: sem conferir que a conversa pertence ao
    tenant que pediu, o shared secret viraria chave-mestra para ler a conversa de
    qualquer cliente pelo id. O secret prova que é o ERP; o tenant prova de quem.
    E a busca pelo contato fica DENTRO do tenant.
    """
    _check_secret(x_tier_integration_secret)

    from datetime import datetime

    from sqlalchemy import or_

    from models import TaConversation, TaMessageLog
    from services import historico_contato as hc
    from services import numeros as numeros_svc

    conv = await db.get(TaConversation, conversa_id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")

    agentes = {
        a.id: a.nome
        for a in (await db.execute(select(TaAgent).where(TaAgent.tenant_id == agent_tenant_id))).scalars().all()
    }
    if conv.agent_id not in agentes:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conversa de outro tenant")

    # Todas as conversas do mesmo contato, por qualquer número do tenant.
    chave = hc.chave_do_contato(conv.external_id, conv.connector_kind)
    cond = TaConversation.id == conv.id
    if chave:
        cond = or_(cond, TaConversation.external_id == conv.external_id, TaConversation.external_id.like(f"{chave}%"))
    candidatas = (
        await db.execute(select(TaConversation).where(TaConversation.agent_id.in_(list(agentes)), cond))
    ).scalars().all()
    conversas = [
        c for c in candidatas
        if c.id == conv.id or hc.mesmo_contato(conv.external_id, conv.connector_kind, c.external_id, c.connector_kind)
    ]
    ids = [c.id for c in conversas]

    n = max(1, min(limite, 500))
    msgs = list(
        reversed(
            (
                await db.execute(
                    select(TaMessageLog)
                    .where(TaMessageLog.conversation_id.in_(ids))
                    .order_by(TaMessageLog.created_at.desc(), TaMessageLog.id.desc())
                    .limit(n)
                )
            ).scalars().all()
        )
    )

    # Rótulo do número e nome das pessoas — um decrypt por conector, uma busca de membros.
    numeros = {x["id"]: x for x in await numeros_svc.numeros_do_tenant(db, agent_tenant_id)}
    membro_ids = {m.member_id for m in msgs if m.member_id} | {
        numeros[c.connector_id]["member_id"] for c in conversas
        if c.connector_id in numeros and numeros[c.connector_id].get("member_id")
    }
    nomes = (
        {
            r[0]: r[1]
            for r in (
                await db.execute(select(TaMember.id, TaMember.nome).where(TaMember.id.in_(membro_ids)))
            ).all()
        }
        if membro_ids
        else {}
    )
    por_id = {c.id: c for c in conversas}

    def _numero(c) -> dict:
        return (numeros.get(c.connector_id) or {}) if c.connector_id else {}

    ultima = max((c.last_message_at for c in conversas if c.last_message_at), default=None)
    return {
        "conversa": {
            "id": conv.id,
            "canal": conv.connector_kind,
            "contato_nome": conv.contact_name or next((c.contact_name for c in conversas if c.contact_name), None),
            "contato_externo": conv.external_id,
            "status": conv.status,
            "total_mensagens": sum(c.msg_count or 0 for c in conversas),
            "ultima_mensagem_em": ultima.isoformat() if ultima else None,
        },
        "conversas": [
            {
                "id": c.id,
                "numero": _numero(c).get("rotulo"),
                "modo": _numero(c).get("modo"),
                "dona": nomes.get(_numero(c).get("member_id")),
                "status": c.status,
                "total_mensagens": c.msg_count,
                "ultima_mensagem_em": c.last_message_at.isoformat() if c.last_message_at else None,
            }
            for c in sorted(conversas, key=lambda c: (c.started_at or datetime.min, c.id))
        ],
        "mensagens": [
            {
                "id": m.id,
                "papel": m.role,
                "texto": m.content,
                "em": m.created_at.isoformat() if m.created_at else None,
                "anexos": m.attachments_json or [],
                "conversa_id": m.conversation_id,
                "numero": _numero(por_id[m.conversation_id]).get("rotulo"),
                "quem": hc.quem_falou(m.role, nomes.get(m.member_id), agentes.get(por_id[m.conversation_id].agent_id)),
            }
            for m in msgs
        ],
    }

"""Endpoints INTERNOS serviço-a-serviço (nunca expostos a usuário final).

A2 — `POST /internal/proactive-whatsapp`: envio proativo de WhatsApp por tenant
(lembrete de visita agendada, etc — outra frente consome este contrato).

Auth: header `X-Internal-Key` == env `AGENT_INTERNAL_KEY`.
- env ausente/vazia → 503 (feature dormente, seguro por padrão)
- chave errada/ausente no request → 401

Body: `{"tenant_id": int, "telefone": "5511999999999" (dígitos, com DDI), "texto": str}`.
Acha o connector `whatsapp` habilitado de um agente ativo do tenant (mesma mecânica do
`_send_proactive` do scheduler, via `services.proactive`), monta o JID
`{telefone}@s.whatsapp.net` e envia. 200 `{"sucesso": true}` · 404 sem connector ·
502 falha de envio · 429 acima de 30 envios/min por tenant (memória local).

Se já existir conversa com esse chat, a mensagem é registrada em `TaMessageLog`
(role=assistant) pra aparecer no histórico da inbox; senão, só envia.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db
from models import TaConversation, TaMessageLog
from services import proactive

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["internal"])


class ProactiveWhatsAppIn(BaseModel):
    tenant_id: int
    telefone: str = Field(min_length=1, description="Dígitos, com DDI (ex.: 5511999999999)")
    texto: str = Field(min_length=1)
    # Opcional: manda UMA mensagem com a imagem e o texto como legenda (não duas).
    # Usado pelo lembrete de visita do CRM, que ilustra com o logo da conta.
    imagem_url: str | None = Field(default=None, max_length=500)
    # Opcional (07/10/2026, automação «enviar WhatsApp» do CRM): POR QUAL número sai.
    # Sem ele, vale o de sempre — o primeiro número de agente ativo do tenant, que
    # pode ser o celular de uma consultora. Com ele, sai por aquele número (inclusive
    # número em registro: quem escolheu foi uma pessoa, na regra) e a mensagem entra
    # na conversa — a secretaria vê a resposta da família no inbox.
    connector_id: int | None = None
    # Rótulo de quem mandou, no inbox (ex.: «Automação do CRM»).
    origem: str | None = Field(default=None, max_length=60)


async def _conector_escolhido(db: AsyncSession, tenant_id: int, connector_id: int):
    from models import TaAgent, TaConnector

    conn = await db.get(TaConnector, connector_id)
    if not conn or conn.kind != "whatsapp" or not conn.enabled:
        raise HTTPException(404, "número escolhido não existe ou não é WhatsApp conectado por QR")
    agente = await db.get(TaAgent, conn.agent_id)
    if not agente or agente.tenant_id != tenant_id:
        raise HTTPException(404, "número escolhido não é deste tenant")
    return conn


async def _enviar_e_registrar(db: AsyncSession, conn, external_chat_id: str, texto: str, origem: str | None) -> bool:
    """Envio pelo número escolhido: manda, carimba o eco (no registro o Baileys
    devolve o envio como `fromMe` e ele entraria de novo) e grava na conversa —
    abrindo-a se for a primeira mensagem, para a resposta da família cair nela."""
    import json as _json

    from core.encryption import decrypt
    from services import agent_runtime
    from services.connectors import registry
    from services.connectors.base import ConnectorConfig, OutboundMessage

    try:
        impl = registry.get(conn.kind)
        cfg = ConnectorConfig(data=_json.loads(decrypt(conn.config_json_enc)))
        resultado = await impl.send(cfg, OutboundMessage(external_chat_id=external_chat_id, content=texto))
    except Exception:  # noqa: BLE001
        logger.exception("proactive: envio pelo numero escolhido falhou connector=%s", conn.id)
        return False
    await proactive.marcar_eco_do_envio(db, conn, resultado)
    try:
        registro = (getattr(conn, "modo", None) or "agente") == "registro"
        conv = await agent_runtime.ensure_conversation(
            db, agent_id=conn.agent_id, connector_kind=conn.kind, external_id=external_chat_id,
            connector_id=conn.id, por_numero=registro,
        )
        db.add(
            TaMessageLog(
                conversation_id=conv.id, role="assistant", content=texto[:8000],
                model_used=(origem or "Mensagem automática")[:60],
            )
        )
        conv.msg_count = (conv.msg_count or 0) + 1
        conv.last_message_at = datetime.utcnow()
        await db.commit()
    except Exception:  # noqa: BLE001 — a mensagem JÁ saiu; o histórico é melhor esforço
        logger.exception("proactive: registro no historico falhou connector=%s", conn.id)
    return True


@router.post("/proactive-whatsapp")
async def proactive_whatsapp(
    body: ProactiveWhatsAppIn,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    if not settings.agent_internal_key:
        raise HTTPException(503, "AGENT_INTERNAL_KEY não configurada — endpoint desativado")
    if not x_internal_key or not hmac.compare_digest(x_internal_key, settings.agent_internal_key):
        raise HTTPException(401, "internal key inválida")

    telefone = proactive.normalize_phone(body.telefone)
    if not telefone:
        raise HTTPException(422, "telefone inválido — envie só dígitos, com DDI (ex.: 5511999999999)")
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(422, "texto é obrigatório")

    if not proactive.check_rate_limit(body.tenant_id):
        raise HTTPException(429, f"rate limit: máx {proactive.RATE_MAX_PER_MIN} envios/min por tenant")

    if body.connector_id:
        escolhido = await _conector_escolhido(db, body.tenant_id, body.connector_id)
        chat = f"{telefone}@s.whatsapp.net"
        if not await _enviar_e_registrar(db, escolhido, chat, texto, body.origem):
            raise HTTPException(502, "falha ao enviar a mensagem no WhatsApp")
        return {"sucesso": True, "connector_id": escolhido.id}

    conn = await proactive.find_tenant_whatsapp_connector(db, body.tenant_id)
    if not conn:
        raise HTTPException(404, "tenant sem connector whatsapp habilitado em agente ativo")

    external_chat_id = f"{telefone}@s.whatsapp.net"
    imagem_url = (body.imagem_url or "").strip() or None
    # Só http(s): a URL vai direto pro Engine baixar. Valor estranho vira envio
    # de texto puro — a mensagem sair importa mais que a ilustração.
    if imagem_url and not imagem_url.lower().startswith(("http://", "https://")):
        logger.warning("proactive: imagem_url ignorada (esquema inválido) tenant=%s", body.tenant_id)
        imagem_url = None
    ok = await proactive.send_text_via_connector(conn, external_chat_id, texto, imagem_url=imagem_url)
    if not ok and imagem_url:
        # A imagem pode ter derrubado o envio (URL fora do ar, formato recusado
        # pelo Engine). Reenvia como texto: o lembrete é o que não pode faltar.
        logger.warning("proactive: envio com imagem falhou, refazendo sem imagem tenant=%s", body.tenant_id)
        ok = await proactive.send_text_via_connector(conn, external_chat_id, texto)
    if not ok:
        raise HTTPException(502, "falha ao enviar a mensagem no WhatsApp")

    # Registro no histórico SÓ se já existir conversa com esse chat (contrato do A2).
    # Best-effort: a mensagem JÁ saiu — falha aqui não pode virar erro pro caller.
    try:
        conv = (
            (
                await db.execute(
                    select(TaConversation)
                    .where(
                        TaConversation.agent_id == conn.agent_id,
                        TaConversation.connector_kind == conn.kind,
                        TaConversation.external_id == external_chat_id,
                    )
                    .order_by(TaConversation.id.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if conv:
            db.add(TaMessageLog(conversation_id=conv.id, role="assistant", content=texto[:8000]))
            await db.commit()
    except Exception:
        logger.exception(
            "proactive-whatsapp: log em TaMessageLog falhou tenant=%s chat=%s (mensagem já enviada)",
            body.tenant_id,
            external_chat_id,
        )

    return {"sucesso": True}

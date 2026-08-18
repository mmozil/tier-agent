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

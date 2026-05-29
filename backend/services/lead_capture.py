"""Captura de lead — detecta intenção de compra / contato no atendimento e
registra um lead como TaNotification(category="lead", queue="vendas").

Objetivo: nenhuma demonstração/oportunidade se perde. Quando o cliente
demonstra interesse claro (quer contratar/agendar/demonstração) ou informa um
telefone, criamos um lead que aparece no inbox de notificações da equipe.

Não bloqueia nem quebra o fluxo de resposta — é chamado em try/except depois
que a resposta já foi enviada.
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaNotification

logger = logging.getLogger(__name__)

# Telefone BR: aceita +55, DDD com/sem parênteses, 8-9 dígitos. Extrai e valida
# por contagem de dígitos (10 a 13) pra evitar falso positivo (datas, valores).
_PHONE_RE = re.compile(r"(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]?\d{4}")

# Sinais fortes de intenção de compra na mensagem DO CLIENTE.
_INTENT_KEYWORDS = (
    "quero contratar",
    "contratar",
    "quero assinar",
    "assinar",
    "quero agendar",
    "agendar",
    "demonstra",  # demonstração / demonstracao / demo
    "tenho interesse",
    "quero o plano",
    "quero comprar",
    "fechar negócio",
    "fechar negocio",
    "como faço para contratar",
    "como faco para contratar",
    "quero uma reunião",
    "quero uma reuniao",
)


def extract_phone(text: str | None) -> str | None:
    """Retorna o primeiro telefone BR plausível (só dígitos) ou None."""
    if not text:
        return None
    for m in _PHONE_RE.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        if 10 <= len(digits) <= 13:
            return digits
    return None


def has_buying_intent(text: str | None) -> bool:
    if not text:
        return False
    low = text.lower()
    return any(kw in low for kw in _INTENT_KEYWORDS)


async def maybe_capture_lead(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int | None,
    conversation_id: int | None,
    external_chat_id: str,
    sender_name: str | None,
    user_text: str,
) -> bool:
    """Cria um lead se houver telefone informado OU intenção clara de compra.

    Deduplica por conversa: 1 lead por conversa (não recria a cada mensagem).
    Retorna True se criou um lead novo.
    """
    phone_typed = extract_phone(user_text)
    intent = has_buying_intent(user_text)
    if not phone_typed and not intent:
        return False

    # Dedup: já existe lead pra esta conversa?
    if conversation_id is not None:
        existing = (
            await db.execute(
                select(TaNotification.id).where(
                    TaNotification.conversation_id == conversation_id,
                    TaNotification.category == "lead",
                )
            )
        ).first()
        if existing:
            return False

    # O WhatsApp do cliente (external_chat_id) já é um contato; o telefone digitado
    # é um extra. Preferimos o telefone digitado, com fallback pro WhatsApp.
    contato_tel = phone_typed or re.sub(r"\D", "", external_chat_id or "")
    nome = sender_name or "Lead WhatsApp"
    title = f"Novo lead: {nome}"

    notif = TaNotification(
        tenant_id=tenant_id,
        agent_id=agent_id,
        conversation_id=conversation_id,
        category="lead",
        queue="vendas",
        title=title,
        body=(user_text or "")[:1000],
        payload_json={
            "contato": sender_name,
            "telefone": contato_tel,
            "telefone_informado": phone_typed,
            "whatsapp": external_chat_id,
            "intencao_compra": intent,
            "mensagem": (user_text or "")[:2000],
        },
        status="unread",
    )
    db.add(notif)
    await db.commit()
    logger.info(
        "lead capturado tenant=%s agent=%s conv=%s tel=%s intent=%s",
        tenant_id, agent_id, conversation_id, contato_tel, intent,
    )
    return True

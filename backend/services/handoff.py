"""Transferência para humano (handoff).

Quando o cliente pede para falar com uma pessoa/atendente, criamos uma
notificação (category="handoff", fila "atendimento") para a equipe e
respondemos com uma confirmação — sem acionar o LLM (curto-circuito).

Aparece na mesma tela de Leads & Notificações.
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaNotification

logger = logging.getLogger(__name__)

# Mensagem de confirmação enviada ao cliente quando pede atendente humano.
HANDOFF_REPLY = (
    "Claro! Já avisei nossa equipe e um de nossos atendentes vai falar com você "
    "por aqui. O time atende de segunda a sexta, das 9h às 18h. "
    "Posso ajudar em mais alguma coisa enquanto isso?"
)

# Padrões que indicam pedido explícito de falar com um humano.
_HUMAN_PATTERNS = (
    r"falar com (um |uma )?(humano|atendente|pessoa|consultor|vendedor|gerente|algu[ée]m)",
    r"falar com o (suporte|time|atendimento|comercial|vendas)",
    r"quero (um |uma )?(humano|atendente|pessoa de verdade)",
    r"atendimento humano",
    r"pessoa de verdade",
    r"me transfere",
    r"transferir.*(atendente|humano|pessoa|setor)",
    r"chama(r)? (um |uma )?(humano|atendente|pessoa)",
)
_HUMAN_RE = re.compile("|".join(_HUMAN_PATTERNS), re.IGNORECASE)


def wants_human(text: str | None) -> bool:
    """True se a mensagem do cliente pede explicitamente um atendente humano."""
    if not text:
        return False
    return bool(_HUMAN_RE.search(text))


async def create_handoff(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int | None,
    conversation_id: int | None,
    external_chat_id: str,
    sender_name: str | None,
    user_text: str,
) -> bool:
    """Cria uma notificação de handoff (dedup: 1 não-lida por conversa).

    Retorna True se criou uma notificação nova.
    """
    if conversation_id is not None:
        existing = (
            await db.execute(
                select(TaNotification.id).where(
                    TaNotification.conversation_id == conversation_id,
                    TaNotification.category == "handoff",
                    TaNotification.status == "unread",
                )
            )
        ).first()
        if existing:
            return False

    nome = sender_name or "Cliente"
    notif = TaNotification(
        tenant_id=tenant_id,
        agent_id=agent_id,
        conversation_id=conversation_id,
        category="handoff",
        queue="atendimento",
        title=f"Atendimento humano solicitado: {nome}",
        body=(user_text or "")[:1000],
        payload_json={
            "contato": sender_name,
            "whatsapp": external_chat_id,
            "telefone": re.sub(r"\D", "", external_chat_id or ""),
            "mensagem": (user_text or "")[:2000],
        },
        status="unread",
    )
    db.add(notif)
    await db.commit()
    logger.info(
        "handoff criado tenant=%s agent=%s conv=%s contato=%s",
        tenant_id, agent_id, conversation_id, external_chat_id,
    )
    return True

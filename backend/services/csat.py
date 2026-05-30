"""CSAT — pesquisa de satisfação pós-atendimento.

Ao resolver uma conversa, o agente pergunta uma nota de 0 a 5 no canal. A próxima
resposta numérica do cliente é capturada como score (sem passar pelo LLM) e o
agente agradece. Vira base pro relatório de atendimento.

Fluxo:
- resolve → `csat_state='pending'` + envia a pergunta
- inbound seguinte → `maybe_capture_csat` pega o número 0-5, grava, agradece
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaConversation

logger = logging.getLogger(__name__)

CSAT_QUESTION = (
    "Antes de encerrar 🙏 — de 0 a 5, como você avalia o nosso atendimento? "
    "(é só responder com o número)"
)
CSAT_THANKS = "Obrigado pela avaliação! Sua opinião ajuda a gente a melhorar. 💙"

# número isolado de 0 a 5 (aceita "5", "nota 5", "5!", "dou 4")
_SCORE_RE = re.compile(r"\b([0-5])\b")


def extract_score(text: str | None) -> int | None:
    if not text:
        return None
    # ignora se a mensagem é claramente longa (provável dúvida, não nota)
    if len(text.strip()) > 40:
        return None
    m = _SCORE_RE.search(text)
    return int(m.group(1)) if m else None


async def maybe_capture_csat(
    db: AsyncSession, *, agent_id: int, external_chat_id: str, text: str
) -> str | None:
    """Se houver uma conversa aguardando CSAT desse contato e a mensagem for um
    número 0-5, grava o score e retorna o texto de agradecimento. Senão None."""
    conv = (
        await db.execute(
            select(TaConversation)
            .where(
                TaConversation.agent_id == agent_id,
                TaConversation.external_id == external_chat_id,
                TaConversation.csat_state == "pending",
            )
            .order_by(TaConversation.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not conv:
        return None
    score = extract_score(text)
    if score is None:
        return None
    from datetime import datetime

    conv.csat_score = score
    conv.csat_state = "done"
    conv.csat_at = datetime.utcnow()
    await db.commit()
    logger.info("csat capturado agent=%s conv=%s score=%s", agent_id, conv.id, score)
    return CSAT_THANKS

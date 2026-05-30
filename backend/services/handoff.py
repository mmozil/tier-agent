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

from models import TaConversation, TaNotification

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


_TITLE_BY_REASON = {
    "explicit_request": "Atendimento humano solicitado",
    "frustration": "Cliente insatisfeito — atenção",
    "repeated_loop": "Conversa travada — possível loop",
    "manual": "Conversa assumida pela equipe",
}


async def create_handoff(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int | None,
    conversation_id: int | None,
    external_chat_id: str,
    sender_name: str | None,
    user_text: str,
    reason: str = "explicit_request",
    summary: str | None = None,
    pause: bool = True,
) -> bool:
    """Cria notificação de handoff (dedup: 1 não-lida por conversa), opcionalmente
    pausa o bot (status handed_off) e dispara o alerta externo pra equipe.

    - `reason`: explicit_request | frustration | repeated_loop | manual
    - `pause`: True pausa a IA (humano assume). Frustração/loop alertam SEM pausar.
    Retorna True se criou uma notificação nova.
    """
    created = True
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
            created = False

    nome = sender_name or "Cliente"
    titulo = f"{_TITLE_BY_REASON.get(reason, 'Atendimento humano')}: {nome}"

    if created:
        notif = TaNotification(
            tenant_id=tenant_id,
            agent_id=agent_id,
            conversation_id=conversation_id,
            category="handoff",
            queue="atendimento",
            title=titulo,
            body=(summary or user_text or "")[:2000],
            payload_json={
                "contato": sender_name,
                "whatsapp": external_chat_id,
                "telefone": re.sub(r"\D", "", external_chat_id or ""),
                "mensagem": (user_text or "")[:2000],
                "reason": reason,
                "resumo": summary,
            },
            status="unread",
        )
        db.add(notif)

    # Pausa o bot: humano assume a conversa (não responde mais automaticamente)
    # + distribui pra um atendente online (fila/round-robin), se houver.
    if pause and conversation_id is not None:
        conv = await db.get(TaConversation, conversation_id)
        if conv and conv.status != "handed_off":
            conv.status = "handed_off"
        if conv and not conv.assigned_member_id:
            try:
                from services import assignment

                await assignment.auto_assign(db, conv, tenant_id)
            except Exception:
                logger.exception("auto_assign falhou conv=%s", conversation_id)

    await db.commit()
    logger.info(
        "handoff tenant=%s agent=%s conv=%s reason=%s pause=%s created=%s",
        tenant_id, agent_id, conversation_id, reason, pause, created,
    )

    # Alerta externo pra equipe (WhatsApp/e-mail) — só pra notificação nova.
    if created:
        try:
            from services import team_alert

            await team_alert.dispatch_team_alert(
                db,
                tenant_id=tenant_id,
                agent_id=agent_id,
                category="handoff" if reason in ("explicit_request", "manual") else reason,
                title=titulo,
                summary=summary,
            )
        except Exception:
            logger.exception("team_alert no handoff falhou tenant=%s", tenant_id)

    return created

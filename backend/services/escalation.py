"""Escalonamento inteligente — sinais que indicam que um humano deve ser avisado.

Inspirado no padrão das referências de mercado (Intercom Fin, Chatwoot, Respond.io):
os melhores sistemas combinam vários gatilhos — pedido explícito, frustração/
sentimento, loop sem resolução — e entregam um "warm handoff" com um pacote de
contexto (resumo + transcript + fatos do contato) para o atendente assumir já
sabendo do que se trata.

Este módulo NÃO envia mensagem nem cria notificação — só detecta sinais e monta
o resumo. Quem orquestra é o agent_runtime (decide pausar o bot ou só alertar) e
o handoff.create_handoff (persiste a notificação + dispara o alerta externo).

Política (espelha as referências):
- pedido explícito de humano  → handoff + PAUSA o bot (humano assume)
- frustração / sentimento ruim → ALERTA o time, mas o bot continua tentando ajudar
- loop sem resolução          → ALERTA o time, bot continua
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaMessageLog

logger = logging.getLogger(__name__)

# Motivos canônicos de escalonamento (gravados no payload da notificação).
REASON_EXPLICIT = "explicit_request"
REASON_FRUSTRATION = "frustration"
REASON_LOOP = "repeated_loop"
REASON_MANUAL = "manual"

REASON_LABELS = {
    REASON_EXPLICIT: "Cliente pediu atendente humano",
    REASON_FRUSTRATION: "Cliente demonstrou insatisfação",
    REASON_LOOP: "Conversa sem resolução (possível loop)",
    REASON_MANUAL: "Assumido manualmente pela equipe",
}


# ─────────────────────────────────────────────────────────────
# Frustração / sentimento negativo
# ─────────────────────────────────────────────────────────────
# Sinais FORTES de insatisfação em pt-BR. Conservador de propósito: sentimento
# como gatilho sozinho gera falso positivo (ref: usar como "multiplicador"). Aqui
# exigimos termos inequívocos de raiva, reclamação ou ameaça.
_FRUSTRATION_PATTERNS = (
    # palavrões / ofensa
    r"\b(merda|porra|caralho|pqp|p\*+|droga|lixo|porcaria|palha[çc]ada|vergonha|absurdo|rid[íi]culo|p[ée]ssimo|horr[íi]vel|nojento|in[úu]til|incompetente)\b",
    # ameaça / escalada formal
    r"\b(cancelar|cancela(r)? (tudo|o plano|a conta|o servi[çc]o)|reclama[çr]|reclama[çc][ãa]o|procon|advogad[oa]|processar|processo|denunciar|nunca mais)\b",
    # falha repetida / descaso
    r"(n[ãa]o funciona|parou de funcionar|n[ãa]o resolve[m]?|ningu[ée]m (resolve|me ajuda|responde)|j[áa] (falei|pedi|tentei).*(vez|vezes)|pela (terceira|quarta|en[ée]sima) vez|de novo (isso|isto)|t[ôo] esperando h[áa])",
    # urgência irritada
    r"(que (saco|raiva)|t[ôo] (puto|brava|bravo|irritad[oa]|cansad[oa] disso))",
)
_FRUSTRATION_RE = re.compile("|".join(_FRUSTRATION_PATTERNS), re.IGNORECASE)

# Caps-lock raivoso (≥3 palavras MAIÚSCULAS de 3+ letras) ou pontuação enfática.
_CAPS_RE = re.compile(r"\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b")
_EMPHATIC_RE = re.compile(r"[!?]{3,}")


def is_frustrated(text: str | None) -> bool:
    """True se a mensagem do cliente sinaliza insatisfação/raiva clara."""
    if not text:
        return False
    if _FRUSTRATION_RE.search(text):
        return True
    if _EMPHATIC_RE.search(text):
        return True
    # caps-lock: ≥3 palavras gritadas (ignora siglas isoladas tipo "CNPJ", "ERP")
    caps = _CAPS_RE.findall(text)
    if len(caps) >= 3:
        return True
    return False


# ─────────────────────────────────────────────────────────────
# Loop sem resolução — bot respondendo "não sei" repetidamente
# ─────────────────────────────────────────────────────────────
_FALLBACK_PATTERNS = (
    r"n[ãa]o (entendi|compreendi|sei|tenho (essa|a) informa[çc][ãa]o|consigo (ajudar|responder))",
    r"pode (reformular|repetir|explicar melhor)",
    r"n[ãa]o tenho acesso",
    r"infelizmente n[ãa]o",
    r"foge (do|ao) meu (escopo|conhecimento)",
)
_FALLBACK_RE = re.compile("|".join(_FALLBACK_PATTERNS), re.IGNORECASE)


def looks_like_fallback(text: str | None) -> bool:
    """True se a resposta do assistente é um 'não sei / não entendi'."""
    if not text:
        return False
    return bool(_FALLBACK_RE.search(text))


async def detect_loop(db: AsyncSession, conversation_id: int, current_reply: str | None) -> bool:
    """True se o bot está em loop: a resposta atual é fallback E já houve outro
    fallback do assistente recente na mesma conversa (2 'não sei' seguidos)."""
    if not looks_like_fallback(current_reply):
        return False
    rows = (
        await db.execute(
            select(TaMessageLog.content)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.role == "assistant",
                TaMessageLog.content.isnot(None),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(4)
        )
    ).all()
    prior_fallbacks = sum(1 for (c,) in rows if looks_like_fallback(c))
    # rows inclui a resposta atual (já logada); ≥2 fallbacks = loop
    return prior_fallbacks >= 2


# ─────────────────────────────────────────────────────────────
# Warm handoff — pacote de contexto pro atendente assumir
# ─────────────────────────────────────────────────────────────
async def build_context_summary(
    db: AsyncSession,
    *,
    conversation_id: int,
    reason: str,
    contact_name: str | None,
    phone: str | None,
    memory_facts: list[str] | None = None,
    max_messages: int = 12,
) -> str:
    """Monta um resumo legível: motivo + contato + fatos conhecidos + transcript
    recente. Determinístico (sem custo de LLM) — entrega contexto pro humano
    assumir em segundos. Ref: 'warm transfer com resumo supera o cold transfer'.
    """
    rows = (
        await db.execute(
            select(TaMessageLog.role, TaMessageLog.content)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.content.isnot(None),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(max_messages)
        )
    ).all()
    rows = list(reversed(rows))  # ordem cronológica

    lines: list[str] = []
    lines.append(f"⚡ Motivo: {REASON_LABELS.get(reason, reason)}")
    if contact_name:
        lines.append(f"👤 Contato: {contact_name}")
    if phone:
        lines.append(f"📱 WhatsApp: {phone}")
    if memory_facts:
        lines.append("🧠 Já sabemos sobre o cliente:")
        for f in memory_facts[:5]:
            lines.append(f"   • {f}")
    if rows:
        lines.append("💬 Últimas mensagens:")
        for role, content in rows:
            who = "Cliente" if role == "user" else "IA"
            txt = (content or "").strip().replace("\n", " ")
            if len(txt) > 220:
                txt = txt[:217] + "…"
            lines.append(f"   {who}: {txt}")
    return "\n".join(lines)

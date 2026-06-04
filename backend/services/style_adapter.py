"""Style adapter — detecta tom do contato e injeta hint pro agente espelhar.

Nas primeiras N mensagens do contato (TaConversation.msg_count <= 3),
classifica via Engine barato:
- formality: formal | casual
- pronoun: voce | tu | senhor
- emoji_use: nenhum | pouco | muito

Salva como fato em ta_contact_memory categoria=preference (importance=2).
Próximas conversas o memory.search auto-injeta no system_prompt e agente espelha.

Vantagem vs adicionar campo dedicado: reusa pgvector existente, sem schema novo.
"""

from __future__ import annotations

import json
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

STYLE_PROMPT = """Analise o tom da mensagem abaixo do cliente e retorne SÓ um JSON:
{{
  "formality": "formal" ou "casual",
  "pronoun": "voce" ou "tu" ou "senhor",
  "emoji_use": "nenhum" ou "pouco" ou "muito"
}}

Mensagem: {text}

JSON:"""


async def maybe_extract_style(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    external_chat_id: str,
    text: str,
    msg_count: int,
) -> None:
    """Extrai style nas primeiras 3 mensagens. Salva como fact em memory.

    Idempotente — se já tem fact 'tom de comunicação' pro contato, skip.
    Chamado em background pelo agent_runtime (não bloqueia resposta).
    """
    if msg_count > 3 or not text or len(text.strip()) < 10:
        return

    # Check idempotência via memory.search (se já tem fact 'tom', skip)
    try:
        from services import memory_service

        hits = await memory_service.search(
            db,
            tenant_id=tenant_id,
            agent_id=agent_id,
            external_chat_id=external_chat_id,
            query="tom de comunicação preferência estilo",
            top_k=3,
        )
        if any("tom" in (h.fact or "").lower() or "tonalidade" in (h.fact or "").lower() for h in hits):
            return
    except Exception:
        pass

    # Classifica via Engine
    try:
        from services import tier_engine

        reply = await tier_engine.send_message(
            tenant_id=tenant_id,
            user_content=STYLE_PROMPT.format(text=text[:500]),
            db=db,
            session_id=f"style-{agent_id}",
            system_override=None,
            agent_id=agent_id,
            use_cache=False,
        )
    except Exception as e:
        logger.warning("style classify falhou: %s", e)
        return

    raw = (reply.text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```\s*$", "", raw)

    try:
        style = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return
        try:
            style = json.loads(m.group(0))
        except Exception:
            return

    if not isinstance(style, dict):
        return

    formality = str(style.get("formality") or "").lower().strip()
    pronoun = str(style.get("pronoun") or "").lower().strip()
    emoji_use = str(style.get("emoji_use") or "").lower().strip()

    if formality not in {"formal", "casual"} and pronoun not in {"voce", "tu", "senhor"}:
        return

    # Monta fato em pt-BR descrevendo o tom (vai pro memory)
    parts = ["Cliente prefere atendimento"]
    if formality == "formal":
        parts.append("formal")
    elif formality == "casual":
        parts.append("informal/descontraído")
    if pronoun == "tu":
        parts.append("usando 'tu'")
    elif pronoun == "senhor":
        parts.append("usando 'senhor/senhora'")
    elif pronoun == "voce":
        parts.append("usando 'você'")
    if emoji_use == "muito":
        parts.append("com emojis frequentes")
    elif emoji_use == "nenhum":
        parts.append("sem emojis")
    fact = " ".join(parts) + "."

    # Salva direto via memory_service.add (gera embedding + INSERT)
    try:
        from services import memory_service
        from services.rag_engine import _embed_via_gemini
        from sqlalchemy import text as sql_text

        cfg = await memory_service._get_config(db, tenant_id)
        if not cfg["enabled"]:
            return

        vecs = await _embed_via_gemini([fact], task_type="RETRIEVAL_DOCUMENT")
        if not vecs or not vecs[0]:
            return

        vec_literal = "[" + ",".join(str(round(v, 6)) for v in vecs[0]) + "]"
        await db.execute(
            sql_text(
                """
                INSERT INTO ta_contact_memory
                  (tenant_id, agent_id, external_chat_id, category, fact, importance,
                   source_message_at, embedding)
                VALUES (:t, :a, :ext, 'preference', :f, 4, NOW(), (:vec)::vector)
                """
            ),
            {"t": tenant_id, "a": agent_id, "ext": external_chat_id, "f": fact, "vec": vec_literal},
        )
        await db.commit()
        logger.info("style adapted agent=%s contact=%s: %s", agent_id, external_chat_id[:20], fact)
    except Exception:
        logger.exception("style memory.add falhou")

"""Memory cross-session por contato — Mem0-like com pgvector próprio.

Cada conversa do agente com um contato (WhatsApp number, Telegram chat_id, etc)
acumula "fatos" extraídos pela LLM: preferências, eventos, perfil. Esses fatos
ficam disponíveis em conversas FUTURAS — agente "lembra do cliente".

Fluxo:
1. Mensagem inbound chega → agent_runtime busca memórias relevantes (search)
2. Memórias top-K viram context block no system prompt do Engine
3. Após resposta do Engine, extract_facts() chama LLM pra identificar info
   nova que vale guardar → embed + INSERT pgvector
4. Pruning periódico (V2): max_facts_per_contact + retention_days expira

Stack:
- pgvector vector(768) — Gemini text-embedding-004 (mesmo do RAG)
- Cosine search via HNSW index
- Extração via Engine (modelo barato — Gemini Flash padrão)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from services.rag_engine import _embed_via_gemini

logger = logging.getLogger(__name__)

DEFAULT_TOP_K = 5
EXTRACT_PROMPT = """Você extrai FATOS reutilizáveis de uma conversa pra memória de longo prazo do atendimento.

Analise a troca abaixo e retorne SÓ um JSON array de objetos com:
- "category": "preference" | "fact" | "event" | "profile"
- "fact": frase curta na 3ª pessoa em pt-BR (ex: "Cliente prefere atendimento por áudio")
- "importance": 1-5 (1 = trivial, 5 = crítico tipo alergia/preferência forte)

EXTRAIA só info DURÁVEL e PESSOAL do cliente:
- Preferências de atendimento (tom, áudio/texto, horário/turno preferido, profissional que ELE pediu).
- Restrições/saúde/comportamento (alergia, medo, temperamento do pet).
- Estilo de comunicação e contexto pessoal que vale lembrar.

🚫 NUNCA EXTRAIA (isso vem do CADASTRO/AGENDA do sistema — se virar "memória" e estiver errado, contamina toda conversa futura como verdade):
- Existência, nome, raça, porte ou QUANTIDADE de pets do cliente (o agente consulta o cadastro real).
- PREÇOS, DURAÇÃO de serviços, horários livres, ou se tal profissional atende tal pet.
- AGENDAMENTOS específicos (data/hora/profissional de um atendimento) — a agenda é a fonte da verdade.
Se esses dados aparecerem na conversa, IGNORE na extração. NUNCA invente nem deduza.

REGRAS:
- Só extrai info DURÁVEL (vale lembrar em conversa futura). Pula small-talk, saudações, dados de cadastro/agenda.
- Máximo 5 fatos por turn.
- Se nada vale a pena guardar, retorne [].

CONVERSA:
{conversation}

JSON:"""


@dataclass
class MemoryHit:
    id: int
    fact: str
    category: str
    importance: int
    created_at: datetime
    score: float


# ────────────────────────────────────────────────────────────
# Config helper
# ────────────────────────────────────────────────────────────
async def _get_config(db: AsyncSession, tenant_id: int) -> dict:
    """Retorna config do tenant (cria default se não existe)."""
    row = (
        await db.execute(
            sql_text(
                "SELECT enabled, retention_days, max_facts_per_contact, importance_threshold "
                "FROM ta_memory_config WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).first()
    if row:
        return {
            "enabled": bool(row[0]),
            "retention_days": int(row[1]),
            "max_facts_per_contact": int(row[2]),
            "importance_threshold": int(row[3]),
        }
    # Default — não cria row aqui pra não poluir DB; só cria via endpoint admin
    return {
        "enabled": True,
        "retention_days": 90,
        "max_facts_per_contact": 100,
        "importance_threshold": 2,
    }


# ────────────────────────────────────────────────────────────
# Search — busca memórias relevantes pra inbound message
# ────────────────────────────────────────────────────────────
async def search(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    external_chat_id: str,
    query: str,
    top_k: int = DEFAULT_TOP_K,
) -> list[MemoryHit]:
    """Busca top-K memórias do contato relevantes pra query."""
    query = (query or "").strip()
    if not query or not external_chat_id:
        return []

    cfg = await _get_config(db, tenant_id)
    if not cfg["enabled"]:
        return []

    try:
        q_vecs = await _embed_via_gemini([query], task_type="RETRIEVAL_QUERY")
    except Exception as e:
        logger.warning("memory.search embed falhou: %s", e)
        return []
    if not q_vecs or not q_vecs[0]:
        return []
    q_literal = "[" + ",".join(str(round(v, 6)) for v in q_vecs[0]) + "]"

    rows = (
        await db.execute(
            sql_text(
                """
                SELECT id, fact, category, importance, created_at,
                       1 - (embedding <=> (:q)::vector) AS score
                FROM ta_contact_memory
                WHERE agent_id = :aid
                  AND external_chat_id = :ext
                  AND embedding IS NOT NULL
                  AND importance >= :imp
                ORDER BY embedding <=> (:q)::vector
                LIMIT :lim
                """
            ),
            {
                "q": q_literal,
                "aid": agent_id,
                "ext": external_chat_id,
                "imp": cfg["importance_threshold"],
                "lim": top_k,
            },
        )
    ).all()

    hits = [
        MemoryHit(
            id=int(r[0]),
            fact=str(r[1]),
            category=str(r[2]),
            importance=int(r[3]),
            created_at=r[4],
            score=float(r[5] or 0),
        )
        for r in rows
    ]

    # Bump references_count + last_referenced_at em background (não bloqueia)
    if hits:
        ids = [h.id for h in hits]
        try:
            await db.execute(
                sql_text(
                    """
                    UPDATE ta_contact_memory
                    SET references_count = references_count + 1,
                        last_referenced_at = NOW()
                    WHERE id = ANY(:ids)
                    """
                ),
                {"ids": ids},
            )
            await db.commit()
        except Exception:
            logger.exception("bump references_count falhou")

    return hits


def format_for_prompt(hits: list[MemoryHit]) -> str:
    """Formata hits como bloco de contexto pro system prompt."""
    if not hits:
        return ""
    lines = ["Memória de conversas anteriores com este contato:"]
    for h in hits:
        prefix = "🔥" if h.importance >= 4 else "•"
        lines.append(f"{prefix} [{h.category}] {h.fact}")
    return "\n".join(lines)


# ────────────────────────────────────────────────────────────
# Add — extrai fatos novos via LLM + INSERT
# ────────────────────────────────────────────────────────────
async def add(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    external_chat_id: str,
    user_text: str,
    assistant_text: str,
    contact_name: str | None = None,
) -> int:
    """Extrai fatos novos da troca user→assistant e persiste. Retorna count."""
    if not user_text or not external_chat_id:
        return 0

    cfg = await _get_config(db, tenant_id)
    if not cfg["enabled"]:
        return 0

    # Monta conversa pro extractor
    parts = []
    if contact_name:
        parts.append(f"Contato: {contact_name}")
    parts.append(f"Cliente: {user_text}")
    if assistant_text:
        parts.append(f"Agente: {assistant_text}")
    conversation = "\n".join(parts)

    # Chama Engine pra extrair fatos
    try:
        from services import tier_engine

        reply = await tier_engine.send_message(
            tenant_id=tenant_id,
            user_content=EXTRACT_PROMPT.format(conversation=conversation),
            db=db,
            session_id=f"memory-extract-{agent_id}",
            system_override=None,
            agent_id=agent_id,
            use_cache=False,  # extração custom — não cacheia
        )
    except Exception as e:
        logger.warning("memory.add extract falhou: %s", e)
        return 0

    raw = (reply.text or "").strip()
    # Strip code fence se LLM mandou ```json ... ```
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```\s*$", "", raw)

    try:
        facts = json.loads(raw)
    except Exception:
        # Tenta extrair primeiro array JSON
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            return 0
        try:
            facts = json.loads(match.group(0))
        except Exception:
            return 0

    if not isinstance(facts, list) or not facts:
        return 0

    # Filtra + sanitiza
    valid_facts = []
    for f in facts[:5]:  # max 5 por turn
        if not isinstance(f, dict):
            continue
        fact_text = str(f.get("fact") or "").strip()
        if len(fact_text) < 5 or len(fact_text) > 500:
            continue
        cat = str(f.get("category") or "fact").lower()
        if cat not in {"preference", "fact", "event", "profile"}:
            cat = "fact"
        try:
            imp = max(1, min(5, int(f.get("importance", 3))))
        except (TypeError, ValueError):
            imp = 3
        valid_facts.append({"category": cat, "fact": fact_text, "importance": imp})

    if not valid_facts:
        return 0

    # Embed batch
    try:
        vecs = await _embed_via_gemini(
            [f["fact"] for f in valid_facts], task_type="RETRIEVAL_DOCUMENT"
        )
    except Exception as e:
        logger.warning("memory.add embed falhou: %s", e)
        return 0

    if len(vecs) != len(valid_facts):
        return 0

    # Dedup soft: se fact já existe textualmente, pula
    existing_texts = set(
        r[0]
        for r in (
            await db.execute(
                sql_text(
                    "SELECT fact FROM ta_contact_memory "
                    "WHERE agent_id = :aid AND external_chat_id = :ext "
                    "ORDER BY id DESC LIMIT 50"
                ),
                {"aid": agent_id, "ext": external_chat_id},
            )
        ).all()
    )

    inserted = 0
    for fact_obj, vec in zip(valid_facts, vecs):
        if fact_obj["fact"] in existing_texts:
            continue
        if not vec:
            continue
        vec_literal = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
        await db.execute(
            sql_text(
                """
                INSERT INTO ta_contact_memory
                  (tenant_id, agent_id, external_chat_id, category, fact, importance,
                   source_message_at, embedding)
                VALUES (:t, :a, :ext, :cat, :f, :imp, NOW(), (:vec)::vector)
                """
            ),
            {
                "t": tenant_id,
                "a": agent_id,
                "ext": external_chat_id,
                "cat": fact_obj["category"],
                "f": fact_obj["fact"],
                "imp": fact_obj["importance"],
                "vec": vec_literal,
            },
        )
        inserted += 1

    # Prune se passou do max
    max_facts = cfg["max_facts_per_contact"]
    await db.execute(
        sql_text(
            """
            DELETE FROM ta_contact_memory
            WHERE id IN (
                SELECT id FROM ta_contact_memory
                WHERE agent_id = :aid AND external_chat_id = :ext
                ORDER BY importance DESC, created_at DESC
                OFFSET :max
            )
            """
        ),
        {"aid": agent_id, "ext": external_chat_id, "max": max_facts},
    )

    await db.commit()
    if inserted:
        logger.info(
            "memory.add agent=%s contact=%s inserted=%s",
            agent_id, external_chat_id[:20], inserted,
        )
    return inserted


# ────────────────────────────────────────────────────────────
# Admin queries
# ────────────────────────────────────────────────────────────
async def list_for_contact(
    db: AsyncSession,
    *,
    agent_id: int,
    external_chat_id: str,
    limit: int = 100,
) -> list[dict]:
    """Lista memórias salvas pra um contato. Usado no painel admin."""
    rows = (
        await db.execute(
            sql_text(
                """
                SELECT id, fact, category, importance, references_count,
                       created_at, last_referenced_at
                FROM ta_contact_memory
                WHERE agent_id = :aid AND external_chat_id = :ext
                ORDER BY importance DESC, created_at DESC
                LIMIT :lim
                """
            ),
            {"aid": agent_id, "ext": external_chat_id, "lim": limit},
        )
    ).all()
    return [
        {
            "id": int(r[0]),
            "fact": r[1],
            "category": r[2],
            "importance": int(r[3]),
            "references_count": int(r[4] or 0),
            "created_at": r[5].isoformat() if r[5] else None,
            "last_referenced_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


async def delete_memory(db: AsyncSession, *, memory_id: int, tenant_id: int) -> bool:
    """Remove fato específico (admin override). Tenant scope enforced."""
    res = await db.execute(
        sql_text("DELETE FROM ta_contact_memory WHERE id = :m AND tenant_id = :t"),
        {"m": memory_id, "t": tenant_id},
    )
    await db.commit()
    return (res.rowcount or 0) > 0

"""RAG engine real — chunk + embed (Gemini text-embedding-004) + pgvector cosine + Cohere Rerank opt.

Substitui delegação 100% pro SQLite FTS5 do Hermes por stack RAG própria.
Hybrid? Hoje só dense (cosine pgvector). BM25 sparse fica pra V2 (precisa
adicionar tsvector column ou usar lib externa).

Cita fonte: cada chunk tem knowledge_id+position, o caller resolve título via
TaKnowledge.title pra mostrar "📄 Fonte: catalogo.pdf p.4".

Stack:
- Chunking: por chars (sliding window 1800 chars + overlap 200) — mais simples
  e safe pra todos modelos sem precisar tokenizer
- Embeddings: Gemini text-embedding-004 (768 dims, $0.025/1M chars)
- Storage: pgvector vector(768) com HNSW index (cosine_ops)
- Rerank: Cohere rerank-multilingual-v3.0 opt via COHERE_API_KEY env
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from models import TaKnowledge

logger = logging.getLogger(__name__)
settings = get_settings()

CHUNK_SIZE = 1800  # chars
CHUNK_OVERLAP = 200
EMBED_MODEL = "text-embedding-004"
EMBED_DIMS = 768
COHERE_RERANK_MODEL = "rerank-multilingual-v3.0"


# ────────────────────────────────────────────────────────────
# Chunking simples por chars
# ────────────────────────────────────────────────────────────
def chunk_text(text: str, *, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Quebra texto em chunks com overlap.

    Tenta quebrar em quebra natural (parágrafo, ponto final) próximo do limite.
    """
    if not text:
        return []
    text = text.strip()
    if len(text) <= size:
        return [text]

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        # Tenta quebrar num \n\n próximo
        if end < n:
            cut = text.rfind("\n\n", start + size // 2, end)
            if cut == -1:
                cut = text.rfind(". ", start + size // 2, end)
            if cut != -1:
                end = cut + 1
        chunks.append(text[start:end].strip())
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


# ────────────────────────────────────────────────────────────
# Embeddings via Gemini
# ────────────────────────────────────────────────────────────
async def _embed_via_gemini(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Chama Gemini Embeddings API direto via httpx (mais leve que SDK)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY ausente — defina em env vars do Tier Agent")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents"
        f"?key={api_key}"
    )
    payload = {
        "requests": [
            {
                "model": f"models/{EMBED_MODEL}",
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
            }
            for t in texts
        ]
    }
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post(url, json=payload)
    if r.status_code >= 400:
        raise RuntimeError(f"Gemini embed: HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    embeddings = data.get("embeddings") or []
    out: list[list[float]] = []
    for e in embeddings:
        vals = (e.get("values") or [])[:EMBED_DIMS]
        out.append(vals)
    return out


# ────────────────────────────────────────────────────────────
# Indexação
# ────────────────────────────────────────────────────────────
async def index_knowledge(db: AsyncSession, knowledge_id: int, *, full_text: str) -> dict:
    """Indexa full_text de um knowledge em chunks com embeddings.

    Substitui chunks antigos do knowledge (DELETE + INSERT batch).
    Retorna stats {chunks_count, tokens_estimate}.
    """
    knowledge = await db.get(TaKnowledge, knowledge_id)
    if not knowledge:
        return {"chunks_count": 0, "error": "knowledge não encontrado"}

    chunks = chunk_text(full_text)
    if not chunks:
        return {"chunks_count": 0, "error": "texto vazio"}

    # Embed em batch (Gemini aceita até ~100 por request)
    BATCH = 50
    all_vecs: list[list[float]] = []
    for i in range(0, len(chunks), BATCH):
        batch = chunks[i : i + BATCH]
        try:
            vecs = await _embed_via_gemini(batch)
            all_vecs.extend(vecs)
        except Exception as e:
            logger.exception("embed batch falhou knowledge=%s i=%s", knowledge_id, i)
            return {"chunks_count": 0, "error": f"embed: {e}"}

    if len(all_vecs) != len(chunks):
        logger.warning(
            "embed mismatch knowledge=%s chunks=%s vecs=%s",
            knowledge_id, len(chunks), len(all_vecs),
        )
        return {"chunks_count": 0, "error": "embed mismatch"}

    # Limpa chunks antigos
    await db.execute(
        sql_text("DELETE FROM ta_knowledge_chunk WHERE knowledge_id = :kid"),
        {"kid": knowledge_id},
    )

    # INSERT batch via raw SQL (pgvector aceita array literal '[1,2,3]'::vector)
    for pos, (chunk, vec) in enumerate(zip(chunks, all_vecs)):
        if not vec:
            continue
        vec_literal = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
        await db.execute(
            sql_text(
                """
                INSERT INTO ta_knowledge_chunk
                  (knowledge_id, agent_id, position, chunk_text, tokens_count, embedding)
                VALUES (:kid, :aid, :pos, :txt, :tokens, (:vec)::vector)
                """
            ),
            {
                "kid": knowledge_id,
                "aid": knowledge.agent_id,
                "pos": pos,
                "txt": chunk,
                "tokens": int(len(chunk) / 4),  # aprox
                "vec": vec_literal,
            },
        )

    await db.commit()
    logger.info(
        "rag_engine: indexed knowledge=%s chunks=%s agent=%s",
        knowledge_id, len(chunks), knowledge.agent_id,
    )
    return {
        "chunks_count": len(chunks),
        "tokens_estimate": sum(len(c) for c in chunks) // 4,
    }


# ────────────────────────────────────────────────────────────
# Search
# ────────────────────────────────────────────────────────────
@dataclass
class RagHit:
    chunk_id: int
    knowledge_id: int
    knowledge_title: str | None
    position: int
    text: str
    score: float


async def search(
    db: AsyncSession,
    *,
    agent_id: int,
    query: str,
    top_k: int = 5,
    rerank: bool = True,
) -> list[RagHit]:
    """Busca top_k chunks relevantes pra query.

    1. Embed query (taskType=RETRIEVAL_QUERY)
    2. pgvector cosine top_k*3 candidatos
    3. Cohere Rerank top_k final (se COHERE_API_KEY presente e rerank=true)
    """
    query = (query or "").strip()
    if not query:
        return []

    try:
        q_vecs = await _embed_via_gemini([query], task_type="RETRIEVAL_QUERY")
    except Exception as e:
        logger.warning("rag search embed falhou: %s", e)
        return []
    if not q_vecs or not q_vecs[0]:
        return []
    q_vec = q_vecs[0]
    q_literal = "[" + ",".join(str(round(v, 6)) for v in q_vec) + "]"

    # Pull mais candidatos pra dar margem ao rerank
    pool = max(top_k * 3, 10)
    rows = (
        await db.execute(
            sql_text(
                """
                SELECT
                  kc.id, kc.knowledge_id, kc.position, kc.chunk_text,
                  k.title,
                  1 - (kc.embedding <=> (:q)::vector) AS score
                FROM ta_knowledge_chunk kc
                JOIN ta_knowledge k ON k.id = kc.knowledge_id
                WHERE kc.agent_id = :aid AND kc.embedding IS NOT NULL
                ORDER BY kc.embedding <=> (:q)::vector
                LIMIT :lim
                """
            ),
            {"q": q_literal, "aid": agent_id, "lim": pool},
        )
    ).all()

    candidates = [
        RagHit(
            chunk_id=int(r[0]),
            knowledge_id=int(r[1]),
            knowledge_title=r[4],
            position=int(r[2]),
            text=str(r[3]),
            score=float(r[5] or 0),
        )
        for r in rows
    ]
    if not candidates:
        return []

    # Rerank opcional via Cohere
    cohere_key = os.environ.get("COHERE_API_KEY")
    if rerank and cohere_key and len(candidates) > top_k:
        try:
            ranked = await _cohere_rerank(cohere_key, query, candidates, top_k=top_k)
            return ranked
        except Exception:
            logger.exception("cohere rerank falhou — fallback cosine ordering")

    return candidates[:top_k]


async def _cohere_rerank(
    api_key: str, query: str, candidates: list[RagHit], top_k: int
) -> list[RagHit]:
    """Cohere Rerank v3 multilingual — re-ordena candidatos por relevância real."""
    url = "https://api.cohere.com/v2/rerank"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": COHERE_RERANK_MODEL,
        "query": query,
        "documents": [c.text for c in candidates],
        "top_n": top_k,
    }
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.post(url, json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Cohere rerank HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    ranked_items = data.get("results") or []
    out: list[RagHit] = []
    for item in ranked_items:
        idx = int(item.get("index", -1))
        if 0 <= idx < len(candidates):
            cand = candidates[idx]
            cand.score = float(item.get("relevance_score", cand.score))
            out.append(cand)
    return out

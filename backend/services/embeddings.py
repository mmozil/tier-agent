"""Motor de EMBEDDING configurável — espelha o config de LLM (TaLlmProvider).

Um provider de embedding por tenant (ou global), com CHAVE PRÓPRIA (separada da LLM).
RAG (`rag_engine`) e memória (`memory_service`) chamam `embed()` — UM único ponto de
troca: mudou o provider no config, RAG e memória obedecem juntos.

Resolução: provider ativo de MENOR priority, tenant sobre global. Sem nenhum config →
fallback pro Gemini via env `GEMINI_API_KEY` (comportamento legado, retrocompatível).

Todos os adapters devolvem vetores de `dimensions` floats (default 768, pra casar com a
coluna pgvector `vector(768)` de `ta_knowledge_chunk`/`ta_contact_memory`).
"""

from __future__ import annotations

import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaEmbeddingProvider

logger = logging.getLogger(__name__)

DEFAULT_DIMS = 768  # casa com pgvector vector(768)

# provider -> rótulo (UI). Só os que REALMENTE fazem embedding (OpenRouter não faz).
SUPPORTED_EMBEDDING_PROVIDERS: dict[str, str] = {
    "openrouter": "OpenRouter (gateway — 1 chave p/ OpenAI/Cohere/etc)",
    "gemini": "Google Gemini (gemini-embedding-001)",
    "openai": "OpenAI (text-embedding-3-small / -large)",
    "voyage": "Voyage AI (voyage-3.5, multilingual)",
    "cohere": "Cohere (embed-v4 / multilingual-v3)",
    "jina": "Jina AI (jina-embeddings-v3)",
    "mistral": "Mistral (mistral-embed)",
    "local": "Local / OpenAI-compatible (Ollama, LM Studio, vLLM)",
}

# Modelos sugeridos por provider (parametrizável por env EMBEDDING_PROVIDER_MODELS_JSON).
_DEFAULT_EMBEDDING_MODELS: dict[str, list[str]] = {
    "openrouter": ["google/gemini-embedding-001", "openai/text-embedding-3-small", "openai/text-embedding-3-large", "cohere/embed-v4.0"],
    "gemini": ["gemini-embedding-001"],
    "openai": ["text-embedding-3-small", "text-embedding-3-large"],
    "voyage": ["voyage-3.5", "voyage-3-large", "voyage-multilingual-2"],
    "cohere": ["embed-v4.0", "embed-multilingual-v3.0"],
    "jina": ["jina-embeddings-v3"],
    "mistral": ["mistral-embed"],
    "local": ["nomic-embed-text", "bge-m3", "mxbai-embed-large"],
}


def provider_models() -> dict[str, list[str]]:
    """Catálogo efetivo: default + override por env (sem mexer em código)."""
    import json

    raw = os.environ.get("EMBEDDING_PROVIDER_MODELS_JSON")
    if raw:
        try:
            override = json.loads(raw)
            if isinstance(override, dict):
                return {
                    **_DEFAULT_EMBEDDING_MODELS,
                    **{k: list(v) for k, v in override.items() if isinstance(v, list)},
                }
        except Exception:
            pass
    return _DEFAULT_EMBEDDING_MODELS


# ────────────────────────────────────────────────────────────
# Resolução do provider (tenant sobre global; ativo de menor priority)
# ────────────────────────────────────────────────────────────
async def _resolve_provider(db: AsyncSession | None, tenant_id: int | None) -> TaEmbeddingProvider | None:
    if db is None:
        return None
    rows = (
        await db.execute(
            select(TaEmbeddingProvider)
            .where(TaEmbeddingProvider.active.is_(True))
            .order_by(TaEmbeddingProvider.priority.asc(), TaEmbeddingProvider.id.desc())
        )
    ).scalars().all()
    if tenant_id is not None:
        for r in rows:
            if r.tenant_id == tenant_id:
                return r
    for r in rows:
        if r.tenant_id is None:
            return r
    return None


async def tenant_id_for_agent(db: AsyncSession, agent_id: int | None) -> int | None:
    """Resolve o tenant do agente (o embedding provider é escopado por tenant)."""
    if not agent_id:
        return None
    ag = await db.get(TaAgent, agent_id)
    return ag.tenant_id if ag else None


# ────────────────────────────────────────────────────────────
# API pública
# ────────────────────────────────────────────────────────────
async def embed(
    db: AsyncSession | None,
    texts: list[str],
    *,
    tenant_id: int | None = None,
    task_type: str = "RETRIEVAL_DOCUMENT",
) -> list[list[float]]:
    """Gera embeddings pros textos usando o provider CONFIGURADO (ou fallback env Gemini).

    `task_type`: RETRIEVAL_DOCUMENT (indexar) | RETRIEVAL_QUERY (buscar) — cada adapter
    traduz pro parâmetro do seu provider. Levanta RuntimeError em falha.
    """
    if not texts:
        return []
    prov = await _resolve_provider(db, tenant_id)
    if prov is None:
        # Fallback legado: Gemini via env (mantém o comportamento atual sem config)
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Nenhum provider de embedding configurado e GEMINI_API_KEY ausente — "
                "cadastre um provider em Configurações › Embedding (RAG)."
            )
        return await _embed_gemini(texts, api_key=api_key, model="gemini-embedding-001", dims=DEFAULT_DIMS, task_type=task_type)
    return await embed_with_provider(prov, texts, task_type=task_type)


async def embed_with_provider(
    prov: TaEmbeddingProvider,
    texts: list[str],
    *,
    task_type: str = "RETRIEVAL_DOCUMENT",
) -> list[list[float]]:
    """Embeda com um provider ESPECÍFICO (usado pelo /test e por embed())."""
    if not texts:
        return []
    key = decrypt(prov.api_key_enc) if prov.api_key_enc else ""
    dims = prov.dimensions or DEFAULT_DIMS
    model = prov.default_model
    p = (prov.provider or "").lower()

    if p == "gemini":
        return await _embed_gemini(texts, api_key=key, model=model, dims=dims, task_type=task_type)
    if p == "openai":
        return await _embed_openai(texts, api_key=key, model=model, dims=dims, base_url=prov.base_url)
    if p == "openrouter":
        # Gateway OpenAI-compatible: 1 chave p/ N providers. dims=768 nos text-embedding-3-*.
        return await _embed_openai(texts, api_key=key, model=model, dims=dims, base_url="https://openrouter.ai/api/v1")
    if p == "voyage":
        return await _embed_voyage(texts, api_key=key, model=model, dims=dims, task_type=task_type)
    if p == "cohere":
        return await _embed_cohere(texts, api_key=key, model=model, dims=dims, task_type=task_type)
    if p == "jina":
        return await _embed_jina(texts, api_key=key, model=model, dims=dims)
    if p == "mistral":
        return await _embed_mistral(texts, api_key=key, model=model)
    if p == "local":
        # Endpoint OpenAI-compatible (Ollama/vLLM/LiteLLM/gateway). Passa dims — só é
        # enviado pros modelos text-embedding-3-* (gate no _embed_openai); Ollama ignora.
        return await _embed_openai(
            texts, api_key=key or "ollama", model=model, dims=dims,
            base_url=prov.base_url or "http://host.docker.internal:11434/v1",
        )
    raise RuntimeError(f"Provider de embedding não suportado: {p}")


# ────────────────────────────────────────────────────────────
# Adapters por provider
# ────────────────────────────────────────────────────────────
async def _embed_gemini(
    texts: list[str], *, api_key: str, model: str, dims: int, task_type: str
) -> list[list[float]]:
    """Gemini embedContent (1 por request; não suporta batchEmbedContents)."""
    if not api_key:
        raise RuntimeError("Chave Gemini ausente")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={api_key}"
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60) as cli:
        for t in texts:
            payload = {
                "model": f"models/{model}",
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
                "outputDimensionality": dims,
            }
            r = await cli.post(url, json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"Gemini embed HTTP {r.status_code}: {r.text[:300]}")
            vals = (r.json().get("embedding", {}).get("values") or [])[:dims]
            out.append(vals)
    return out


async def _embed_openai(
    texts: list[str], *, api_key: str, model: str, dims: int | None, base_url: str | None = None
) -> list[list[float]]:
    """OpenAI /embeddings (batch). `dimensions` só nos text-embedding-3-*. Serve tb pro
    provider 'local' (Ollama/LM Studio/vLLM expõem /v1/embeddings compatível)."""
    base = (base_url or "https://api.openai.com/v1").rstrip("/")
    payload: dict = {"model": model, "input": texts}
    # `dimensions` (truncar embedding) só nos modelos que suportam: OpenAI text-embedding-3-*
    # e Google gemini-embedding-* (validado via OpenRouter: dimensions:768 → 768 dims; sem
    # o param o gemini volta 3072). Ollama/nomic/bge são dim-fixa → não enviar.
    if dims and ("text-embedding-3" in model or "gemini-embedding" in model):
        payload["dimensions"] = dims
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post(f"{base}/embeddings", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"OpenAI embed HTTP {r.status_code}: {r.text[:300]}")
    data = sorted(r.json().get("data") or [], key=lambda d: d.get("index", 0))
    return [d.get("embedding") or [] for d in data]


async def _embed_voyage(
    texts: list[str], *, api_key: str, model: str, dims: int, task_type: str
) -> list[list[float]]:
    """Voyage AI /v1/embeddings. input_type document|query, output_dimension configurável."""
    input_type = "query" if task_type == "RETRIEVAL_QUERY" else "document"
    payload = {"model": model, "input": texts, "input_type": input_type, "output_dimension": dims}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post("https://api.voyageai.com/v1/embeddings", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Voyage embed HTTP {r.status_code}: {r.text[:300]}")
    data = sorted(r.json().get("data") or [], key=lambda d: d.get("index", 0))
    return [d.get("embedding") or [] for d in data]


async def _embed_cohere(
    texts: list[str], *, api_key: str, model: str, dims: int, task_type: str
) -> list[list[float]]:
    """Cohere /v2/embed. input_type search_document|search_query. output_dimension só no v4."""
    input_type = "search_query" if task_type == "RETRIEVAL_QUERY" else "search_document"
    payload: dict = {
        "model": model,
        "texts": texts,
        "input_type": input_type,
        "embedding_types": ["float"],
    }
    if "v4" in model or "embed-4" in model:
        payload["output_dimension"] = dims
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post("https://api.cohere.com/v2/embed", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Cohere embed HTTP {r.status_code}: {r.text[:300]}")
    floats = (r.json().get("embeddings") or {}).get("float") or []
    return [list(v) for v in floats]


async def _embed_jina(texts: list[str], *, api_key: str, model: str, dims: int) -> list[list[float]]:
    """Jina AI /v1/embeddings (Matryoshka — dimensions configurável)."""
    payload = {"model": model, "input": texts, "dimensions": dims}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post("https://api.jina.ai/v1/embeddings", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Jina embed HTTP {r.status_code}: {r.text[:300]}")
    data = sorted(r.json().get("data") or [], key=lambda d: d.get("index", 0))
    return [d.get("embedding") or [] for d in data]


async def _embed_mistral(texts: list[str], *, api_key: str, model: str) -> list[list[float]]:
    """Mistral /v1/embeddings (dims fixas 1024 — cuidado com a coluna pgvector)."""
    payload = {"model": model, "input": texts}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post("https://api.mistral.ai/v1/embeddings", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Mistral embed HTTP {r.status_code}: {r.text[:300]}")
    data = sorted(r.json().get("data") or [], key=lambda d: d.get("index", 0))
    return [d.get("embedding") or [] for d in data]

"""Cache de respostas LLM por tenant. MVP: exato (hash SHA256).

Reduz custo + latência em FAQs idênticas. TTL configurável (default 24h).
Invalida automaticamente quando knowledge muda (chamada por skill_builder)
ou agent.persona editada.

Camada semantica (embedding similarity > 0.93) vem em Q1.5 (Weaviate).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass

import redis.asyncio as redis_async

from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_TTL_SECONDS = 24 * 3600  # 24h
KEY_PREFIX = "tier_agent:llm_cache:"
INVALIDATION_PREFIX = "tier_agent:cache_version:"


@dataclass
class CachedReply:
    text: str
    tokens_in: int
    tokens_out: int
    model: str | None
    cached_at: float  # unix ts


def _signature(
    *,
    tenant_id: int,
    agent_id: int | None,
    system_prompt: str | None,
    user_content: str,
    version: int = 1,
) -> str:
    """Hash determinístico do contexto. Version incrementa por invalidação."""
    blob = json.dumps(
        {
            "t": tenant_id,
            "a": agent_id,
            "s": (system_prompt or "").strip(),
            "u": user_content.strip(),
            "v": version,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


async def _get_version(tenant_id: int, agent_id: int | None) -> int:
    """Versão de cache do tenant/agent — invalidar = incrementar."""
    key = f"{INVALIDATION_PREFIX}{tenant_id}:{agent_id or 0}"
    try:
        r = await redis_async.from_url(settings.redis_url, decode_responses=True)
        v = await r.get(key)
        return int(v or 1)
    except Exception:
        return 1


async def get(
    *,
    tenant_id: int,
    agent_id: int | None,
    system_prompt: str | None,
    user_content: str,
) -> CachedReply | None:
    """Retorna resposta cacheada ou None."""
    if not user_content:
        return None
    try:
        version = await _get_version(tenant_id, agent_id)
        sig = _signature(
            tenant_id=tenant_id,
            agent_id=agent_id,
            system_prompt=system_prompt,
            user_content=user_content,
            version=version,
        )
        key = f"{KEY_PREFIX}{tenant_id}:{sig}"
        r = await redis_async.from_url(settings.redis_url, decode_responses=True)
        raw = await r.get(key)
        if not raw:
            return None
        data = json.loads(raw)
        return CachedReply(
            text=data["text"],
            tokens_in=int(data.get("tokens_in", 0)),
            tokens_out=int(data.get("tokens_out", 0)),
            model=data.get("model"),
            cached_at=float(data.get("cached_at", 0)),
        )
    except Exception:
        logger.exception("llm_cache.get falhou tenant=%s", tenant_id)
        return None


async def put(
    *,
    tenant_id: int,
    agent_id: int | None,
    system_prompt: str | None,
    user_content: str,
    reply_text: str,
    tokens_in: int,
    tokens_out: int,
    model: str | None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> None:
    """Salva resposta no cache."""
    if not reply_text or not user_content:
        return
    try:
        version = await _get_version(tenant_id, agent_id)
        sig = _signature(
            tenant_id=tenant_id,
            agent_id=agent_id,
            system_prompt=system_prompt,
            user_content=user_content,
            version=version,
        )
        key = f"{KEY_PREFIX}{tenant_id}:{sig}"
        r = await redis_async.from_url(settings.redis_url, decode_responses=True)
        payload = json.dumps(
            {
                "text": reply_text,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "model": model,
                "cached_at": time.time(),
            },
            ensure_ascii=False,
        )
        await r.set(key, payload, ex=ttl_seconds)
    except Exception:
        logger.exception("llm_cache.put falhou tenant=%s", tenant_id)


async def invalidate(tenant_id: int, agent_id: int | None = None) -> None:
    """Incrementa version → todas keys antigas viram unreachable (TTL expira).

    Mais barato que scan+delete em cache grande.
    """
    try:
        key = f"{INVALIDATION_PREFIX}{tenant_id}:{agent_id or 0}"
        r = await redis_async.from_url(settings.redis_url, decode_responses=True)
        await r.incr(key)
        await r.expire(key, 30 * 24 * 3600)  # 30d
    except Exception:
        logger.exception("llm_cache.invalidate falhou tenant=%s", tenant_id)

"""Proxy de mensagens user → container Hermes do tenant via REST OpenAI-compatible.

Cada container Hermes expõe `/v1/chat/completions` em porta dinâmica (mapeada do 8642
interno). Auth via Bearer com API_SERVER_KEY guardado encriptado no Redis pelo orchestrator.

Endpoints do Hermes API server: /v1/chat/completions, /v1/responses, /v1/runs, /health
(ver gateway/platforms/api_server.py).
"""

import logging
import time
from dataclasses import dataclass

import httpx
import redis.asyncio as redis_async
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt
from models import TaContainer

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class HermesReply:
    text: str
    audio_url: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    model_used: str | None = None
    raw_response: dict | None = None


async def _get_api_key(tenant_id: int) -> str:
    r = await redis_async.from_url(settings.redis_url, decode_responses=True)
    enc = await r.get(f"tier_agent:hermes_key:{tenant_id}")
    if not enc:
        raise RuntimeError(f"API key Hermes não encontrada pra tenant {tenant_id}")
    return decrypt(enc)


async def send_message(
    tenant_id: int,
    user_content: str,
    db: AsyncSession,
    *,
    session_id: str | None = None,
    system_override: str | None = None,
) -> HermesReply:
    """Envia mensagem pro container Hermes do tenant via REST OpenAI-compatible."""
    record = await db.get(TaContainer, tenant_id)
    if not record or not record.port or record.status not in {"running", "starting"}:
        raise RuntimeError(
            f"Container do tenant {tenant_id} não está rodando "
            f"(status={record.status if record else 'none'})"
        )

    api_key = await _get_api_key(tenant_id)
    url = f"http://{record.host}:{record.port}/v1/chat/completions"
    payload = {
        "model": "hermes-agent",  # nome interno do Hermes; o LLM real vem do config do container
        "messages": [],
    }
    if system_override:
        payload["messages"].append({"role": "system", "content": system_override})
    payload["messages"].append({"role": "user", "content": user_content})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if session_id:
        headers["X-Hermes-Session-Id"] = session_id

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as cli:
        r = await cli.post(url, json=payload, headers=headers)
    latency_ms = int((time.perf_counter() - started) * 1000)

    if r.status_code >= 400:
        raise RuntimeError(f"Hermes proxy retornou {r.status_code}: {r.text[:300]}")

    data = r.json()
    choice = (data.get("choices") or [{}])[0]
    text = choice.get("message", {}).get("content", "")
    usage = data.get("usage", {})

    return HermesReply(
        text=text,
        tokens_in=usage.get("prompt_tokens", 0),
        tokens_out=usage.get("completion_tokens", 0),
        latency_ms=latency_ms,
        model_used=data.get("model"),
        raw_response=data,
    )


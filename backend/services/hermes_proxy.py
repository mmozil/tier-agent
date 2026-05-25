"""Proxy de mensagens user → container Hermes do tenant via REST."""

import logging
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaContainer

logger = logging.getLogger(__name__)


@dataclass
class HermesReply:
    text: str
    audio_url: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    model_used: str | None = None
    raw_response: dict | None = None


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
        raise RuntimeError(f"Container do tenant {tenant_id} não está rodando (status={record.status if record else 'none'})")

    url = f"http://{record.host}:{record.port}/v1/chat/completions"
    payload = {
        "model": "tier-default",  # container ignora — usa config local
        "messages": [],
        "stream": False,
    }
    if system_override:
        payload["messages"].append({"role": "system", "content": system_override})
    payload["messages"].append({"role": "user", "content": user_content})

    if session_id:
        payload["session_id"] = session_id

    import time

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as cli:
        r = await cli.post(url, json=payload)
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

"""Langfuse client — observability/tracing pra agente.

Stack hosted ou self-hosted (Coolify Langfuse). Sem keys, skip silencioso.

Env:
- LANGFUSE_PUBLIC_KEY
- LANGFUSE_SECRET_KEY
- LANGFUSE_HOST (ex: https://cloud.langfuse.com OU https://langfuse.tier.finance)

Uso:
- trace_event(event, payload) — fire-and-forget HTTP POST /api/public/ingestion
- Format simples observation: id, type (event|generation|span), name, input, output, metadata
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return bool(
        os.environ.get("LANGFUSE_PUBLIC_KEY")
        and os.environ.get("LANGFUSE_SECRET_KEY")
        and os.environ.get("LANGFUSE_HOST")
    )


async def trace_event(
    *,
    name: str,
    tenant_id: int | None = None,
    agent_id: int | None = None,
    conversation_id: int | None = None,
    input: Any = None,
    output: Any = None,
    metadata: dict | None = None,
    level: str = "DEFAULT",  # DEFAULT | WARNING | ERROR
    latency_ms: int | None = None,
) -> None:
    """Posta 1 evento no Langfuse. Fire-and-forget — qualquer erro é log only."""
    if not _enabled():
        return

    host = os.environ["LANGFUSE_HOST"].rstrip("/")
    public = os.environ["LANGFUSE_PUBLIC_KEY"]
    secret = os.environ["LANGFUSE_SECRET_KEY"]

    trace_id = f"conv-{conversation_id}" if conversation_id else str(uuid.uuid4())
    obs_id = str(uuid.uuid4())
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - (latency_ms or 0)

    batch = {
        "batch": [
            {
                "id": str(uuid.uuid4()),
                "type": "trace-create",
                "timestamp": _iso(),
                "body": {
                    "id": trace_id,
                    "name": f"agent-{agent_id}",
                    "userId": f"tenant-{tenant_id}" if tenant_id else None,
                    "metadata": metadata or {},
                },
            },
            {
                "id": str(uuid.uuid4()),
                "type": "observation-create",
                "timestamp": _iso(),
                "body": {
                    "id": obs_id,
                    "traceId": trace_id,
                    "type": "EVENT",
                    "name": name,
                    "startTime": _iso(start_ms),
                    "endTime": _iso(now_ms),
                    "level": level,
                    "input": input,
                    "output": output,
                    "metadata": metadata or {},
                },
            },
        ]
    }

    async def _send():
        try:
            async with httpx.AsyncClient(timeout=5, auth=(public, secret)) as cli:
                await cli.post(f"{host}/api/public/ingestion", json=batch)
        except Exception:
            logger.debug("langfuse trace falhou — silent")

    try:
        asyncio.create_task(_send())
    except Exception:
        pass


def _iso(ms: int | None = None) -> str:
    if ms is None:
        ms = int(time.time() * 1000)
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

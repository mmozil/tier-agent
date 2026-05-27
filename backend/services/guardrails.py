"""Guardrails — prompt injection + jailbreak detection via Lakera Guard API.

Feature flag por tenant: enable_guardrails (default false).
Quando ativo, todo inbound user message passa por Lakera ANTES de chegar
no LLM provider. Score >= 0.8 em prompt_injection ou jailbreak = bloqueia.

Lakera Guard pricing: $0.0001/check (~$0.10/1000 mensagens).

Docs: https://platform.lakera.ai/docs/api
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

LAKERA_URL = "https://api.lakera.ai/v2/guard"
DEFAULT_THRESHOLD = 0.80


@dataclass
class GuardResult:
    ok: bool  # True = safe, False = bloqueado
    blocked_categories: list[str]
    raw_response: dict | None = None
    error: str | None = None


async def check_lakera(text: str, *, threshold: float = DEFAULT_THRESHOLD) -> GuardResult:
    """Chama Lakera Guard. Se LAKERA_API_KEY ausente, retorna ok=True (skip silencioso)."""
    api_key = os.environ.get("LAKERA_API_KEY")
    if not api_key:
        return GuardResult(ok=True, blocked_categories=[])
    if not text or len(text.strip()) < 3:
        return GuardResult(ok=True, blocked_categories=[])

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    # Lakera Guard v2 payload
    payload = {"messages": [{"role": "user", "content": text}]}

    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.post(LAKERA_URL, json=payload, headers=headers)
    except Exception as e:
        logger.warning("lakera guard timeout/error: %s — fail-open", e)
        return GuardResult(ok=True, blocked_categories=[], error=str(e))

    if r.status_code >= 400:
        logger.warning("lakera HTTP %s: %s — fail-open", r.status_code, r.text[:200])
        return GuardResult(ok=True, blocked_categories=[], error=f"HTTP {r.status_code}")

    try:
        data = r.json()
    except Exception:
        return GuardResult(ok=True, blocked_categories=[], error="parse")

    # Lakera retorna {flagged: bool, results: [{category, score}, ...]}
    blocked: list[str] = []
    results = data.get("results") or []
    for res in results:
        cat = res.get("category", "")
        score = float(res.get("score", 0))
        if score >= threshold and cat:
            blocked.append(cat)

    ok = not blocked
    if not ok:
        logger.warning("lakera BLOCKED categories=%s text='%s'", blocked, text[:80])
    return GuardResult(ok=ok, blocked_categories=blocked, raw_response=data)


async def is_enabled_for_tenant(db, tenant_id: int) -> bool:
    """Lê feature flag enable_guardrails (escopo tenant ou global)."""
    from sqlalchemy import select

    from models import TaFeatureFlag

    try:
        row = (
            await db.execute(
                select(TaFeatureFlag).where(
                    TaFeatureFlag.key == "enable_guardrails",
                    TaFeatureFlag.escopo == "tenant",
                    TaFeatureFlag.escopo_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = (
                await db.execute(
                    select(TaFeatureFlag).where(
                        TaFeatureFlag.key == "enable_guardrails",
                        TaFeatureFlag.escopo == "global",
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return False
        return bool(row.enabled and str(row.value or "false").lower() in ("true", "1", "on", "yes"))
    except Exception:
        return False

"""Content moderation via Azure Content Safety (forte PT-BR).

Detecta hate, violence, sexual, self_harm. Severity 0-7.
Bloqueia >= 4 (high) por default.

Feature flag: enable_content_moderation (escopo tenant > global > false default).

Endpoint: POST https://{resource}.cognitiveservices.azure.com/contentsafety/text:analyze?api-version=2024-09-01
Headers: Ocp-Apim-Subscription-Key

Docs: https://learn.microsoft.com/azure/ai-services/content-safety/
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BLOCK_THRESHOLD = 4  # 0-7 — high = 4+
CATEGORIES = ["Hate", "Violence", "Sexual", "SelfHarm"]


@dataclass
class ModerationResult:
    ok: bool  # True = safe
    blocked_categories: list[str]  # ex: ["Hate", "Violence"]
    max_severity: int = 0
    error: str | None = None


async def check_text(
    text: str, *, block_threshold: int = DEFAULT_BLOCK_THRESHOLD
) -> ModerationResult:
    """Analisa texto via Azure Content Safety. Fail-open em erro."""
    endpoint = os.environ.get("AZURE_CONTENT_SAFETY_ENDPOINT")  # ex: https://X.cognitiveservices.azure.com
    api_key = os.environ.get("AZURE_CONTENT_SAFETY_KEY")
    if not endpoint or not api_key:
        return ModerationResult(ok=True, blocked_categories=[])
    if not text or len(text.strip()) < 3:
        return ModerationResult(ok=True, blocked_categories=[])

    url = f"{endpoint.rstrip('/')}/contentsafety/text:analyze?api-version=2024-09-01"
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text[:10000],  # Azure aceita até 10k chars
        "categories": CATEGORIES,
        "outputType": "FourSeverityLevels",
    }

    try:
        async with httpx.AsyncClient(timeout=8) as cli:
            r = await cli.post(url, json=payload, headers=headers)
    except Exception as e:
        logger.warning("azure moderation timeout: %s — fail-open", e)
        return ModerationResult(ok=True, blocked_categories=[], error=str(e))

    if r.status_code >= 400:
        logger.warning("azure moderation HTTP %s — fail-open", r.status_code)
        return ModerationResult(ok=True, blocked_categories=[], error=f"HTTP {r.status_code}")

    try:
        data = r.json()
    except Exception:
        return ModerationResult(ok=True, blocked_categories=[])

    blocked: list[str] = []
    max_sev = 0
    for cat_result in data.get("categoriesAnalysis") or []:
        cat = cat_result.get("category", "")
        sev = int(cat_result.get("severity", 0))
        max_sev = max(max_sev, sev)
        if sev >= block_threshold and cat:
            blocked.append(cat)

    if blocked:
        logger.warning("azure moderation BLOCKED categories=%s max_severity=%s text='%s'", blocked, max_sev, text[:80])

    return ModerationResult(ok=not blocked, blocked_categories=blocked, max_severity=max_sev)


async def is_enabled_for_tenant(db, tenant_id: int) -> bool:
    """Lê feature flag enable_content_moderation (escopo tenant > global > false default)."""
    from sqlalchemy import select

    from models import TaFeatureFlag

    try:
        row = (
            await db.execute(
                select(TaFeatureFlag).where(
                    TaFeatureFlag.key == "enable_content_moderation",
                    TaFeatureFlag.escopo == "tenant",
                    TaFeatureFlag.escopo_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = (
                await db.execute(
                    select(TaFeatureFlag).where(
                        TaFeatureFlag.key == "enable_content_moderation",
                        TaFeatureFlag.escopo == "global",
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return False
        return bool(row.enabled and str(row.value or "false").lower() in ("true", "1", "on", "yes"))
    except Exception:
        return False

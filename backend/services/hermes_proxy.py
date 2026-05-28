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
    attachments: list | None = None,
    agent_id: int | None = None,
    use_cache: bool = True,
) -> HermesReply:
    """Envia mensagem pro container Hermes do tenant via REST OpenAI-compatible.

    Quando attachments contém imagens (kind=image, url presente), monta payload
    multimodal OpenAI Vision: content vira lista com {type:text} + {type:image_url}.
    Modelo subjacente precisa suportar vision (Gemini 2.5/GPT-4o/Claude Sonnet 4).
    """
    from services.container_orchestrator import get_container_by_tenant

    record = await get_container_by_tenant(db, tenant_id)
    if not record or not record.port or record.status not in {"running", "starting"}:
        raise RuntimeError(
            f"Container do tenant {tenant_id} não está rodando "
            f"(status={record.status if record else 'none'})"
        )

    # LLM cache lookup (exact-match) — pula se há attachments ou cache desabilitado
    has_attachments = bool(attachments)
    if use_cache and not has_attachments:
        from services import llm_cache

        cached = await llm_cache.get(
            tenant_id=tenant_id,
            agent_id=agent_id,
            system_prompt=system_override,
            user_content=user_content,
        )
        if cached:
            logger.info(
                "hermes_proxy: cache HIT tenant=%s agent=%s tokens_saved=%d",
                tenant_id, agent_id, (cached.tokens_in + cached.tokens_out),
            )
            return HermesReply(
                text=cached.text,
                tokens_in=0,  # zero pra não duplicar custo no log
                tokens_out=0,
                latency_ms=1,  # ~instantâneo
                model_used=cached.model,
                raw_response={"_cache_hit": True, "cached_at": cached.cached_at},
            )

    api_key = await _get_api_key(tenant_id)
    url = f"http://{record.host}:{record.port}/v1/chat/completions"
    payload = {
        "model": "hermes-agent",  # nome interno do Hermes; o LLM real vem do config do container
        "messages": [],
    }

    # PII redaction (gate por feature flag — default ON pra LGPD compliance)
    pii_enabled = await _pii_enabled_for_tenant(db, tenant_id)
    pii_mapping = None
    if pii_enabled:
        from services import pii_redactor

        if system_override:
            system_override, _ = pii_redactor.redact(system_override or "")
        user_content, pii_mapping = pii_redactor.redact(user_content or "")

    if system_override:
        payload["messages"].append({"role": "system", "content": system_override})

    # Monta content multimodal se há imagens
    image_atts = [a for a in (attachments or []) if getattr(a, "kind", None) == "image" and getattr(a, "url", None)]

    if image_atts:
        content_parts: list[dict] = []
        # Texto primeiro (caption ou placeholder)
        if user_content:
            content_parts.append({"type": "text", "text": user_content})
        # Cada imagem como image_url (URL pública R2 — vision providers baixam)
        for att in image_atts:
            content_parts.append({"type": "image_url", "image_url": {"url": att.url}})
        payload["messages"].append({"role": "user", "content": content_parts})
        logger.info(
            "hermes_proxy: payload multimodal tenant=%s images=%d text_len=%d",
            tenant_id, len(image_atts), len(user_content or ""),
        )
    else:
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

    # Restora PII na resposta (se o LLM eco-ou placeholders, valores reais voltam)
    if pii_mapping:
        from services import pii_redactor

        text = pii_redactor.restore(text, pii_mapping)

    # Salva no cache (só se cache habilitado, sem attachments, e resposta não-vazia)
    if use_cache and not has_attachments and text:
        from services import llm_cache

        await llm_cache.put(
            tenant_id=tenant_id,
            agent_id=agent_id,
            system_prompt=system_override,
            user_content=user_content,
            reply_text=text,
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
            model=data.get("model"),
        )

    return HermesReply(
        text=text,
        tokens_in=usage.get("prompt_tokens", 0),
        tokens_out=usage.get("completion_tokens", 0),
        latency_ms=latency_ms,
        model_used=data.get("model"),
        raw_response=data,
    )


async def _pii_enabled_for_tenant(db: AsyncSession, tenant_id: int) -> bool:
    """Lê feature flag enable_pii_redaction (escopo tenant ou global). Default true."""
    from sqlalchemy import select as _sel
    from models import TaFeatureFlag

    try:
        # tenant primeiro, depois global
        row = (
            await db.execute(
                _sel(TaFeatureFlag).where(
                    TaFeatureFlag.key == "enable_pii_redaction",
                    TaFeatureFlag.escopo == "tenant",
                    TaFeatureFlag.escopo_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = (
                await db.execute(
                    _sel(TaFeatureFlag).where(
                        TaFeatureFlag.key == "enable_pii_redaction",
                        TaFeatureFlag.escopo == "global",
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return True  # default ON pra LGPD
        return bool(row.enabled and (str(row.value or "true").lower() in ("true", "1", "on", "yes")))
    except Exception:
        logger.exception("pii feature flag lookup falhou tenant=%s — default OFF", tenant_id)
        return False


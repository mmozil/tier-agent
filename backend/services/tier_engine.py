"""Tier Engine — motor de execução de agente PRÓPRIO do Tier (in-process).

O Tier chama o LLM **in-process**, lendo a config do tenant em `TaLlmProvider`
(provider/modelo/key/fallback/base_url). Sem container de execução externo, sem
dependência de terceiro — mesma superfície de rede do backend (control plane).

Contrato:
    send_message(tenant_id, user_content, db, *, system_override, attachments,
                 agent_id, session_id, use_cache, tools) -> EngineReply

Camadas reaproveitadas do Tier (control plane já existente):
    - llm_cache  : cache exact-match (Redis) — ~80% custo a menos em FAQ
    - pii_redactor: redação LGPD antes do LLM + restauração na resposta
    - TaLlmProvider: config de LLM por tenant (zero hardcode) + cadeia de fallback

Providers suportados:
    - OpenAI-compatible (default): minimax, openai, openrouter, gemini, local, nous,
      e qualquer custom via base_url → POST {base_url}/chat/completions
    - anthropic (nativo): POST https://api.anthropic.com/v1/messages

Tool-use (function calling) é opcional via `tools=` — o loop executa tool calls
contra o registry do Tier (mcp_client/code_executor/etc) e re-injeta o resultado.
Hoje os callers não passam tools (persona-driven), então o default é sem ferramentas.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt
from models import TaFeatureFlag, TaLlmProvider

logger = logging.getLogger(__name__)
settings = get_settings()

# Endpoints default por provider (OpenAI-compatible salvo anthropic).
_DEFAULT_BASE_URL = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "minimax": "https://api.minimax.io/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "anthropic": "https://api.anthropic.com/v1",
    "nous": "https://inference-api.nousresearch.com/v1",
    "local": "http://localhost:8000/v1",
}
_MAX_TOOL_ITERATIONS = 6  # trava anti-loop no tool-use

# Modelos de raciocínio (MiniMax-M2, etc.) emitem <think>...</think> na resposta —
# o cliente NÃO pode ver o raciocínio. Removido antes de devolver.
_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)


def _strip_thinking(text: str) -> str:
    return _THINK_RE.sub("", text or "").strip()


@dataclass
class EngineReply:
    text: str
    audio_url: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    model_used: str | None = None
    raw_response: dict | None = None
    tool_calls_made: list = field(default_factory=list)


# Registry de ferramentas (function calling). Cada handler: (args:dict) -> str.
# Populado por register_tool() — o agent_runtime/playbook registram as do Tier.
_TOOL_REGISTRY: dict[str, Callable[[dict], Awaitable[str]]] = {}
_TOOL_SCHEMAS: list[dict] = []


def register_tool(schema: dict, handler: Callable[[dict], Awaitable[str]]) -> None:
    """Registra uma ferramenta (schema OpenAI function + handler async)."""
    name = schema.get("function", {}).get("name") or schema.get("name")
    if not name:
        raise ValueError("tool schema sem name")
    _TOOL_REGISTRY[name] = handler
    _TOOL_SCHEMAS.append(schema)


async def _load_provider(db: AsyncSession, tenant_id: int) -> TaLlmProvider:
    """Config de LLM do tenant; cai pro default global (tenant_id NULL) se não houver.

    Usa o mais recente (maior id) quando há mais de um ativo — tolera duplicatas
    de config sem estourar (ex: 2 providers globais).
    """
    row = (
        await db.execute(
            select(TaLlmProvider)
            .where(TaLlmProvider.tenant_id == tenant_id, TaLlmProvider.active.is_(True))
            .order_by(TaLlmProvider.priority.asc(), TaLlmProvider.id.desc())
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        row = (
            await db.execute(
                select(TaLlmProvider)
                .where(TaLlmProvider.tenant_id.is_(None), TaLlmProvider.active.is_(True))
                .order_by(TaLlmProvider.id.desc())
                .limit(1)
            )
        ).scalars().first()
    if row is None:
        raise RuntimeError(f"Nenhum TaLlmProvider configurado pra tenant {tenant_id} (nem global)")
    return row


def _base_url(p: TaLlmProvider) -> str:
    return (p.base_url or _DEFAULT_BASE_URL.get(p.provider, "")).rstrip("/")


async def _call_openai_compatible(
    *, base_url: str, api_key: str, model: str, messages: list[dict],
    temperature: float, max_tokens: int, timeout_s: int, tools: list[dict] | None,
) -> dict:
    payload: dict[str, Any] = {"model": model, "messages": messages,
                               "temperature": temperature, "max_tokens": max_tokens}
    if tools:
        payload["tools"] = tools
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout_s) as cli:
        r = await cli.post(f"{base_url}/chat/completions", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"LLM {model} retornou {r.status_code}: {r.text[:300]}")
    return r.json()


async def _call_anthropic(
    *, base_url: str, api_key: str, model: str, messages: list[dict],
    temperature: float, max_tokens: int, timeout_s: int,
) -> dict:
    """Anthropic Messages API → normaliza pro shape OpenAI (choices/usage)."""
    system = "\n".join(m["content"] for m in messages if m.get("role") == "system" and isinstance(m.get("content"), str))
    conv = [m for m in messages if m.get("role") != "system"]
    payload = {"model": model, "system": system, "messages": conv,
               "max_tokens": max_tokens, "temperature": temperature}
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout_s) as cli:
        r = await cli.post(f"{base_url}/messages", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Anthropic {model} retornou {r.status_code}: {r.text[:300]}")
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {})
    return {
        "model": data.get("model", model),
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": usage.get("input_tokens", 0),
                  "completion_tokens": usage.get("output_tokens", 0)},
    }


async def _complete(p: TaLlmProvider, model: str, messages: list[dict], tools: list[dict] | None) -> dict:
    api_key = decrypt(p.api_key_enc)
    base = _base_url(p)
    if p.provider == "anthropic":
        return await _call_anthropic(base_url=base, api_key=api_key, model=model, messages=messages,
                                     temperature=p.temperature, max_tokens=p.max_tokens, timeout_s=p.timeout_s)
    return await _call_openai_compatible(base_url=base, api_key=api_key, model=model, messages=messages,
                                         temperature=p.temperature, max_tokens=p.max_tokens,
                                         timeout_s=p.timeout_s, tools=tools)


async def _complete_with_fallback(p: TaLlmProvider, messages: list[dict], tools: list[dict] | None) -> dict:
    """Tenta o modelo default; se falhar, percorre fallback_chain_json."""
    attempts: list[tuple[str, str]] = [(p.provider, p.default_model)]
    for fb in (p.fallback_chain_json or []):
        if isinstance(fb, dict) and fb.get("model"):
            attempts.append((fb.get("provider", p.provider), fb["model"]))
    last_err: Exception | None = None
    for prov, model in attempts:
        try:
            # provider de fallback diferente: usa o mesmo registro (key/base) só troca modelo,
            # salvo anthropic que muda o caminho de chamada.
            eff = p
            if prov != p.provider:
                eff = TaLlmProvider(provider=prov, api_key_enc=p.api_key_enc, default_model=model,
                                    base_url=None, temperature=p.temperature, max_tokens=p.max_tokens,
                                    timeout_s=p.timeout_s, fallback_chain_json=[])
            return await _complete(eff, model, messages, tools)
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("tier_engine: modelo %s/%s falhou (%s) — tentando fallback", prov, model, e)
    raise RuntimeError(f"tier_engine: todos os modelos falharam. Último erro: {last_err}")


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
    tools: list[dict] | None = None,
    history: list[dict] | None = None,
) -> EngineReply:
    """Gera a resposta do agente in-process (drop-in do antigo engine_proxy.send_message).

    Multimodal: attachments com kind=image viram content OpenAI Vision. Tool-use:
    se `tools` vier (ou houver tools registradas), roda o loop de function calling.
    `history`: turnos anteriores [{role, content}] pra o modelo manter contexto da
    conversa (senão "nao"/"sim" viram saudação genérica — agente "esquece" o cliente).
    """
    has_attachments = bool(attachments)
    has_history = bool(history)

    # 1. Cache exact-match (pula se há imagem, histórico ou cache off).
    # Conversa com histórico NÃO é cacheável: o mesmo "nao"/"ok" significa coisas
    # diferentes em contextos diferentes — cache exact-match colidiria.
    if use_cache and not has_attachments and not has_history:
        from services import llm_cache

        cached = await llm_cache.get(
            tenant_id=tenant_id, agent_id=agent_id,
            system_prompt=system_override, user_content=user_content,
        )
        if cached:
            logger.info("tier_engine: cache HIT tenant=%s agent=%s", tenant_id, agent_id)
            return EngineReply(text=cached.text, latency_ms=1, model_used=cached.model,
                               raw_response={"_cache_hit": True, "cached_at": cached.cached_at})

    # 2. PII redaction (LGPD, gate por feature flag, default ON)
    pii_mapping = None
    if await _pii_enabled_for_tenant(db, tenant_id):
        from services import pii_redactor

        if system_override:
            system_override, _ = pii_redactor.redact(system_override or "")
        user_content, pii_mapping = pii_redactor.redact(user_content or "")

    # 3. Monta mensagens (system + user, multimodal se houver imagem)
    messages: list[dict] = []
    if system_override:
        messages.append({"role": "system", "content": system_override})
    # Histórico da conversa (turnos anteriores) ANTES do turno atual — dá memória
    # ao modelo. Só roles user/assistant com texto entram.
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    image_atts = [a for a in (attachments or [])
                  if getattr(a, "kind", None) == "image" and getattr(a, "url", None)]
    if image_atts:
        parts: list[dict] = []
        if user_content:
            parts.append({"type": "text", "text": user_content})
        for att in image_atts:
            parts.append({"type": "image_url", "image_url": {"url": att.url}})
        messages.append({"role": "user", "content": parts})
    else:
        messages.append({"role": "user", "content": user_content})

    # 4. Chama o LLM (com fallback) + loop de tool-use se houver ferramentas
    provider = await _load_provider(db, tenant_id)

    # Tools = registry global do Tier + federação MCP por agente (TaToolProvider).
    # Só federa no caminho persona-driven (tools=None); se o caller passa tools
    # explícitas (ex: nó de playbook), respeita e não injeta as remotas.
    base_tools: list[dict] = list(tools) if tools is not None else list(_TOOL_SCHEMAS)
    remote_handlers: dict[str, Callable[[dict], Awaitable[str]]] = {}
    if agent_id is not None and tools is None:
        try:
            from services import tool_provider_service

            remote_schemas, remote_handlers = await tool_provider_service.discover_agent_tools(db, agent_id)
            if remote_schemas:
                base_tools = base_tools + remote_schemas
        except Exception:
            logger.exception("tier_engine: descoberta de tool-providers MCP falhou agent=%s", agent_id)
    active_tools = base_tools or None

    started = time.perf_counter()
    tool_calls_made: list = []

    data = await _complete_with_fallback(provider, messages, active_tools)
    for _ in range(_MAX_TOOL_ITERATIONS):
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {})
        calls = msg.get("tool_calls") or []
        if not calls:
            break
        messages.append(msg)
        for call in calls:
            fn = call.get("function", {})
            name = fn.get("name")
            import json as _json
            try:
                args = _json.loads(fn.get("arguments") or "{}")
            except Exception:
                args = {}
            handler = _TOOL_REGISTRY.get(name) or remote_handlers.get(name)
            result = await handler(args) if handler else f"[ferramenta {name} indisponível]"
            tool_calls_made.append({"name": name, "args": args})
            messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": str(result)})
        data = await _complete_with_fallback(provider, messages, active_tools)

    latency_ms = int((time.perf_counter() - started) * 1000)
    choice = (data.get("choices") or [{}])[0]
    text = _strip_thinking(choice.get("message", {}).get("content", "") or "")
    usage = data.get("usage", {})

    # 5. Restaura PII na resposta
    if pii_mapping:
        from services import pii_redactor

        text = pii_redactor.restore(text, pii_mapping)

    # 6. Salva no cache (nunca quando há histórico — resposta é contextual)
    if use_cache and not has_attachments and not has_history and text:
        from services import llm_cache

        await llm_cache.put(
            tenant_id=tenant_id, agent_id=agent_id, system_prompt=system_override,
            user_content=user_content, reply_text=text,
            tokens_in=usage.get("prompt_tokens", 0), tokens_out=usage.get("completion_tokens", 0),
            model=data.get("model"),
        )

    return EngineReply(
        text=text,
        tokens_in=usage.get("prompt_tokens", 0),
        tokens_out=usage.get("completion_tokens", 0),
        latency_ms=latency_ms,
        model_used=data.get("model"),
        raw_response=data,
        tool_calls_made=tool_calls_made,
    )


async def _pii_enabled_for_tenant(db: AsyncSession, tenant_id: int) -> bool:
    """Feature flag enable_pii_redaction (tenant > global). Default ON (LGPD)."""
    try:
        row = (
            await db.execute(
                select(TaFeatureFlag).where(
                    TaFeatureFlag.key == "enable_pii_redaction",
                    TaFeatureFlag.escopo == "tenant",
                    TaFeatureFlag.escopo_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = (
                await db.execute(
                    select(TaFeatureFlag).where(
                        TaFeatureFlag.key == "enable_pii_redaction",
                        TaFeatureFlag.escopo == "global",
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return True
        return bool(row.enabled and (str(row.value or "true").lower() in ("true", "1", "on", "yes")))
    except Exception:
        logger.exception("pii feature flag lookup falhou tenant=%s — default OFF", tenant_id)
        return False

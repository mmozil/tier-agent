"""Routes do painel admin pra configurar LLM providers (zero hardcode).

Cliente cadastra provider + API key + modelo + fallback chain via UI.
API key é Fernet-encrypted no DB.
"""

import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user, require_admin
from core.db import get_db
from core.encryption import decrypt, encrypt
from models import TaLlmProvider

router = APIRouter(prefix="/llm-providers", tags=["llm"])


def _invalidate_cost_cache(tenant_id: int | None) -> None:
    """Limpa cache de prices em memória após edição via painel."""
    try:
        from services import cost_calculator

        cost_calculator.invalidate_cache(tenant_id)
    except Exception:
        pass


SUPPORTED_PROVIDERS = {
    "minimax": "MiniMax (MiniMax-M2, abab6.5)",
    "gemini": "Google Gemini (gemini-2.5-flash, gemini-2.5-pro)",
    "anthropic": "Anthropic Claude (claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-7)",
    "openai": "OpenAI (gpt-4o, gpt-4o-mini)",
    "openrouter": "OpenRouter (300+ modelos via 1 chave)",
    "deepseek": "DeepSeek (deepseek-chat, deepseek-reasoner)",
    "nous": "Nous Portal (Engine-2/3, DeepEngine)",
    "local": "Endpoint OpenAI-compatible custom (Ollama/vLLM/LM Studio)",
}

# Catálogo de modelos sugeridos por provider — PARÂMETRO (não hardcode no frontend).
# O frontend consome isto via GET /supported. Sobreescrevível em runtime (sem rebuild)
# pela env LLM_PROVIDER_MODELS_JSON = {"anthropic":["..."], ...} (merge sobre o default).
_DEFAULT_PROVIDER_MODELS: dict[str, list[str]] = {
    "minimax": ["MiniMax-M2"],
    "anthropic": ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"],
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    "gemini": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    "deepseek": ["deepseek-chat", "deepseek-reasoner"],
    "openrouter": [
        "anthropic/claude-haiku-4.5",
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
        "deepseek/deepseek-chat",
    ],
    "nous": ["Hermes-3-Llama-3.1-70B"],
    "local": [],
}


def _provider_models() -> dict[str, list[str]]:
    """Catálogo efetivo: default + override por env (Coolify) sem mexer em código.

    LLM_PROVIDER_MODELS_JSON='{"anthropic":["claude-haiku-4-5-20251001"],"deepseek":[...]}'
    """
    raw = os.environ.get("LLM_PROVIDER_MODELS_JSON")
    if raw:
        try:
            override = json.loads(raw)
            if isinstance(override, dict):
                return {**_DEFAULT_PROVIDER_MODELS, **{k: list(v) for k, v in override.items() if isinstance(v, list)}}
        except Exception:
            pass
    return _DEFAULT_PROVIDER_MODELS


class LlmProviderIn(BaseModel):
    provider: str
    api_key: str  # plaintext na request, encrypted at rest
    default_model: str
    fallback_chain: list[dict] = []  # [{"provider":"x","model":"y"}]
    temperature: float = 0.7
    max_tokens: int = 4096
    timeout_s: int = 30
    cost_input_per_1m: float | None = None
    cost_output_per_1m: float | None = None
    base_url: str | None = None
    tenant_id: int | None = None  # NULL = global default Tier
    active: bool = True
    priority: int = 100  # menor = usado primeiro


class LlmProviderPatch(BaseModel):
    """Patch parcial — todos opcionais (toggle, reorder, edição pontual)."""

    provider: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    fallback_chain: list[dict] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    timeout_s: int | None = None
    cost_input_per_1m: float | None = None
    cost_output_per_1m: float | None = None
    base_url: str | None = None
    active: bool | None = None
    priority: int | None = None


class LlmProviderOut(BaseModel):
    id: int
    provider: str
    default_model: str
    fallback_chain: list[dict] = Field(default_factory=list, validation_alias="fallback_chain_json")
    temperature: float
    max_tokens: int
    timeout_s: int
    cost_input_per_1m: float | None
    cost_output_per_1m: float | None
    base_url: str | None
    tenant_id: int | None
    active: bool
    priority: int = 100
    has_api_key: bool = True
    # Campos computados (preenchidos no list, não vêm direto do ORM):
    api_key_suffix: str | None = None  # últimos 4 chars da key, pra diferenciar duplicatas
    created_at: datetime | None = None
    in_use: bool = False  # True = é o provider que o motor REALMENTE usa neste escopo

    model_config = {"from_attributes": True, "populate_by_name": True}


@router.get("/supported")
async def supported_providers():
    """Provedores suportados + modelos sugeridos por provider (UI popula o dropdown).

    `models` vem do catálogo parametrizável (`_provider_models`), não hardcoded no front.
    """
    catalog = _provider_models()
    return {
        "providers": [
            {"key": k, "label": v, "models": catalog.get(k, [])} for k, v in SUPPORTED_PROVIDERS.items()
        ]
    }


@router.get("", response_model=list[LlmProviderOut])
async def list_providers(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista providers do tenant + globais (NULL tenant_id).

    Ordenado por priority (menor primeiro) — a MESMA ordem que o motor usa pra
    escolher. Marca `in_use=True` no provider que o motor realmente pega em cada
    escopo (o ativo de menor priority; empate → maior id), pra acabar com a dúvida
    de "qual das duas configs idênticas está valendo".
    """
    stmt = select(TaLlmProvider)
    if not user.is_admin:
        # Cliente vê SÓ os modelos dele. O provider global é infra da plataforma (rede de
        # segurança pra agentes que ainda não escolheram o seu) — não aparece pro cliente,
        # pra não confundir com um toggle que ele não controla. O motor continua usando o
        # global como fallback automático quando o tenant não tem nenhum ativo.
        stmt = stmt.where(TaLlmProvider.tenant_id == user.tenant_id)
    rows = list(
        (
            await db.execute(stmt.order_by(TaLlmProvider.priority.asc(), TaLlmProvider.id.desc()))
        ).scalars().all()
    )

    # "Em uso" = o provider que o motor REALMENTE pega. Importante: o motor resolve
    # TENANT sobre GLOBAL (_load_provider) — então, pra quem tem provider próprio ativo,
    # o global fica SOMBREADO (não está em uso pra ele). Senão o painel mostrava 2x "Em uso"
    # (global + tenant) e dava a impressão errada de que dava pra/precisava desligar o global.
    in_use_ids: set[int] = set()
    if user.is_admin:
        # Admin vê todos os escopos — marca o winner ativo de cada escopo (visão de plataforma).
        by_scope: dict[int | None, list[TaLlmProvider]] = {}
        for r in rows:
            by_scope.setdefault(r.tenant_id, []).append(r)
        for scope_rows in by_scope.values():
            winner = next((r for r in scope_rows if r.active), None)
            if winner:
                in_use_ids.add(winner.id)
    else:
        # Não-admin: efetivo = winner do tenant dele; só cai no global se não tiver o próprio.
        tenant_winner = next((r for r in rows if r.tenant_id == user.tenant_id and r.active), None)
        global_winner = next((r for r in rows if r.tenant_id is None and r.active), None)
        effective = tenant_winner or global_winner
        if effective:
            in_use_ids.add(effective.id)

    items = []
    for row in rows:
        out = LlmProviderOut.model_validate(row)
        out.in_use = row.id in in_use_ids
        out.created_at = row.created_at
        try:
            raw = decrypt(row.api_key_enc) or ""
            out.api_key_suffix = raw[-4:] if len(raw) >= 4 else "••••"
        except Exception:
            out.api_key_suffix = None
        items.append(out)
    return items


@router.post("", response_model=LlmProviderOut, status_code=201)
async def create_provider(
    payload: LlmProviderIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"Provider não suportado. Use um de: {list(SUPPORTED_PROVIDERS)}")

    # Admin Tier cria config GLOBAL (tenant_id NULL) ou de qualquer tenant.
    # Não-admin: o provider é SEMPRE escopado no PRÓPRIO tenant (LLM do agente dele).
    # Antes dava 403 ao salvar (o painel manda tenant_id NULL) — agora só escopa no user.
    if user.is_admin:
        tenant_id = payload.tenant_id
    else:
        tenant_id = user.tenant_id
        if not tenant_id:
            raise HTTPException(403, "Sua conta não tem tenant pra associar o provider")

    item = TaLlmProvider(
        tenant_id=tenant_id,
        provider=payload.provider,
        api_key_enc=encrypt(payload.api_key),
        default_model=payload.default_model,
        fallback_chain_json=payload.fallback_chain,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        timeout_s=payload.timeout_s,
        cost_input_per_1m=payload.cost_input_per_1m,
        cost_output_per_1m=payload.cost_output_per_1m,
        base_url=payload.base_url,
        active=payload.active,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    _invalidate_cost_cache(item.tenant_id)
    return item


@router.patch("/{provider_id}", response_model=LlmProviderOut)
async def update_provider(
    provider_id: int,
    payload: LlmProviderPatch,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaLlmProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")

    # Permissão
    if item.tenant_id is None and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode editar config global")
    if item.tenant_id is not None and item.tenant_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, "Provider de outro tenant")

    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data:
        item.api_key_enc = encrypt(data.pop("api_key"))
    if "fallback_chain" in data:
        item.fallback_chain_json = data.pop("fallback_chain")
    for k, v in data.items():
        if k == "tenant_id":
            continue
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    _invalidate_cost_cache(item.tenant_id)
    return item


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaLlmProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")
    if item.tenant_id is None and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode deletar config global")
    if item.tenant_id is not None and item.tenant_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, "Provider de outro tenant")
    tenant_for_cache = item.tenant_id
    await db.delete(item)
    await db.commit()
    _invalidate_cost_cache(tenant_for_cache)


@router.post("/{provider_id}/test")
async def test_provider_connection(
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Valida a key/endpoint fazendo um ping real no provider (sem fallback).

    Usa o motor (`tier_engine._complete`) com um prompt mínimo. Devolve
    `{ok, latency_ms, model, sample}` em sucesso, ou `{ok: false, detail}` no erro
    — assim o botão ⚡ na UI dá um veredito honesto da credencial.
    """
    import time

    from services import tier_engine

    item = await db.get(TaLlmProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")

    messages = [
        {"role": "system", "content": "Você é um teste de conexão. Responda só 'ok'."},
        {"role": "user", "content": "ping"},
    ]
    started = time.perf_counter()
    try:
        data = await tier_engine._complete(item, item.default_model, messages, None)
        latency_ms = int((time.perf_counter() - started) * 1000)
        sample = ((data.get("choices") or [{}])[0].get("message", {}).get("content") or "")[:80]
        return {
            "ok": True,
            "provider": item.provider,
            "model": item.default_model,
            "latency_ms": latency_ms,
            "sample": sample.strip(),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "provider": item.provider,
            "model": item.default_model,
            "detail": str(e)[:300],
        }

"""Routes do painel admin pra configurar LLM providers (zero hardcode).

Cliente cadastra provider + API key + modelo + fallback chain via UI.
API key é Fernet-encrypted no DB.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user, require_admin
from core.db import get_db
from core.encryption import decrypt, encrypt
from models import TaLlmProvider

router = APIRouter(prefix="/llm-providers", tags=["llm"])


SUPPORTED_PROVIDERS = {
    "minimax": "MiniMax (MiniMax-M2, abab6.5)",
    "gemini": "Google Gemini (gemini-2.5-flash, gemini-2.5-pro)",
    "anthropic": "Anthropic Claude (claude-sonnet-4-6, claude-opus-4-7)",
    "openai": "OpenAI (gpt-4o, gpt-4o-mini)",
    "openrouter": "OpenRouter (300+ modelos via 1 chave)",
    "nous": "Nous Portal (Hermes-2/3, DeepHermes)",
    "local": "Endpoint OpenAI-compatible custom (Ollama/vLLM/LM Studio)",
}


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
    has_api_key: bool = True

    model_config = {"from_attributes": True, "populate_by_name": True}


@router.get("/supported")
async def supported_providers():
    """Lista provedores suportados pelo Tier Agent (UI usa pra popular dropdown)."""
    return {"providers": [{"key": k, "label": v} for k, v in SUPPORTED_PROVIDERS.items()]}


@router.get("", response_model=list[LlmProviderOut])
async def list_providers(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista providers do tenant + globais (NULL tenant_id)."""
    stmt = select(TaLlmProvider)
    if not user.is_admin:
        stmt = stmt.where(
            (TaLlmProvider.tenant_id == user.tenant_id) | (TaLlmProvider.tenant_id.is_(None))
        )
    result = await db.execute(stmt.order_by(TaLlmProvider.id.desc()))
    items = []
    for row in result.scalars().all():
        out = LlmProviderOut.model_validate(row)
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

    # Só admin Tier pode criar config global (tenant_id NULL)
    if payload.tenant_id is None and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode criar config global")

    # Tenant-scoped: força tenant_id do user
    tenant_id = payload.tenant_id if user.is_admin else user.tenant_id

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
    return item


@router.patch("/{provider_id}", response_model=LlmProviderOut)
async def update_provider(
    provider_id: int,
    payload: LlmProviderIn,
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
    await db.delete(item)
    await db.commit()


@router.post("/{provider_id}/test")
async def test_provider_connection(
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Faz uma chamada teste pro provider pra validar credenciais. (TODO: implementar por provider)"""
    item = await db.get(TaLlmProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")
    # Decrypt da chave fica disponível pra service futuro
    _ = decrypt(item.api_key_enc)
    return {"status": "not_implemented_yet", "provider": item.provider, "model": item.default_model}

"""Calcula custo em cents pra tokens consumidos, por provider/model.

Lookup em TaLlmProvider.cost_input_per_1m / cost_output_per_1m (USD por 1M tokens).
Converte USD → BRL → cents (assumindo USD/BRL ~5.0 hardcoded; refinar com FX service depois).

Cache de prices em memória por 5min pra evitar query por mensagem.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaLlmProvider

logger = logging.getLogger(__name__)

USD_TO_BRL = 5.0  # TODO: plugar FX service real (BCB API ou similar)

# Cache simples in-memory: {tenant_id: (prices_dict, ts)}
# prices_dict: {model_lower: (cost_in_per_1m, cost_out_per_1m)}
_CACHE: dict[int | None, tuple[dict[str, tuple[float, float]], float]] = {}
_CACHE_TTL = 300  # 5min


async def _get_prices_for_tenant(
    db: AsyncSession, tenant_id: int | None
) -> dict[str, tuple[float, float]]:
    """Mapa model_lower → (cost_input_per_1m, cost_output_per_1m) em USD.

    Inclui providers globais (tenant_id=NULL) + específicos do tenant.
    """
    now = time.time()
    cached = _CACHE.get(tenant_id)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    stmt = select(TaLlmProvider).where(
        (TaLlmProvider.tenant_id == tenant_id) | (TaLlmProvider.tenant_id.is_(None))
    )
    rows = (await db.execute(stmt)).scalars().all()

    prices: dict[str, tuple[float, float]] = {}
    for p in rows:
        model = (p.default_model or "").lower().strip()
        if not model:
            continue
        cin = float(p.cost_input_per_1m or 0)
        cout = float(p.cost_output_per_1m or 0)
        if cin == 0 and cout == 0:
            continue
        # Prioriza tenant-specific se houver conflito de modelo
        if model not in prices or p.tenant_id == tenant_id:
            prices[model] = (cin, cout)

    _CACHE[tenant_id] = (prices, now)
    return prices


async def calculate_cost_cents(
    db: AsyncSession,
    tenant_id: int,
    *,
    model_used: Optional[str],
    tokens_in: int,
    tokens_out: int,
) -> int:
    """Retorna custo em cents BRL. 0 se não conseguir resolver preço."""
    if not model_used or (tokens_in == 0 and tokens_out == 0):
        return 0

    try:
        prices = await _get_prices_for_tenant(db, tenant_id)
    except Exception:
        logger.exception("cost_calculator: lookup prices falhou tenant=%s", tenant_id)
        return 0

    model_lower = model_used.lower().strip()
    # Match exato primeiro
    price = prices.get(model_lower)
    if not price:
        # Match parcial (ex: "gemini-2.5-flash" matcheia "gemini-2.5-flash-001")
        for k, v in prices.items():
            if model_lower.startswith(k) or k.startswith(model_lower):
                price = v
                break

    if not price:
        return 0

    cost_in_usd, cost_out_usd = price
    usd = (tokens_in / 1_000_000) * cost_in_usd + (tokens_out / 1_000_000) * cost_out_usd
    brl = usd * USD_TO_BRL
    cents = int(round(brl * 100))
    return cents


def invalidate_cache(tenant_id: int | None = None) -> None:
    """Limpa cache (chamar após editar TaLlmProvider via painel)."""
    if tenant_id is None:
        _CACHE.clear()
    else:
        _CACHE.pop(tenant_id, None)

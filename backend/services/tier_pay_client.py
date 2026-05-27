"""Tier Pay client — Pagar.me Payment Link.

MVP pragmático: usa TIER_PAY_SECRET_KEY env global (singleton). Cada tenant
compartilha a conta Tier master. Splits/multi-tenant proper fica pra V2 com
ta_tier_pay_config + KYC por tenant.

Cria payment link que aceita Pix + Cartão + Boleto no mesmo URL.

Docs: https://docs.pagar.me/reference/criar-link-de-pagamento
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

PAGARME_BASE = "https://api.pagar.me/core/v5"


@dataclass
class PaymentLinkResult:
    ok: bool
    url: str = ""
    payment_link_id: str = ""
    error: str | None = None
    raw_response: dict | None = None


async def create_payment_link(
    *,
    name: str,
    amount_cents: int,
    description: str | None = None,
    methods: list[str] | None = None,
    expires_in_days: int = 7,
    customer_name: str | None = None,
    customer_email: str | None = None,
    metadata: dict | None = None,
) -> PaymentLinkResult:
    """Cria payment link Pagar.me. Sem split (MVP).

    methods: lista de ['pix', 'credit_card', 'boleto']. Default: pix + credit_card.
    """
    api_key = os.environ.get("TIER_PAY_SECRET_KEY")
    if not api_key:
        return PaymentLinkResult(ok=False, error="TIER_PAY_SECRET_KEY ausente")
    if amount_cents <= 0:
        return PaymentLinkResult(ok=False, error="amount_cents inválido")

    methods = methods or ["pix", "credit_card"]
    method_payloads = []
    for m in methods:
        if m == "pix":
            method_payloads.append({"payment_method": "pix", "pix": {"expires_in": 86400}})
        elif m == "credit_card":
            method_payloads.append(
                {
                    "payment_method": "credit_card",
                    "credit_card": {"installments": [{"number": 1, "total": amount_cents}]},
                }
            )
        elif m == "boleto":
            method_payloads.append({"payment_method": "boleto", "boleto": {"due_at": None}})

    payload = {
        "is_building": False,
        "payment_settings": {
            "accepted_payment_methods": methods,
            "credit_card_settings": {
                "installments": [{"number": 1, "total": amount_cents}],
            }
            if "credit_card" in methods
            else None,
        },
        "cart_settings": {
            "items": [
                {
                    "amount": amount_cents,
                    "name": name[:80],
                    "default_quantity": 1,
                    "description": (description or name)[:200],
                }
            ],
        },
        "name": name[:80],
        "expires_in": expires_in_days * 86400,
        "metadata": metadata or {},
    }
    if customer_name or customer_email:
        payload["customer_config"] = {
            "name": "required",
            "email": "required",
        }

    # Limpa keys None
    if not payload["payment_settings"]["credit_card_settings"]:
        payload["payment_settings"].pop("credit_card_settings", None)

    headers = {"Content-Type": "application/json"}
    auth = (api_key, "")

    try:
        async with httpx.AsyncClient(timeout=30, auth=auth) as cli:
            r = await cli.post(f"{PAGARME_BASE}/paymentlinks", json=payload, headers=headers)
    except Exception as e:
        return PaymentLinkResult(ok=False, error=f"pagarme conn: {e}")

    if r.status_code >= 400:
        logger.warning("pagarme HTTP %s: %s", r.status_code, r.text[:300])
        return PaymentLinkResult(
            ok=False,
            error=f"pagarme HTTP {r.status_code}: {r.text[:200]}",
        )

    try:
        data = r.json()
    except Exception as e:
        return PaymentLinkResult(ok=False, error=f"parse: {e}")

    return PaymentLinkResult(
        ok=True,
        url=data.get("url", ""),
        payment_link_id=data.get("id", ""),
        raw_response=data,
    )

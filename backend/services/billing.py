"""Billing — integração com Tier Pay (Pagar.me via Tier Finance API).

3 SKUs:
- Starter R$ 99/mês — 1 agente, 500 msgs/dia, 1 canal, 1GB knowledge
- Pro R$ 299/mês — 3 agentes, 5000 msgs/dia, 4 canais, 10GB
- Business R$ 799/mês — 10 agentes, unlimited msgs, todos canais, 100GB
"""

import logging
from dataclasses import dataclass

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class SKU:
    key: str
    label: str
    monthly_brl: int  # em centavos
    max_agents: int
    daily_messages: int  # -1 = unlimited
    max_channels: int
    knowledge_gb: int
    description: str
    features: list[str]


SKUS: dict[str, SKU] = {
    "starter": SKU(
        key="starter",
        label="Starter",
        monthly_brl=9900,
        max_agents=1,
        daily_messages=500,
        max_channels=1,
        knowledge_gb=1,
        description="Pra começar a automatizar atendimento.",
        features=[
            "1 agente IA configurável",
            "500 mensagens/dia",
            "1 canal (WhatsApp ou Telegram ou Email)",
            "1 GB de conhecimento (PDFs/planilhas)",
            "Suporte por email",
        ],
    ),
    "pro": SKU(
        key="pro",
        label="Pro",
        monthly_brl=29900,
        max_agents=3,
        daily_messages=5000,
        max_channels=4,
        knowledge_gb=10,
        description="Pra times de atendimento crescendo.",
        features=[
            "3 agentes IA configuráveis",
            "5.000 mensagens/dia",
            "4 canais simultâneos",
            "10 GB de conhecimento",
            "Suporte prioritário",
            "Templates avançados",
        ],
    ),
    "business": SKU(
        key="business",
        label="Business",
        monthly_brl=79900,
        max_agents=10,
        daily_messages=-1,
        max_channels=99,
        knowledge_gb=100,
        description="Operação madura com SLA.",
        features=[
            "10 agentes IA",
            "Mensagens ilimitadas",
            "Todos os canais",
            "100 GB de conhecimento",
            "SLA dedicado + onboarding",
            "Multi-tenant interno",
            "API webhook custom",
        ],
    ),
}


def list_skus() -> list[dict]:
    return [
        {
            "key": s.key,
            "label": s.label,
            "monthly_brl": s.monthly_brl,
            "monthly_brl_display": f"R$ {s.monthly_brl / 100:.2f}".replace(".", ","),
            "max_agents": s.max_agents,
            "daily_messages": s.daily_messages,
            "max_channels": s.max_channels,
            "knowledge_gb": s.knowledge_gb,
            "description": s.description,
            "features": s.features,
        }
        for s in SKUS.values()
    ]


def get_sku(key: str) -> SKU | None:
    return SKUS.get(key)


# ============================================================
# Tier Pay API integration (placeholder MVP)
# ============================================================
async def create_subscription_checkout(tenant_id: int, sku_key: str, customer_email: str) -> dict:
    """Cria checkout Tier Pay pra assinatura recorrente.

    MVP: retorna URL fake. Em prod chama Tier Pay real (Pagar.me).
    """
    sku = get_sku(sku_key)
    if not sku:
        raise ValueError(f"SKU desconhecida: {sku_key}")

    if not settings.tier_pay_api_url or not settings.tier_pay_internal_key:
        # Modo offline — retorna sandbox URL
        logger.warning("Tier Pay não configurado — retornando URL placeholder")
        return {
            "checkout_url": f"https://pay.tier.finance/checkout?sku={sku_key}&tenant={tenant_id}",
            "sandbox": True,
            "sku": sku.key,
            "monthly_brl": sku.monthly_brl,
        }

    url = f"{settings.tier_pay_api_url}/api/v1/tier-billing/checkout"
    headers = {
        "X-Internal-Key": settings.tier_pay_internal_key,
        "Content-Type": "application/json",
    }
    payload = {
        "product": "tier_agent",
        "sku": sku.key,
        "external_tenant_id": tenant_id,
        "customer_email": customer_email,
        "amount_cents": sku.monthly_brl,
        "recurring": True,
        "interval": "month",
    }
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.post(url, json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Tier Pay retornou {r.status_code}: {r.text[:200]}")
    return r.json()

"""Cliente Tier WhatsApp Engine — provisiona instâncias por tenant.

Engine API (https://whats.tier.finance):
- POST /v1/instances           — cria instance (admin Bearer)
- POST /v1/instances/{id}/connect  — conecta + retorna QR
- GET  /v1/instances/{id}/status   — status + QR
- POST /v1/instances/{id}/disconnect
- DELETE /v1/instances/{id}
"""

import logging

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EngineError(Exception):
    def __init__(self, msg: str, *, status: int | None = None, body: str | None = None):
        super().__init__(msg)
        self.status = status
        self.body = body


def _admin_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.tier_whatsapp_engine_admin_key}",
        "Content-Type": "application/json",
    }


def _instance_headers(api_key: str) -> dict:
    return {"X-API-Key": api_key, "Content-Type": "application/json"}


async def create_instance(tenant_id: int, name: str) -> dict:
    """Cria nova instância WhatsApp na Engine (schema camelCase Fastify).

    Retorna: { id, apiKey, status, ... }
    """
    if not settings.tier_whatsapp_engine_tenant_id:
        raise EngineError("TIER_WHATSAPP_ENGINE_TENANT_ID não configurado")

    url = f"{settings.tier_whatsapp_engine_url}/v1/instances"
    payload = {
        "tenantId": settings.tier_whatsapp_engine_tenant_id,
        "name": name,
        "webhookUrl": "https://api-agent.tier.finance/api/v1/webhooks/whatsapp-engine",
    }
    async with httpx.AsyncClient(timeout=12) as cli:
        r = await cli.post(url, json=payload, headers=_admin_headers())
    if r.status_code >= 400:
        raise EngineError(
            f"create_instance falhou: {r.status_code} {r.text[:200]}",
            status=r.status_code,
            body=r.text[:400],
        )
    return r.json()


async def connect_instance(instance_id: str, api_key: str) -> dict:
    """Inicia conexão + gera QR code. Body {} obrigatório (Fastify reject empty)."""
    url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/connect"
    async with httpx.AsyncClient(timeout=12) as cli:
        r = await cli.post(url, json={}, headers=_instance_headers(api_key))
    if r.status_code >= 400:
        raise EngineError(
            f"connect falhou: {r.status_code} {r.text[:200]}",
            status=r.status_code,
            body=r.text[:400],
        )
    return r.json()


async def get_status(instance_id: str, api_key: str) -> dict:
    """Status atual + QR code (se aguardando pairing)."""
    url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/status"
    async with httpx.AsyncClient(timeout=6) as cli:
        r = await cli.get(url, headers=_instance_headers(api_key))
    if r.status_code >= 400:
        raise EngineError(f"status falhou: {r.status_code}", status=r.status_code, body=r.text[:200])
    return r.json()


async def get_qr(instance_id: str, api_key: str) -> dict:
    """Pega QR code diretamente."""
    url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/qr"
    async with httpx.AsyncClient(timeout=6) as cli:
        r = await cli.get(url, headers=_instance_headers(api_key))
    if r.status_code >= 400:
        raise EngineError(f"qr falhou: {r.status_code}", status=r.status_code, body=r.text[:200])
    return r.json()


async def disconnect_instance(instance_id: str, api_key: str) -> dict:
    url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/disconnect"
    async with httpx.AsyncClient(timeout=8) as cli:
        r = await cli.post(url, json={}, headers=_instance_headers(api_key))
    if r.status_code >= 400:
        raise EngineError(
            f"disconnect falhou: {r.status_code}", status=r.status_code, body=r.text[:200]
        )
    return r.json()


async def delete_instance(instance_id: str) -> None:
    url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}"
    async with httpx.AsyncClient(timeout=8) as cli:
        r = await cli.delete(url, headers=_admin_headers())
    if r.status_code >= 400 and r.status_code != 404:
        raise EngineError(f"delete falhou: {r.status_code}", status=r.status_code, body=r.text[:200])

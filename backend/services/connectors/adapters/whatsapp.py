"""WhatsApp via Tier WhatsApp Engine.

Tier Engine é multi-instance multi-tenant em prod (whats.tier.finance).
Cada agent tem 1 instância Engine. Outbound = POST REST. Inbound = webhook.
"""

import base64
import logging

import httpx

from core.config import get_settings
from services.connectors.base import (
    BaseConnector,
    ConnectorConfig,
    ConnectorError,
    OutboundMessage,
)

logger = logging.getLogger(__name__)
settings = get_settings()


class WhatsAppConnector:
    kind = "whatsapp"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        instance_id = config.data.get("instance_id")
        api_key = config.data.get("api_key")
        if not instance_id or not api_key:
            raise ConnectorError("Config WhatsApp incompleta (instance_id + api_key)", kind=self.kind)

        base = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/messages"
        headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

        # Se tiver áudio anexo, envia áudio (com texto vai no caption se Engine suportar)
        audio = next((a for a in msg.attachments if a.kind == "audio"), None)
        image = next((a for a in msg.attachments if a.kind == "image"), None)

        async with httpx.AsyncClient(timeout=30) as cli:
            if audio:
                body = {
                    "to": msg.external_chat_id,
                    "audio_base64": base64.b64encode(audio.raw_bytes).decode() if audio.raw_bytes else None,
                    "audio_url": audio.url,
                    "mime": audio.mime or "audio/ogg",
                }
                r = await cli.post(f"{base}/audio", json=body, headers=headers)
            elif image:
                body = {
                    "to": msg.external_chat_id,
                    "image_url": image.url,
                    "caption": msg.content,
                }
                r = await cli.post(f"{base}/image", json=body, headers=headers)
            else:
                body = {"to": msg.external_chat_id, "text": msg.content}
                r = await cli.post(f"{base}/text", json=body, headers=headers)

        if r.status_code >= 400:
            raise ConnectorError(
                f"Tier Engine retornou {r.status_code}: {r.text[:200]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    async def send_typing(self, config: ConnectorConfig, to: str, state: str = "composing") -> None:
        """Envia presença pro contato. `composing` = o cliente vê '…digitando' no
        WhatsApp dele. Best-effort: falha só loga (não bloqueia a resposta)."""
        instance_id = config.data.get("instance_id")
        api_key = config.data.get("api_key")
        if not instance_id or not api_key or not to:
            return
        url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/presence"
        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                await cli.post(
                    url,
                    json={"to": to, "state": state},
                    headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                )
        except Exception as e:
            logger.debug("send_typing falhou (ignora): %s", e)

    async def validate_config(self, config: ConnectorConfig) -> bool:
        instance_id = config.data.get("instance_id")
        api_key = config.data.get("api_key")
        if not instance_id or not api_key:
            return False
        url = f"{settings.tier_whatsapp_engine_url}/v1/instances/{instance_id}/status"
        try:
            async with httpx.AsyncClient(timeout=5) as cli:
                r = await cli.get(url, headers={"X-API-Key": api_key})
            return r.status_code == 200
        except Exception as e:
            logger.warning("WhatsApp validate falhou: %s", e)
            return False

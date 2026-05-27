"""Telegram Bot API connector.

Cliente configura `bot_token` (BotFather) no `TaConnector.config_json_enc`.
Outbound: sendMessage/sendAudio/sendPhoto direto pra api.telegram.org.
Inbound: webhook `POST /webhooks/telegram/{instance_id}` (instance_id = bot_id).

Pra ativar inbound, cliente faz `setWebhook` apontando pra Tier Agent:
  curl https://api.telegram.org/bot<token>/setWebhook \
    -d "url=https://api-agent.tier.finance/api/v1/webhooks/telegram/<bot_id>"
"""

from __future__ import annotations

import logging

import httpx

from services.connectors.base import (
    ConnectorConfig,
    ConnectorError,
    OutboundMessage,
)

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"


class TelegramConnector:
    kind = "telegram"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        token = config.data.get("bot_token")
        if not token:
            raise ConnectorError("bot_token ausente", kind=self.kind)

        chat_id = msg.external_chat_id
        if not chat_id:
            raise ConnectorError("external_chat_id (telegram chat_id) ausente", kind=self.kind)

        audio = next((a for a in msg.attachments if a.kind == "audio"), None)
        image = next((a for a in msg.attachments if a.kind == "image"), None)

        async with httpx.AsyncClient(timeout=30) as cli:
            if audio and audio.url:
                # sendVoice aceita URL via 'voice' param
                body = {"chat_id": chat_id, "voice": audio.url, "caption": msg.content or ""}
                r = await cli.post(f"{API_BASE}/bot{token}/sendVoice", json=body)
            elif image and image.url:
                body = {"chat_id": chat_id, "photo": image.url, "caption": msg.content or ""}
                r = await cli.post(f"{API_BASE}/bot{token}/sendPhoto", json=body)
            else:
                body = {"chat_id": chat_id, "text": msg.content, "parse_mode": "Markdown"}
                r = await cli.post(f"{API_BASE}/bot{token}/sendMessage", json=body)

        if r.status_code >= 400:
            raise ConnectorError(
                f"Telegram API {r.status_code}: {r.text[:200]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    async def validate_config(self, config: ConnectorConfig) -> bool:
        token = config.data.get("bot_token")
        if not token:
            return False
        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                r = await cli.get(f"{API_BASE}/bot{token}/getMe")
            return r.status_code == 200 and r.json().get("ok") is True
        except Exception:
            return False

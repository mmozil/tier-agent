"""Slack connector (Bot Token + Events API).

Cliente cria um Slack App próprio, pega o **Bot Token** (`xoxb-…`) + **Signing Secret**,
e aponta o Request URL do Event Subscriptions pra:
  https://api-agent.tier.finance/api/v1/webhooks/slack/<connector_id>

Escopos do bot: `chat:write`, `im:history`, `channels:history`, `groups:history`.
Outbound: `chat.postMessage`. Inbound: webhook Events API (evento `message`).
"""

from __future__ import annotations

import logging

import httpx

from services.connectors.base import ConnectorConfig, ConnectorError, OutboundMessage

logger = logging.getLogger(__name__)

API = "https://slack.com/api"


class SlackConnector:
    kind = "slack"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        token = config.data.get("bot_token")
        if not token:
            raise ConnectorError("bot_token ausente", kind=self.kind)
        channel = msg.external_chat_id
        if not channel:
            raise ConnectorError("external_chat_id (slack channel) ausente", kind=self.kind)

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
        payload = {"channel": channel, "text": msg.content or ""}
        async with httpx.AsyncClient(timeout=30) as cli:
            r = await cli.post(f"{API}/chat.postMessage", json=payload, headers=headers)
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code >= 400 or not data.get("ok"):
            raise ConnectorError(
                f"Slack API {r.status_code}: {data.get('error') or r.text[:200]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return data

    async def validate_config(self, config: ConnectorConfig) -> bool:
        token = config.data.get("bot_token")
        if not token:
            return False
        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                r = await cli.get(f"{API}/auth.test", headers={"Authorization": f"Bearer {token}"})
            return r.status_code == 200 and r.json().get("ok") is True
        except Exception:
            return False

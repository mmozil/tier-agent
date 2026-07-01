"""Discord connector (Bot Token + Gateway).

Cliente cria um Discord App próprio, ativa **Message Content Intent**, pega o
**Bot Token** e adiciona o bot ao servidor. Diferente do Slack/Telegram, o Discord
NÃO usa webhook pra inbound — exige uma conexão **Gateway** (websocket persistente).

Divisão de responsabilidades:
  - INBOUND  → `workers/discord_gateway.py` (Gateway websocket, só o worker líder mantém).
  - OUTBOUND → este adapter, via REST `POST /channels/{id}/messages` (funciona de qualquer
    processo; é o que `handle_inbound_message` chama pra responder).

`external_chat_id` = ID do canal Discord (DM ou canal de guild).
"""

from __future__ import annotations

import logging

import httpx

from services.connectors.base import ConnectorConfig, ConnectorError, OutboundMessage

logger = logging.getLogger(__name__)

API = "https://discord.com/api/v10"


class DiscordConnector:
    kind = "discord"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        token = config.data.get("bot_token")
        if not token:
            raise ConnectorError("bot_token ausente", kind=self.kind)
        channel = msg.external_chat_id
        if not channel:
            raise ConnectorError("external_chat_id (discord channel) ausente", kind=self.kind)

        headers = {"Authorization": f"Bot {token}", "Content-Type": "application/json"}
        # Discord corta mensagem em 2000 chars — fatia pra não dar 400.
        text = (msg.content or "")[:2000]
        async with httpx.AsyncClient(timeout=30) as cli:
            r = await cli.post(f"{API}/channels/{channel}/messages", json={"content": text}, headers=headers)
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code >= 400:
            raise ConnectorError(
                f"Discord API {r.status_code}: {data.get('message') or r.text[:200]}",
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
                r = await cli.get(f"{API}/users/@me", headers={"Authorization": f"Bot {token}"})
            return r.status_code == 200 and bool(r.json().get("id"))
        except Exception:
            return False

    async def get_bot_identity(self, token: str) -> dict | None:
        """Retorna {id, username} do bot (id serve de client_id no convite OAuth)."""
        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                r = await cli.get(f"{API}/users/@me", headers={"Authorization": f"Bot {token}"})
            if r.status_code == 200:
                d = r.json()
                return {"id": str(d.get("id") or ""), "username": d.get("username") or ""}
        except Exception:
            return None
        return None

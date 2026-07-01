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
_LIMIT = 2000  # Discord rejeita content > 2000 chars (HTTP 400)


def _split_discord(text: str, limit: int = _LIMIT) -> list[str]:
    """Fatia o texto em blocos <= limit, preferindo quebrar em '\\n' pra não cortar no
    meio de uma frase. Discord corta em 2000 chars — antes truncávamos e a cauda sumia
    calada (ex: dump de status do DevSecOps = 2393 chars). Agora manda em N mensagens."""
    text = text or ""
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    rest = text
    while len(rest) > limit:
        window = rest[:limit]
        cut = window.rfind("\n")
        if cut < int(limit * 0.5):  # sem quebra boa perto do fim → corte duro no limite
            cut = limit
        parts.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    if rest:
        parts.append(rest)
    return parts


class DiscordConnector:
    kind = "discord"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        token = config.data.get("bot_token")
        if not token:
            raise ConnectorError("bot_token ausente", kind=self.kind)
        channel = msg.external_chat_id
        if not channel:
            raise ConnectorError("external_chat_id (discord channel) ausente", kind=self.kind)

        chunks = _split_discord(msg.content or "")
        if not chunks:
            return {}  # nada a enviar (Discord rejeita content vazio)

        headers = {"Authorization": f"Bot {token}", "Content-Type": "application/json"}
        last: dict = {}
        async with httpx.AsyncClient(timeout=30) as cli:
            for part in chunks:
                r = await cli.post(f"{API}/channels/{channel}/messages", json={"content": part}, headers=headers)
                data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                if r.status_code >= 400:
                    raise ConnectorError(
                        f"Discord API {r.status_code}: {data.get('message') or r.text[:200]}",
                        kind=self.kind,
                        status_code=r.status_code,
                    )
                last = data
        return last

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

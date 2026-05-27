"""Instagram DM connector via Meta Graph API.

Outbound: POST /me/messages com message_type=text/audio/image
Inbound: webhook Meta → POST /webhooks/instagram/{ig_user_id}

Config esperado em TaConnector.config_json_enc:
{
  "page_access_token": "EAAxxx...",  # token longa duração da página IG (60d)
  "ig_user_id": "123456789",         # instagram_business_account.id
  "page_id": "987654321"             # facebook page id linked
}

Cliente precisa:
1. Criar app Meta Developers + linkar página FB business
2. Conectar Instagram Business Account a essa página
3. Subscribe `messages` events na FB Page (auto via app review)
4. Configurar webhook Meta apontando pra /webhooks/instagram/{ig_user_id}
   com VERIFY_TOKEN custom + verify mode handler
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

GRAPH_BASE = "https://graph.facebook.com/v21.0"


class InstagramConnector:
    kind = "instagram"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        token = config.data.get("page_access_token")
        ig_user_id = config.data.get("ig_user_id")
        if not token or not ig_user_id:
            raise ConnectorError("page_access_token + ig_user_id obrigatórios", kind=self.kind)

        recipient_id = msg.external_chat_id
        if not recipient_id:
            raise ConnectorError("external_chat_id (Instagram-scoped user ID) obrigatório", kind=self.kind)

        audio = next((a for a in msg.attachments if a.kind == "audio"), None)
        image = next((a for a in msg.attachments if a.kind == "image"), None)

        if audio and audio.url:
            payload = {
                "recipient": {"id": recipient_id},
                "message": {"attachment": {"type": "audio", "payload": {"url": audio.url, "is_reusable": False}}},
            }
        elif image and image.url:
            payload = {
                "recipient": {"id": recipient_id},
                "message": {"attachment": {"type": "image", "payload": {"url": image.url, "is_reusable": False}}},
            }
        else:
            payload = {
                "recipient": {"id": recipient_id},
                "message": {"text": (msg.content or "")[:1000]},
            }

        url = f"{GRAPH_BASE}/{ig_user_id}/messages?access_token={token}"

        try:
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(url, json=payload)
        except Exception as e:
            raise ConnectorError(f"Instagram send conn: {e}", kind=self.kind)

        if r.status_code >= 400:
            raise ConnectorError(
                f"Instagram HTTP {r.status_code}: {r.text[:200]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    async def validate_config(self, config: ConnectorConfig) -> bool:
        token = config.data.get("page_access_token")
        ig_user_id = config.data.get("ig_user_id")
        if not token or not ig_user_id:
            return False
        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                r = await cli.get(f"{GRAPH_BASE}/{ig_user_id}?fields=username&access_token={token}")
            return r.status_code == 200
        except Exception:
            return False

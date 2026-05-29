"""WhatsApp Cloud API (oficial Meta) — connector.

Diferente do Baileys: SEM QR, SEM sessão, SEM socket — REST puro com a Graph API
+ webhook inbound da Meta. Zero risco de ban por automação.

config (TaConnector.config_json_enc):
  {
    "phone_number_id": "<id do número na WABA>",   # usado como instance_id
    "token": "<system user token permanente>",
    "waba_id": "<id da WhatsApp Business Account>", # opcional
    "display_phone": "+55 11 ...."                  # opcional, só pra UI
  }

Envio:  POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
Janela 24h: dentro dela manda texto livre; fora, só template aprovado.
"""

import logging

import httpx

from services.connectors.base import ConnectorConfig, ConnectorError, OutboundMessage

logger = logging.getLogger(__name__)

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"


def normalize_wa_number(chat_id: str | None) -> str:
    """Cloud API espera só dígitos (E.164 sem '+'). O remoteJid pode vir como
    '5511999999999@s.whatsapp.net' ou já como wa_id — fica só os dígitos."""
    return "".join(c for c in (chat_id or "") if c.isdigit())


class WhatsAppCloudConnector:
    kind = "whatsapp_cloud"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        phone_number_id = config.data.get("phone_number_id")
        token = config.data.get("token")
        if not phone_number_id or not token:
            raise ConnectorError(
                "Config Cloud API incompleta (phone_number_id + token)", kind=self.kind
            )

        url = f"{GRAPH_BASE}/{phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        to = normalize_wa_number(msg.external_chat_id)

        image = next((a for a in msg.attachments if a.kind == "image" and a.url), None)
        document = next((a for a in msg.attachments if a.kind == "document" and a.url), None)
        audio = next((a for a in msg.attachments if a.kind == "audio" and a.url), None)

        if image:
            body = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "image",
                "image": {"link": image.url, "caption": msg.content or ""},
            }
        elif document:
            body = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "document",
                "document": {"link": document.url, "caption": msg.content or ""},
            }
        elif audio:
            body = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "audio",
                "audio": {"link": audio.url},
            }
        else:
            body = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"preview_url": True, "body": msg.content or ""},
            }

        async with httpx.AsyncClient(timeout=30) as cli:
            r = await cli.post(url, json=body, headers=headers)
        if r.status_code >= 400:
            # 470/131047 = fora da janela 24h (precisa template). Erro claro pro caller.
            raise ConnectorError(
                f"Cloud API retornou {r.status_code}: {r.text[:300]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    async def send_template(
        self, config: ConnectorConfig, to: str, template_name: str, lang: str = "pt_BR",
        components: list | None = None,
    ) -> dict:
        """Envia template aprovado (pra fora da janela 24h / disparo ativo)."""
        phone_number_id = config.data.get("phone_number_id")
        token = config.data.get("token")
        if not phone_number_id or not token:
            raise ConnectorError("Config Cloud API incompleta", kind=self.kind)
        url = f"{GRAPH_BASE}/{phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        body = {
            "messaging_product": "whatsapp",
            "to": normalize_wa_number(to),
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": lang},
            },
        }
        if components:
            body["template"]["components"] = components
        async with httpx.AsyncClient(timeout=30) as cli:
            r = await cli.post(url, json=body, headers=headers)
        if r.status_code >= 400:
            raise ConnectorError(
                f"Cloud API template {r.status_code}: {r.text[:300]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    async def mark_read_and_typing(self, config: ConnectorConfig, message_id: str) -> None:
        """Marca a mensagem como lida (tique azul) + mostra 'digitando…' pro cliente.

        O indicador some quando você responde OU após 25s (o que vier antes).
        Best practice da Meta: só mostrar digitando se VAI responder. Fire-and-forget.
        """
        pnid = config.data.get("phone_number_id")
        token = config.data.get("token")
        if not pnid or not token or not message_id:
            return
        body = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
            "typing_indicator": {"type": "text"},
        }
        try:
            async with httpx.AsyncClient(timeout=10) as cli:
                await cli.post(
                    f"{GRAPH_BASE}/{pnid}/messages",
                    json=body,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                )
        except Exception as e:
            logger.debug("mark_read_and_typing falhou (ignorando): %s", e)

    async def resolve_media_url(self, token: str, media_id: str) -> str | None:
        """Resolve a URL temporária de uma mídia recebida (precisa do token pra baixar)."""
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.get(
                    f"{GRAPH_BASE}/{media_id}", headers={"Authorization": f"Bearer {token}"}
                )
                if r.status_code != 200:
                    return None
                return r.json().get("url")
        except Exception as e:
            logger.warning("resolve_media_url falhou: %s", e)
            return None

    async def validate_config(self, config: ConnectorConfig) -> bool:
        phone_number_id = config.data.get("phone_number_id")
        token = config.data.get("token")
        if not phone_number_id or not token:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as cli:
                r = await cli.get(
                    f"{GRAPH_BASE}/{phone_number_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
            return r.status_code == 200
        except Exception as e:
            logger.warning("Cloud API validate falhou: %s", e)
            return False

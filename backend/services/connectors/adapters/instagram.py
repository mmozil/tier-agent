"""Instagram DM connector via Meta Graph API.

Outbound: POST /me/messages com message_type=text/audio/image
Inbound: webhook Meta → POST /webhooks/instagram/{ig_user_id}

Config esperado em TaConnector.config_json_enc:
{
  "page_access_token": "EAAxxx...",  # token longa duração da página IG (60d)
  "ig_user_id": "123456789",         # instagram_business_account.id
  "page_id": "987654321"             # facebook page id linked
}

🚨 PRÉ-REQUISITO DE LANÇAMENTO — Advanced Access nas permissões de Instagram.

O nível de acesso da Meta é POR PERMISSÃO, não por app ("each permission and
resource must be approved individually" —
developers.facebook.com/docs/graph-api/overview/access-levels). O App Review
aprovado em 18/jul/2026 cobre `whatsapp_business_messaging` +
`whatsapp_business_management` + `public_profile` e **não vale** pras permissões
do Instagram, que sobem no MESMO app Meta (ver `_instagram_app_secrets` em
routes/webhooks.py). Enquanto elas estiverem em Standard Access:

- o webhook NÃO entrega: "Business apps must have permissions with an advanced
  access level. If your app's permission level is not advanced access, it will
  not receive webhook notifications"
  (developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram)
- o envio é recusado: "Apps with Standard Access can only send messages to
  people that have a role on the app"
  (developers.facebook.com/docs/messenger-platform/instagram/features/send-message)

Como a conta do desenvolvedor TEM papel no app, o teste interno passa inteiro e
só a primeira conta de cliente quebra — e o sintoma (webhook mudo + envio 400)
não aponta pra causa. Por isso está escrito aqui, no caminho do código.

Permissões a submeter no App Review (sabor "Página", que é o que este adapter
usa — POST /{ig_user_id}/messages com page_access_token):
`instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`
+ `pages_show_list` ou `pages_read_engagement`.

O cliente NÃO cria app nem configura webhook: basta conta profissional ligada a
uma página do Facebook e a página conectada ao app da Tier. A Callback URL e o
Verify Token são únicos por app, ficam no App Dashboard da Tier, e o roteamento
sai do `entry[].id` do payload.
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

        # Com PAGE access token o nó de envio é a PÁGINA, não a conta do Instagram
        # (developers.facebook.com/docs/messenger-platform/instagram/features/send-message).
        # `me` resolve pra própria página quando o token é dela, então serve de
        # padrão pra quem conectou sem informar o page_id.
        no = str(config.data.get("page_id") or "").strip() or "me"
        url = f"{GRAPH_BASE}/{no}/messages"

        try:
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {token}"},
                )
        except Exception as e:
            raise ConnectorError(f"Instagram send conn: {e}", kind=self.kind)

        if r.status_code >= 400:
            raise ConnectorError(
                f"Instagram HTTP {r.status_code}: {r.text[:200]}",
                kind=self.kind,
                status_code=r.status_code,
            )
        return r.json()

    # Códigos Graph que significam "o app não tem acesso", e não "o token está errado".
    # 10 e 200 = permissão ausente/negada. O subcode 33 vem com code 100 e é ambíguo
    # (ID errado OU o app não enxerga o objeto) — o texto nomeia as duas hipóteses.
    _CODIGOS_SEM_PERMISSAO = {10, 200}

    _AJUDA_ADVANCED_ACCESS = (
        "As permissões de Instagram do app da Tier (instagram_basic, instagram_manage_messages, "
        "pages_manage_metadata + pages_show_list ou pages_read_engagement) precisam estar em "
        "Advanced Access, aprovadas em App Review próprio — o App Review do WhatsApp não vale, "
        "a Meta aprova permissão por permissão. Em Standard Access a Meta só libera contas que "
        "têm papel no app."
    )

    async def diagnosticar(self, config: ConnectorConfig) -> tuple[bool, str]:
        """Valida as credenciais e, quando falha, devolve o MOTIVO real.

        Existe porque "Credenciais inválidas — confira o token" é a resposta errada
        no modo de falha mais provável deste canal: o token está perfeito e o que
        falta é Advanced Access nas permissões do app. Sem distinguir os dois, quem
        depura vai atrás de token, DNS e assinatura em vez do nível de acesso.
        """
        token = str(config.data.get("page_access_token") or "").strip()
        ig_user_id = str(config.data.get("ig_user_id") or "").strip()
        if not token or not ig_user_id:
            return False, "page_access_token + ig_user_id são obrigatórios."

        try:
            async with httpx.AsyncClient(timeout=8) as cli:
                r = await cli.get(
                    f"{GRAPH_BASE}/{ig_user_id}",
                    params={"fields": "username", "access_token": token},
                )
        except Exception as e:  # noqa: BLE001
            return False, f"Não consegui falar com a Graph API da Meta: {e}"

        if r.status_code == 200:
            return True, ""

        try:
            err = (r.json() or {}).get("error") or {}
        except Exception:  # noqa: BLE001
            err = {}
        codigo = err.get("code")
        subcodigo = err.get("error_subcode")
        detalhe = str(err.get("message") or r.text)[:200]

        if codigo in self._CODIGOS_SEM_PERMISSAO:
            return False, (
                f"A Meta recusou por falta de permissão do app, não por token inválido. "
                f"{self._AJUDA_ADVANCED_ACCESS} Detalhe da Meta: {detalhe}"
            )
        if subcodigo == 33:
            return False, (
                f"A Meta não devolveu essa conta: ou o ID da conta profissional está errado, ou o app "
                f"da Tier não enxerga essa conta. {self._AJUDA_ADVANCED_ACCESS} Detalhe da Meta: {detalhe}"
            )
        if codigo == 190:
            return False, f"Token da página expirado ou revogado — gere um novo. Detalhe da Meta: {detalhe}"
        return False, f"A Meta recusou a validação (HTTP {r.status_code}). Detalhe: {detalhe}"

    async def validate_config(self, config: ConnectorConfig) -> bool:
        ok, _ = await self.diagnosticar(config)
        return ok

    async def assinar_webhook(self, config: ConnectorConfig) -> tuple[bool, str]:
        """Inscreve a página nos eventos de mensagem (`subscribed_apps`).

        Sem esta chamada a Meta NÃO entrega nada: ter o token e ter a Callback URL
        no app não basta, é preciso assinar a página ao app uma vez por conta
        (developers.facebook.com/docs/messenger-platform/instagram/get-started).
        É o passo que falta quando "conectou, validou e nunca chega mensagem".
        """
        token = str(config.data.get("page_access_token") or "").strip()
        no = str(config.data.get("page_id") or "").strip() or "me"
        if not token:
            return False, "page_access_token ausente"
        try:
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{GRAPH_BASE}/{no}/subscribed_apps",
                    params={"subscribed_fields": "messages,messaging_postbacks,message_reactions"},
                    headers={"Authorization": f"Bearer {token}"},
                )
        except Exception as e:  # noqa: BLE001
            return False, f"Não consegui assinar a página nos eventos: {e}"

        if r.status_code == 200 and (r.json() or {}).get("success"):
            return True, ""
        return False, f"A Meta recusou a inscrição da página nos eventos (HTTP {r.status_code}): {r.text[:200]}"

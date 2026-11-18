"""E-mail transacional do Tier Agent (18/11/2026) — hoje só o código de senha.

Mesmo serviço (Resend) e mesmo remetente do ERP (`nao-responda@tier.finance`, domínio verificado lá).
Sem `RESEND_API_KEY`, `configurado()` é falso e quem chama responde «envio de e-mail desligado».
🚨 User-Agent próprio: a Cloudflare na frente do Resend recusa (403) cliente com cara de robô
(aprendido no agente de alerta do SecOps, que usava `Python-urllib`).
"""

from __future__ import annotations

import logging

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
REMETENTE_NOME = "Tier Agent"


class ErroDeEmail(Exception):
    """O e-mail não saiu (sem chave, recusa do Resend ou rede)."""


def configurado() -> bool:
    return bool(get_settings().resend_api_key)


async def enviar(para: str, assunto: str, html: str, texto: str) -> str | None:
    """Envia UM e-mail. Devolve o id do Resend. Levanta `ErroDeEmail` se não saiu."""
    s = get_settings()
    if not s.resend_api_key:
        raise ErroDeEmail("envio de e-mail não configurado")
    corpo = {
        "from": f"{REMETENTE_NOME} <{s.mail_from_email}>",
        "to": [para],
        "subject": assunto,
        "html": html,
        "text": texto,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                RESEND_URL,
                json=corpo,
                headers={
                    "Authorization": f"Bearer {s.resend_api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "TierAgent/1.0 (+https://agent.tier.finance)",
                },
            )
    except httpx.HTTPError as e:
        raise ErroDeEmail(f"sem resposta do serviço de e-mail ({type(e).__name__})") from e
    if r.status_code >= 400:
        logger.warning("resend recusou status=%s corpo=%s", r.status_code, r.text[:200])
        raise ErroDeEmail(f"o serviço de e-mail recusou ({r.status_code})")
    try:
        return (r.json() or {}).get("id")
    except Exception:  # noqa: BLE001
        return None

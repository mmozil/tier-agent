"""Email connector via SMTP outbound.

Inbound: webhook genérico `POST /webhooks/email/{config_id}` aceita payload
Mailgun/Postmark/SES (cliente configura forward upstream pra esse URL).

Outbound: SMTP TLS direto. Suporta qualquer provider (Stalwart Tier,
Gmail, Mailgun, SendGrid, Outlook).

Config esperado em TaConnector.config_json_enc:
{
  "smtp_host": "smtp.tier.finance",
  "smtp_port": 587,
  "smtp_user": "agente@dominio.com",
  "smtp_pass": "...",
  "from_email": "agente@dominio.com",
  "from_name": "Agente Tier",  # opcional
  "use_tls": true
}
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

from services.connectors.base import (
    ConnectorConfig,
    ConnectorError,
    OutboundMessage,
)

logger = logging.getLogger(__name__)


def _send_sync(
    *,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_pass: str,
    from_email: str,
    from_name: str | None,
    to_email: str,
    subject: str,
    body: str,
    use_tls: bool,
) -> dict:
    """SMTP síncrono via smtplib. Rodado em thread executor."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name or "Tier Agent", from_email))
    msg["To"] = to_email

    msg.attach(MIMEText(body, "plain", "utf-8"))
    # versão HTML básica (line breaks viram <br>)
    html_body = body.replace("\n", "<br>")
    msg.attach(MIMEText(f"<html><body>{html_body}</body></html>", "html", "utf-8"))

    if use_tls:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
    else:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as server:
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)

    return {"sent": True, "to": to_email, "subject": subject}


class EmailConnector:
    kind = "email"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        cfg = config.data
        required = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "from_email"]
        for k in required:
            if not cfg.get(k):
                raise ConnectorError(f"Config email incompleto: falta '{k}'", kind=self.kind)

        if not msg.external_chat_id or "@" not in msg.external_chat_id:
            raise ConnectorError("external_chat_id deve ser e-mail válido", kind=self.kind)

        # Subject: extrai 1ª linha ou usa default
        content = msg.content or ""
        if content.startswith("Subject:"):
            lines = content.split("\n", 1)
            subject = lines[0].replace("Subject:", "").strip()
            body = lines[1].strip() if len(lines) > 1 else ""
        else:
            # Usa 1ª linha como subject (max 80 chars)
            lines = content.split("\n", 1)
            subject = lines[0][:80].strip() or "Mensagem do agente"
            body = content

        try:
            result = await asyncio.to_thread(
                _send_sync,
                smtp_host=cfg["smtp_host"],
                smtp_port=int(cfg["smtp_port"]),
                smtp_user=cfg["smtp_user"],
                smtp_pass=cfg["smtp_pass"],
                from_email=cfg["from_email"],
                from_name=cfg.get("from_name"),
                to_email=msg.external_chat_id,
                subject=subject,
                body=body,
                use_tls=bool(cfg.get("use_tls", True)),
            )
            return result
        except smtplib.SMTPException as e:
            raise ConnectorError(f"SMTP error: {e}", kind=self.kind, status_code=550)
        except Exception as e:
            raise ConnectorError(f"Email send: {e}", kind=self.kind)

    async def validate_config(self, config: ConnectorConfig) -> bool:
        cfg = config.data
        for k in ["smtp_host", "smtp_port", "smtp_user", "smtp_pass"]:
            if not cfg.get(k):
                return False

        def _check_sync() -> bool:
            try:
                use_tls = bool(cfg.get("use_tls", True))
                if use_tls:
                    with smtplib.SMTP(cfg["smtp_host"], int(cfg["smtp_port"]), timeout=8) as s:
                        s.starttls()
                        s.login(cfg["smtp_user"], cfg["smtp_pass"])
                else:
                    with smtplib.SMTP_SSL(cfg["smtp_host"], int(cfg["smtp_port"]), timeout=8) as s:
                        s.login(cfg["smtp_user"], cfg["smtp_pass"])
                return True
            except Exception:
                return False

        try:
            return await asyncio.to_thread(_check_sync)
        except Exception:
            return False

"""Protocol BaseConnector — adapter de canal de comunicação.

Espelha o pattern de PaymentProvider do Tier Finance. Cada canal (WhatsApp,
Telegram, Email, etc) implementa essas 4 ops e se registra no registry.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable


@dataclass
class ConnectorAttachment:
    kind: str  # 'image' | 'audio' | 'video' | 'document'
    url: str | None = None  # URL pública (R2) ou caminho local
    mime: str | None = None
    size_bytes: int | None = None
    raw_bytes: bytes | None = None  # quando inline


@dataclass
class InboundMessage:
    connector_kind: str
    agent_id: int
    tenant_id: int
    external_chat_id: str  # número WhatsApp, chat_id Telegram, email From, etc
    sender_name: str | None
    content: str
    attachments: list[ConnectorAttachment] = field(default_factory=list)
    received_at: datetime | None = None
    raw_payload: dict | None = None  # payload cru do canal


@dataclass
class OutboundMessage:
    external_chat_id: str
    content: str
    attachments: list[ConnectorAttachment] = field(default_factory=list)


@dataclass
class ConnectorConfig:
    """Config decifrada (vem do TaConnector.config_json_enc)."""
    # WhatsApp: {instance_id, api_key, phone_number}
    # Telegram: {bot_token, allowed_users}
    # Email: {imap_host, imap_user, imap_pass, smtp_host, smtp_user, smtp_pass}
    # Web form: {webhook_secret}
    data: dict


class ConnectorError(Exception):
    """Erro genérico do connector."""

    def __init__(self, message: str, *, kind: str, status_code: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.status_code = status_code


@runtime_checkable
class BaseConnector(Protocol):
    """Protocol que todo adapter de canal precisa implementar."""

    kind: str  # 'whatsapp' | 'telegram' | 'email' | 'web_form'

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        """Envia mensagem pelo canal. Retorna payload de confirmação."""
        ...

    async def validate_config(self, config: ConnectorConfig) -> bool:
        """Valida que credenciais funcionam (chamada no save do painel)."""
        ...

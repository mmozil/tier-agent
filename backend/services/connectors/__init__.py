"""Connectors — adapters de canais (WhatsApp, Telegram, Email, Web).

Cada connector implementa BaseConnector Protocol. Adapter pluga via registry.
Cliente liga/desliga conector por agente via UI.
"""

from services.connectors.registry import registry

__all__ = ["registry"]

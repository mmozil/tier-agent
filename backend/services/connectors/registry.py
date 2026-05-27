"""Registry singleton de connectors disponíveis."""

import threading

from services.connectors.base import BaseConnector, ConnectorError


class _ConnectorRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._connectors: dict[str, BaseConnector] = {}

    def register(self, connector: BaseConnector) -> None:
        with self._lock:
            self._connectors[connector.kind] = connector

    def get(self, kind: str) -> BaseConnector:
        if kind not in self._connectors:
            raise ConnectorError(f"Connector '{kind}' não registrado", kind=kind)
        return self._connectors[kind]

    def list_kinds(self) -> list[str]:
        return sorted(self._connectors.keys())


registry = _ConnectorRegistry()


def _register_defaults() -> None:
    """Auto-registra adapters disponíveis. Chamado no startup."""
    from services.connectors.adapters.email import EmailConnector
    from services.connectors.adapters.telegram import TelegramConnector
    from services.connectors.adapters.whatsapp import WhatsAppConnector

    registry.register(WhatsAppConnector())
    registry.register(TelegramConnector())
    registry.register(EmailConnector())

    # Instagram / Web form ficam pra próxima fase


_register_defaults()

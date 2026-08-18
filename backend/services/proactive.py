"""Envio proativo (fora do fluxo inbound de webhook) — helpers compartilhados.

Extraído do `_send_proactive` do scheduler (follow-up por inatividade) pra ser reusado
pelo endpoint interno `POST /internal/proactive-whatsapp` (A2): mesma mecânica de achar
o `TaConnector` certo, decriptar a config e enviar pelo adapter do canal.

Imports de `models`/`core.db` são adiados pra dentro das funções — o módulo fica
importável em teste unitário puro (rate-limit / normalização de telefone) sem env de banco.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

# ── Rate-limit simples em memória (janela deslizante por tenant) ─────────────
RATE_MAX_PER_MIN = 30
_RATE_WINDOW_S = 60.0
_rate_buckets: dict[int, deque[float]] = defaultdict(deque)


def check_rate_limit(
    tenant_id: int, *, max_per_min: int = RATE_MAX_PER_MIN, now: float | None = None
) -> bool:
    """True = pode enviar (e consome 1 slot). Janela deslizante de 60s, em memória
    local do worker (suficiente pro contrato do A2 — não precisa ser distribuído)."""
    now = time.monotonic() if now is None else now
    bucket = _rate_buckets[tenant_id]
    while bucket and (now - bucket[0]) > _RATE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= max_per_min:
        return False
    bucket.append(now)
    return True


def normalize_phone(raw: str | None) -> str | None:
    """Só dígitos, com DDI (10–15 dígitos, E.164 sem '+'). None = inválido."""
    digits = re.sub(r"\D", "", raw or "")
    return digits if 10 <= len(digits) <= 15 else None


# ── Lookup de connector + envio ──────────────────────────────────────────────
async def find_agent_connector(db, agent_id: int, kind: str):
    """Connector habilitado de um agente para um canal (mesma busca do follow-up)."""
    from sqlalchemy import select

    from models import TaConnector

    return (
        (
            await db.execute(
                select(TaConnector)
                .where(
                    TaConnector.agent_id == agent_id,
                    TaConnector.kind == kind,
                    TaConnector.enabled.is_(True),
                )
                .order_by(TaConnector.id.asc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )


async def find_tenant_whatsapp_connector(db, tenant_id: int):
    """Connector `whatsapp` (Baileys) habilitado de um agente ATIVO do tenant.

    Só kind='whatsapp' de propósito: o contrato do A2 monta o chat id no formato
    JID `{telefone}@s.whatsapp.net`, que é o endereçamento da Engine/Baileys."""
    from sqlalchemy import select

    from models import TaAgent, TaConnector

    return (
        (
            await db.execute(
                select(TaConnector)
                .join(TaAgent, TaAgent.id == TaConnector.agent_id)
                .where(
                    TaAgent.tenant_id == tenant_id,
                    TaAgent.active.is_(True),
                    TaConnector.kind == "whatsapp",
                    TaConnector.enabled.is_(True),
                )
                .order_by(TaConnector.id.asc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )


async def send_text_via_connector(
    conn, external_chat_id: str, text: str, imagem_url: str | None = None
) -> bool:
    """Envia texto pelo adapter do canal do connector. False = falhou (já logado).

    `imagem_url` (opcional): manda UMA mensagem com a imagem e o texto como
    legenda — nunca duas. O adapter do WhatsApp já trata anexo do tipo 'image'
    (POST .../messages/image com `image_url` + `caption`); canal que não trate
    anexo entrega só o texto, então passar imagem nunca impede a mensagem de
    sair. Parâmetro opcional de propósito: todos os callers antigos seguem
    válidos sem mudança.
    """
    from core.encryption import decrypt
    from services.connectors import registry
    from services.connectors.base import ConnectorAttachment, ConnectorConfig, OutboundMessage

    try:
        impl = registry.get(conn.kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
        anexos = [ConnectorAttachment(kind="image", url=imagem_url)] if imagem_url else []
        await impl.send(
            cfg,
            OutboundMessage(external_chat_id=external_chat_id, content=text, attachments=anexos),
        )
    except Exception:
        logger.exception(
            "envio proativo falhou connector=%s kind=%s chat=%s", conn.id, conn.kind, external_chat_id
        )
        return False
    return True

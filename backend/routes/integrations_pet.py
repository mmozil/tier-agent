"""Endpoint pro Hovio Pet enviar status do atendimento (check-in / etapas / pronto)
PELA instância WhatsApp do agente (Yanna), sem duplicar a credencial da Engine no Pet.

O Pet chama este endpoint; o Tier Agent envia pelo conector do agente — assim o
status sai do MESMO número/sessão que a Yanna usa pra conversar (zero 2ª sessão).

Auth: header `X-Internal-Key` == settings.pet_status_internal_key (chave compartilhada).
"""

import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db
from core.encryption import decrypt
from models import TaConnector
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations/pet", tags=["integrations"])
settings = get_settings()


class SendStatusIn(BaseModel):
    to: str
    text: str
    agent_id: int | None = None  # default = settings.pet_status_agent_id


@router.post("/send-status")
async def send_status(
    body: SendStatusIn,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: AsyncSession = Depends(get_db),
):
    if not settings.pet_status_internal_key or x_internal_key != settings.pet_status_internal_key:
        raise HTTPException(401, "internal key inválida")

    to = (body.to or "").strip()
    text = (body.text or "").strip()
    if not to or not text:
        raise HTTPException(422, "to e text são obrigatórios")

    agent_id = body.agent_id or settings.pet_status_agent_id
    if not agent_id:
        raise HTTPException(400, "agent_id não configurado (PET_STATUS_AGENT_ID)")

    conn = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == agent_id,
                TaConnector.kind == "whatsapp",
                TaConnector.enabled.is_(True),
            )
        )
    ).scalars().first()
    if not conn:
        raise HTTPException(409, "agente sem canal whatsapp ativo")

    try:
        impl = registry.get("whatsapp")
        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
        await impl.send(cfg, OutboundMessage(external_chat_id=to, content=text))
    except Exception as e:  # noqa: BLE001
        logger.exception("send-status falhou agent=%s to=%s", agent_id, to)
        raise HTTPException(502, f"falha ao enviar: {e}")

    return {"ok": True}

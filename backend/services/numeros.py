"""Os números (conectores) de um tenant, com rótulo legível — para a Equipe e o inbox.

O telefone mora no JSON Fernet do conector; aqui é um decrypt por conector, por listagem.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaConnector


def rotulo(cfg: dict, connector_id: int) -> str:
    return str(cfg.get("phone") or cfg.get("display_phone") or cfg.get("label") or f"#{connector_id}")


async def numeros_do_tenant(db: AsyncSession, tenant_id: int) -> list[dict]:
    """[{id, agent_id, member_id, kind, modo, rotulo, status}] dos conectores de WhatsApp do tenant."""
    rows = (
        await db.execute(
            select(TaConnector)
            .join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaAgent.tenant_id == tenant_id, TaConnector.kind.in_(("whatsapp", "whatsapp_cloud")))
            .order_by(TaConnector.id.asc())
        )
    ).scalars().all()
    out: list[dict] = []
    for c in rows:
        try:
            cfg = json.loads(decrypt(c.config_json_enc))
        except Exception:  # noqa: BLE001 — rótulo é luxo
            cfg = {}
        out.append(
            {
                "id": c.id,
                "agent_id": c.agent_id,
                "member_id": getattr(c, "member_id", None),
                "kind": c.kind,
                "modo": getattr(c, "modo", None) or "agente",
                "rotulo": rotulo(cfg, c.id),
                "status": cfg.get("status") or ("connected" if cfg.get("token") else "pending"),
            }
        )
    return out

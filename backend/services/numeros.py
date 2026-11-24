"""Os números (conectores) de um tenant, com rótulo legível — para a Equipe e o inbox.

O telefone mora no JSON Fernet do conector; aqui é um decrypt por conector, por listagem.
"""

from __future__ import annotations

import json
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaConnector

logger = logging.getLogger(__name__)


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


def mesmo_numero_da_casa(external_id: str | None, kind: str | None, configs: list[dict]) -> bool:
    """O contato é um dos números conectados? Função pura: com e sem o 55, com e sem o 9."""
    from services.historico_contato import chave_do_contato, variantes_do_numero

    chave = chave_do_contato(external_id, kind)
    if not chave:
        return False
    alvo = set(variantes_do_numero(chave))
    for cfg in configs:
        for campo in ("phone", "display_phone", "display_phone_number"):
            digitos = re.sub(r"\D", "", str(cfg.get(campo) or ""))
            if len(digitos) >= 10 and alvo & set(variantes_do_numero(digitos)):
                return True
    return False


async def eh_numero_da_casa(
    db: AsyncSession, tenant_id: int, external_id: str | None, kind: str | None = "whatsapp"
) -> bool:
    """Quem escreveu é um dos números conectados da própria conta (colega)?

    🚨 24/11/2026 (M7, cards 4149 e 4150): o Uelinton e outra pessoa da casa escreveram para o 9150 do
    próprio WhatsApp da empresa e viraram LEAD na Qualificação. Antes, a 3995 e a 3997, do mesmo jeito.
    Vale o número mesmo desconectado (o do Uelinton estava esperando o QR).
    Falha aqui nunca segura o atendimento: na dúvida, é cliente.
    """
    try:
        rows = (
            await db.execute(
                select(TaConnector.config_json_enc)
                .join(TaAgent, TaAgent.id == TaConnector.agent_id)
                .where(TaAgent.tenant_id == tenant_id, TaConnector.kind.in_(("whatsapp", "whatsapp_cloud")))
            )
        ).scalars().all()
        configs = []
        for enc in rows:
            try:
                configs.append(json.loads(decrypt(enc)))
            except Exception:  # noqa: BLE001 — um conector ilegível não invalida os outros
                continue
        return mesmo_numero_da_casa(external_id, kind, configs)
    except Exception:
        logger.exception("conferência de número da casa falhou tenant=%s", tenant_id)
        return False

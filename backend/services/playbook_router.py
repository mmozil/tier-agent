"""Router de playbooks — match de triggers contra mensagem inbound.

Decide se uma mensagem deve disparar um playbook (e qual) em vez de
ir direto pro Hermes. Consulta `ta_playbook_trigger_index`.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaPlaybook, TaPlaybookTriggerIndex

logger = logging.getLogger(__name__)


@dataclass
class TriggerMatch:
    playbook_id: int
    agent_id: int
    trigger_type: str
    trigger_node_id: str


async def match_inbound_message(
    db: AsyncSession,
    *,
    agent_id: int,
    text: str,
) -> TriggerMatch | None:
    """Busca trigger que matche `text` pra `agent_id`.

    Ordem de prioridade (Sprint 1):
    1. trigger_keyword (match literal/regex) — mais barato
    2. trigger_intent (LLM classifier) — Sprint 3 — TODO

    Retorna primeiro match (não dispara N playbooks pro mesmo input).
    """
    text_norm = (text or "").strip()
    if not text_norm:
        return None

    # Carrega todos triggers KEYWORD ativos do agente (cache no Redis seria ideal V2)
    rows = (
        await db.execute(
            select(TaPlaybookTriggerIndex, TaPlaybook)
            .join(TaPlaybook, TaPlaybook.id == TaPlaybookTriggerIndex.playbook_id)
            .where(
                TaPlaybookTriggerIndex.agent_id == agent_id,
                TaPlaybookTriggerIndex.enabled.is_(True),
                TaPlaybookTriggerIndex.trigger_type == "trigger_keyword",
                TaPlaybook.status == "published",
            )
            .order_by(TaPlaybookTriggerIndex.id.asc())
        )
    ).all()

    for idx, _pb in rows:
        if _match_keyword(text_norm, idx.trigger_data or {}):
            return TriggerMatch(
                playbook_id=idx.playbook_id,
                agent_id=idx.agent_id,
                trigger_type=idx.trigger_type,
                trigger_node_id=idx.node_id,
            )

    return None


def _match_keyword(text: str, config: dict[str, Any]) -> bool:
    """Checa se text bate em `patterns` conforme `match` (any|all)."""
    patterns = config.get("patterns") or []
    if not isinstance(patterns, list) or not patterns:
        return False
    case_sensitive = bool(config.get("case_sensitive"))
    use_regex = bool(config.get("regex"))
    mode = (config.get("match") or "any").lower()
    haystack = text if case_sensitive else text.lower()

    def hit(pat: str) -> bool:
        if not isinstance(pat, str) or not pat:
            return False
        needle = pat if case_sensitive else pat.lower()
        if use_regex:
            try:
                flags = 0 if case_sensitive else re.IGNORECASE
                return bool(re.search(needle, text, flags))
            except re.error:
                return False
        return needle in haystack

    if mode == "all":
        return all(hit(p) for p in patterns)
    return any(hit(p) for p in patterns)


async def match_manual_trigger(
    db: AsyncSession,
    *,
    playbook_id: int,
    agent_id: int,
) -> TriggerMatch | None:
    """Busca trigger_manual pra dispara via UI (botão 'Disparar')."""
    row = (
        await db.execute(
            select(TaPlaybookTriggerIndex)
            .where(
                TaPlaybookTriggerIndex.playbook_id == playbook_id,
                TaPlaybookTriggerIndex.agent_id == agent_id,
                TaPlaybookTriggerIndex.trigger_type == "trigger_manual",
                TaPlaybookTriggerIndex.enabled.is_(True),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if not row:
        return None
    return TriggerMatch(
        playbook_id=row.playbook_id,
        agent_id=row.agent_id,
        trigger_type="trigger_manual",
        trigger_node_id=row.node_id,
    )

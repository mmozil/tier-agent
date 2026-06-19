"""Nó add_tag — aplica etiqueta(s) na conversa (auto-tag por regra de playbook).

Fecha o gap do "Auto-Tag" aposentado do CRM (Fase 4): combinado com
`trigger_keyword`, faz auto-tagging — ex: trigger_keyword("orçamento") → add_tag("quente").
"""

from __future__ import annotations

import logging

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_add_tag(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Adiciona etiqueta(s) à conversa atual.

    Config:
        tags (list[str] | str): etiquetas (str = separadas por vírgula; suporta vars/templating)
        replace (bool): substitui em vez de somar (default False)
    """
    from core.db import db_context
    from models import TaConversation

    raw = config.get("tags") or []
    if isinstance(raw, str):
        raw = raw.split(",")
    clean: list[str] = []
    for t in raw:
        tt = render_string(str(t), ctx.template_context).strip().lower()[:24]
        if tt and tt not in clean:
            clean.append(tt)
    if not clean:
        return NodeResult(output={"tags": [], "reason": "sem tags"})
    if ctx.conversation_id is None:
        return NodeResult(error="add_tag: sem conversation_id")

    replace = bool(config.get("replace", False))
    try:
        async with db_context() as db:
            conv = await db.get(TaConversation, ctx.conversation_id)
            if not conv:
                return NodeResult(error="add_tag: conversa não encontrada")
            if replace:
                final = clean[:8]
            else:
                existing = list(conv.tags or [])
                final = list(dict.fromkeys([*existing, *clean]))[:8]
            conv.tags = final
            await db.commit()
    except Exception as e:  # noqa: BLE001
        return NodeResult(error=f"add_tag: {e}")

    return NodeResult(output={"tags": final})

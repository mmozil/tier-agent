"""Nó memory_lookup — busca fatos do contato manualmente no playbook.

Útil quando cliente quer customizar QUANDO buscar memory (default: agent_runtime
busca automaticamente em todo inbound). Ex: playbook SDR só busca preferências
depois de qualificação inicial.
"""

from __future__ import annotations

import logging

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_memory_lookup(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Busca memórias do contato sobre uma query.

    Config:
        query (str): pergunta (suporta vars). Default: {{message.text}}
        top_k (int): default 5
        save_as (str): default 'memories'
        save_text_as (str): texto formatado pro prompt, default 'memory_block'
    """
    from core.db import db_context
    from services import memory_service

    query_raw = (config.get("query") or "{{message.text}}").strip()
    save_as = (config.get("save_as") or "memories").strip()
    save_text_as = (config.get("save_text_as") or "memory_block").strip()
    top_k = int(config.get("top_k") or 5)

    query = render_string(query_raw, ctx.template_context)
    if not query:
        return NodeResult(error="memory_lookup: query vazia")

    if not ctx.external_chat_id:
        return NodeResult(output={"hits": 0, "reason": "sem external_chat_id (canal)"})

    try:
        async with db_context() as db:
            hits = await memory_service.search(
                db,
                tenant_id=ctx.tenant_id,
                agent_id=ctx.agent_id,
                external_chat_id=ctx.external_chat_id,
                query=query,
                top_k=top_k,
            )
    except Exception as e:
        return NodeResult(error=f"memory_lookup: {e}")

    items = [
        {
            "id": h.id,
            "fact": h.fact,
            "category": h.category,
            "importance": h.importance,
            "score": round(h.score, 3),
        }
        for h in hits
    ]
    text_block = memory_service.format_for_prompt(hits)

    return NodeResult(
        output={
            "query": query,
            "hits": len(hits),
            "memories_preview": [h.fact[:80] for h in hits[:3]],
        },
        vars_update={save_as: items, save_text_as: text_block},
    )

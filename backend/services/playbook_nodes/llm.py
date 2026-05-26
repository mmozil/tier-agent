"""Nós LLM — llm_step + intent_classifier + knowledge_lookup.

Todos chamam o container Hermes do tenant via hermes_proxy.send_message.
"""

from __future__ import annotations

import json
import logging
import re

from services import hermes_proxy
from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_llm_step(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Chama Hermes pra gerar texto contextual.

    Config:
        system_prompt (str): instrução system, suporta vars
        user_prompt (str, opcional): se omitido, usa {{message.text}}
        temperature (float)  — ignorado por enquanto (vem do config do container)
        save_as (str, opcional): salva resposta em vars[save_as]
        send_text (bool, default true): true = também envia texto pelo canal
    """
    system_prompt_raw = (config.get("system_prompt") or "").strip()
    user_prompt_raw = (config.get("user_prompt") or "{{message.text}}").strip()
    save_as = (config.get("save_as") or "").strip() or None
    send_text = config.get("send_text", True)

    if not system_prompt_raw:
        return NodeResult(error="llm_step: system_prompt vazio")

    system_prompt = render_string(system_prompt_raw, ctx.template_context)
    user_prompt = render_string(user_prompt_raw, ctx.template_context)

    # Cria session específica do playbook+execution pra isolar contexto
    session_id = f"pb-{ctx.playbook_id}-exec-{ctx.execution_id}"

    try:
        from core.db import db_context

        async with db_context() as db:
            reply = await hermes_proxy.send_message(
                tenant_id=ctx.tenant_id,
                user_content=user_prompt,
                db=db,
                session_id=session_id,
                system_override=system_prompt,
            )
    except Exception as e:
        return NodeResult(error=f"llm_step: {e}")

    text = (reply.text or "").strip()

    vars_update = {}
    if save_as and text:
        vars_update[save_as] = text
        # também atualiza template_context pra próximos nós
        ctx.template_context.setdefault("vars", {})[save_as] = text

    if send_text and text:
        ctx.outbound_messages.append({"kind": "text", "content": text})

    # cost aproximado (Hermes não retorna cost — usa tokens)
    cost_cents = 0  # TODO: lookup TaLlmProvider.cost_*_per_1m e calcular

    return NodeResult(
        output={
            "text": text[:500] + ("..." if len(text) > 500 else ""),
            "tokens_in": reply.tokens_in,
            "tokens_out": reply.tokens_out,
            "latency_ms": reply.latency_ms,
            "model": reply.model_used,
            "saved_to": save_as,
        },
        vars_update=vars_update,
    )


async def execute_intent_classifier(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Classifica intent da mensagem via Hermes.

    Config:
        intents (list[str]): lista de intents possíveis
        threshold (float): score mínimo pra match (não usado quando Hermes retorna 1 label)
        save_as (str): salva intent classificado em vars[save_as] (default: 'intent')

    Resultado:
        next_handle = intent classificado (use em branch ou roteia direto)
        vars[save_as] = intent
    """
    intents = config.get("intents") or []
    if not isinstance(intents, list) or not intents:
        return NodeResult(error="intent_classifier: campo 'intents' vazio")
    save_as = (config.get("save_as") or "intent").strip()

    text = ctx.template_context.get("message", {}).get("text", "")
    if not text:
        return NodeResult(output={"intent": None, "reason": "no_message"})

    intent_list = "\n".join(f"- {i}" for i in intents)
    system_prompt = (
        "Você é um classificador de intent. Dado o input do usuário, responda APENAS "
        "com UM dos seguintes intents (sem explicação):\n"
        f"{intent_list}\n\n"
        "Se nenhum intent se aplica, responda 'outro'."
    )

    try:
        from core.db import db_context

        async with db_context() as db:
            reply = await hermes_proxy.send_message(
                tenant_id=ctx.tenant_id,
                user_content=text,
                db=db,
                session_id=f"pb-intent-{ctx.execution_id}",
                system_override=system_prompt,
            )
    except Exception as e:
        return NodeResult(error=f"intent_classifier: {e}")

    raw = (reply.text or "").strip().lower()
    # Match com lista de intents (case-insensitive, primeiro match)
    matched = None
    for intent in intents:
        if intent.lower() in raw:
            matched = intent
            break
    if not matched:
        matched = "outro"

    return NodeResult(
        next_handle=matched,
        output={"intent": matched, "raw_response": raw[:200]},
        vars_update={save_as: matched},
    )


async def execute_knowledge_lookup(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Busca em knowledge do agente via Hermes.

    Config:
        query (str): pergunta (suporta vars)
        top_k (int): número de chunks a recuperar (não controlado por API REST do Hermes — informativo)
        save_as (str): variável onde salvar resultado (default: 'kb_result')
        send_text (bool): se true, envia texto pelo canal

    Implementação MVP: usa llm_step com system_prompt que instrui a usar knowledge.
    V2: endpoint dedicado /v1/search no Hermes (se existir) ou query direto na DB SQLite do container.
    """
    query_raw = (config.get("query") or "{{message.text}}").strip()
    save_as = (config.get("save_as") or "kb_result").strip()
    send_text = config.get("send_text", False)

    query = render_string(query_raw, ctx.template_context)
    if not query:
        return NodeResult(error="knowledge_lookup: query vazia")

    system_prompt = (
        "Você é um assistente que responde APENAS com base na knowledge cadastrada do agente. "
        "Se a informação não está na knowledge, responda 'não encontrei nada relevante'. "
        "Resposta máxima 3 frases."
    )

    try:
        from core.db import db_context

        async with db_context() as db:
            reply = await hermes_proxy.send_message(
                tenant_id=ctx.tenant_id,
                user_content=query,
                db=db,
                session_id=f"pb-kb-{ctx.execution_id}",
                system_override=system_prompt,
            )
    except Exception as e:
        return NodeResult(error=f"knowledge_lookup: {e}")

    text = (reply.text or "").strip()

    if send_text and text:
        ctx.outbound_messages.append({"kind": "text", "content": text})

    return NodeResult(
        output={
            "query": query,
            "result": text[:500] + ("..." if len(text) > 500 else ""),
            "tokens_in": reply.tokens_in,
            "tokens_out": reply.tokens_out,
        },
        vars_update={save_as: text},
    )

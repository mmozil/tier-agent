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

    # cost real via cost_calculator
    try:
        from core.db import db_context
        from services import cost_calculator

        async with db_context() as cdb:
            cost_cents = await cost_calculator.calculate_cost_cents(
                cdb,
                ctx.tenant_id,
                model_used=reply.model_used,
                tokens_in=reply.tokens_in,
                tokens_out=reply.tokens_out,
            )
    except Exception:
        cost_cents = 0

    return NodeResult(
        output={
            "text": text[:500] + ("..." if len(text) > 500 else ""),
            "tokens_in": reply.tokens_in,
            "tokens_out": reply.tokens_out,
            "latency_ms": reply.latency_ms,
            "model": reply.model_used,
            "cost_cents": cost_cents,
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
    """Busca em knowledge via RAG real (pgvector cosine + Cohere Rerank opt).

    Config:
        query (str): pergunta (suporta vars). Default: {{message.text}}
        top_k (int): número de chunks retornados (default 3)
        save_as (str): variável onde salvar texto consolidado (default: 'kb_result')
        save_sources_as (str): variável com lista de sources [{title, position, score}] (default: 'kb_sources')
        send_text (bool): se true, envia resposta pelo canal (default false)
        synthesize (bool): se true, chama Hermes pra sintetizar uma resposta usando os chunks
                           como context (default true). Se false, só retorna chunks brutos.
    """
    query_raw = (config.get("query") or "{{message.text}}").strip()
    save_as = (config.get("save_as") or "kb_result").strip()
    save_sources_as = (config.get("save_sources_as") or "kb_sources").strip()
    send_text = config.get("send_text", False)
    synthesize = config.get("synthesize", True)
    top_k = int(config.get("top_k") or 3)

    query = render_string(query_raw, ctx.template_context)
    if not query:
        return NodeResult(error="knowledge_lookup: query vazia")

    # Busca chunks via RAG engine (pgvector + Cohere rerank)
    from core.db import db_context
    from services import rag_engine

    try:
        async with db_context() as db:
            hits = await rag_engine.search(db, agent_id=ctx.agent_id, query=query, top_k=top_k)
    except Exception as e:
        return NodeResult(error=f"rag_engine.search: {e}")

    sources = [
        {
            "title": h.knowledge_title or f"knowledge-{h.knowledge_id}",
            "knowledge_id": h.knowledge_id,
            "position": h.position,
            "score": round(h.score, 3),
        }
        for h in hits
    ]

    if not hits:
        out_text = "Não encontrei nada relevante na knowledge cadastrada."
        if send_text:
            ctx.outbound_messages.append({"kind": "text", "content": out_text})
        return NodeResult(
            output={"query": query, "hits": 0, "result": out_text, "sources": []},
            vars_update={save_as: out_text, save_sources_as: []},
        )

    # Synthesize: chama Hermes com chunks como context
    if synthesize:
        context_block = "\n\n".join(
            f"[Fonte: {h.knowledge_title or f'#{h.knowledge_id}'} · trecho {h.position}]\n{h.text}"
            for h in hits
        )
        system_prompt = (
            "Você é assistente que responde APENAS usando as fontes abaixo. "
            "Se a info não está nas fontes, diga 'não encontrei isso na base'. "
            "Cite a [Fonte] quando relevante. Máximo 3 frases.\n\n"
            f"FONTES:\n{context_block}"
        )
        try:
            async with db_context() as db:
                reply = await hermes_proxy.send_message(
                    tenant_id=ctx.tenant_id,
                    user_content=query,
                    db=db,
                    session_id=f"pb-kb-{ctx.execution_id}",
                    system_override=system_prompt,
                    agent_id=ctx.agent_id,
                    use_cache=False,  # context custom — não cacheia
                )
            text = (reply.text or "").strip()
        except Exception as e:
            return NodeResult(error=f"knowledge_lookup synth: {e}")
    else:
        # Concat raw chunks
        text = "\n\n".join(h.text for h in hits)

    if send_text and text:
        ctx.outbound_messages.append({"kind": "text", "content": text})

    return NodeResult(
        output={
            "query": query,
            "hits": len(hits),
            "result": text[:500] + ("..." if len(text) > 500 else ""),
            "sources": sources,
        },
        vars_update={save_as: text, save_sources_as: sources},
    )

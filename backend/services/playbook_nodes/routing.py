"""Nó route_to_specialist — multi-agent visual.

Lead agent classifica intent via Hermes → escolhe specialist (sub-persona com
system_prompt próprio) → executa Hermes com esse system_prompt sobrescrito.

Cada specialist tem:
- name (vendas, suporte, financeiro, etc) — vira sourceHandle do nó
- description (1 linha pro classifier)
- system_prompt (persona específica)

Engine roteia retornando `next_handle = name_specialist` — executor segue a edge
do canvas com `sourceHandle === name` (handles dinâmicos por specialist).

Se especialista escolhido tem `auto_reply=true` (default), o nó também responde
imediatamente via Hermes; senão só roteia e o playbook continua.
"""

from __future__ import annotations

import json
import logging
import re

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)

ROUTER_PROMPT = """Você é um router de atendimento. Classifique a mensagem do cliente abaixo escolhendo UM dos especialistas. Responda SOMENTE com o nome (snake_case) do especialista escolhido.

ESPECIALISTAS DISPONÍVEIS:
{specialists_block}

MENSAGEM DO CLIENTE:
{message}

NOME DO ESPECIALISTA (apenas o nome, sem explicação):"""


async def execute_route_to_specialist(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Classifica intent + roteia + opcionalmente responde via specialist.

    Config:
        specialists: list[{name, description, system_prompt, auto_reply?}]
        default_specialist (str, opt): fallback se classifier retorna nada válido
        save_as (str): salva specialist escolhido em vars (default 'specialist')
    """
    raw_specs = config.get("specialists") or []
    if not isinstance(raw_specs, list) or not raw_specs:
        return NodeResult(error="route_to_specialist: lista 'specialists' vazia")

    specs = []
    for s in raw_specs:
        if not isinstance(s, dict):
            continue
        name = re.sub(r"[^a-z0-9_]", "_", str(s.get("name") or "").strip().lower())
        if not name:
            continue
        specs.append(
            {
                "name": name,
                "description": str(s.get("description") or "").strip()[:200],
                "system_prompt": str(s.get("system_prompt") or "").strip(),
                "auto_reply": bool(s.get("auto_reply", True)),
            }
        )
    if not specs:
        return NodeResult(error="route_to_specialist: nenhum specialist válido")

    save_as = (config.get("save_as") or "specialist").strip()
    default_name = (config.get("default_specialist") or specs[0]["name"]).strip()

    message_text = (ctx.template_context.get("message") or {}).get("text") or ""
    if not message_text:
        # sem inbound text — vai pro default
        chosen = next((s for s in specs if s["name"] == default_name), specs[0])
        return NodeResult(
            next_handle=chosen["name"],
            output={"specialist": chosen["name"], "reason": "no_message_default"},
            vars_update={save_as: chosen["name"]},
        )

    # Classifica via Hermes (modelo barato — sem cache pois prompt varia)
    spec_block = "\n".join(f"- {s['name']}: {s['description']}" for s in specs)
    classifier_prompt = ROUTER_PROMPT.format(
        specialists_block=spec_block, message=message_text
    )

    try:
        from core.db import db_context
        from services import hermes_proxy

        async with db_context() as db:
            reply = await hermes_proxy.send_message(
                tenant_id=ctx.tenant_id,
                user_content=classifier_prompt,
                db=db,
                session_id=f"router-{ctx.execution_id}",
                system_override=None,
                agent_id=ctx.agent_id,
                use_cache=False,
            )
    except Exception as e:
        logger.warning("specialist router classifier falhou: %s — usando default", e)
        chosen = next((s for s in specs if s["name"] == default_name), specs[0])
        return NodeResult(
            next_handle=chosen["name"],
            output={"specialist": chosen["name"], "reason": "classifier_error", "error": str(e)},
            vars_update={save_as: chosen["name"]},
        )

    raw = (reply.text or "").strip().lower()
    # Normaliza pra snake_case + match
    raw_norm = re.sub(r"[^a-z0-9_]", "_", raw)

    chosen = None
    for s in specs:
        if s["name"] in raw_norm:
            chosen = s
            break
    if chosen is None:
        chosen = next((s for s in specs if s["name"] == default_name), specs[0])
        logger.info(
            "router: classifier retornou '%s' — sem match, fallback %s",
            raw[:50], chosen["name"],
        )

    output = {
        "specialist": chosen["name"],
        "classifier_response": raw[:100],
        "auto_reply": chosen["auto_reply"],
    }
    vars_update = {save_as: chosen["name"]}

    # Auto-reply: executa Hermes com system_prompt do specialist e envia texto
    if chosen["auto_reply"] and chosen["system_prompt"]:
        try:
            sp = render_string(chosen["system_prompt"], ctx.template_context)
            async with db_context() as db:
                reply = await hermes_proxy.send_message(
                    tenant_id=ctx.tenant_id,
                    user_content=message_text,
                    db=db,
                    session_id=f"specialist-{chosen['name']}-{ctx.execution_id}",
                    system_override=sp,
                    agent_id=ctx.agent_id,
                    use_cache=False,
                )
            text = (reply.text or "").strip()
            if text:
                ctx.outbound_messages.append({"kind": "text", "content": text})
                output["replied"] = True
                output["reply_preview"] = text[:200]
        except Exception as e:
            logger.warning("specialist auto-reply falhou %s: %s", chosen["name"], e)
            output["replied"] = False
            output["reply_error"] = str(e)

    return NodeResult(
        next_handle=chosen["name"],
        output=output,
        vars_update=vars_update,
    )

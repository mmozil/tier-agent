"""Nós de controle de fluxo — branch, wait, set_var."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.playbook_template_engine import evaluate_branch, render_string

from .base import ExecutionContext, NodeResult


async def execute_branch(ctx: ExecutionContext, config: dict) -> NodeResult:
    """If/else.

    Config:
        condition (str): DSL `{{var}} op valor`, ex: `{{message.text|lower}} contains 'oi'`
        operators: contains, not contains, equals, not equals, >, <, >=, <=, starts with, ends with, matches
    """
    cond = (config.get("condition") or "").strip()
    if not cond:
        return NodeResult(next_handle="false", output={"reason": "empty_condition"})

    matched = evaluate_branch(cond, ctx.template_context)
    return NodeResult(
        next_handle="true" if matched else "false",
        output={"matched": matched, "condition": cond},
    )


async def execute_wait(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Pausa execução agendando resume_at.

    Config:
        duration_seconds (int): pausa N segundos a partir de agora
        OR
        until_iso (str): ISO datetime UTC absoluto pra retomar
    """
    duration_s = config.get("duration_seconds")
    until_iso = config.get("until_iso") or config.get("until_time")

    if until_iso:
        return NodeResult(
            pause=True,
            resume_at_iso=str(until_iso),
            output={"wait_until": until_iso},
        )

    try:
        secs = int(duration_s or 0)
    except (TypeError, ValueError):
        return NodeResult(error="wait: duration_seconds inválido")
    if secs <= 0:
        # nada a esperar — só segue
        return NodeResult(output={"wait_seconds": 0, "noop": True})

    resume = datetime.now(timezone.utc) + timedelta(seconds=secs)
    return NodeResult(
        pause=True,
        resume_at_iso=resume.isoformat(),
        output={"wait_seconds": secs, "resume_at": resume.isoformat()},
    )


async def execute_set_var(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Cria/atualiza variável de execução.

    Config:
        key (str): nome da variável
        value (str|num|bool): valor — string suporta `{{vars.X}}` (re-renderizado)
    """
    key = (config.get("key") or "").strip()
    if not key:
        return NodeResult(error="set_var: 'key' vazio")
    raw = config.get("value")
    if isinstance(raw, str):
        rendered = render_string(raw, ctx.template_context)
    else:
        rendered = raw

    return NodeResult(
        output={"key": key, "value": rendered},
        vars_update={key: rendered},
    )

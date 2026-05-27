"""Nó code_step — executa Python via E2B sandbox (Q3.3 CodeAct).

Cliente escreve snippet Python. Engine renderiza vars no código (substitui
{{vars.X}} antes da execução) e roda em sandbox isolado E2B. Stdout/result
salvos em vars[save_as] pra próximo nó usar.

Requer E2B_API_KEY env. Sem ela, retorna erro (sem fallback inseguro).
"""

from __future__ import annotations

import logging

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_code_step(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Executa Python no sandbox E2B.

    Config:
        code (str): snippet Python. Suporta {{vars}} (substitui antes da execução).
        timeout_s (int, default 30)
        save_as (str, default 'code_result'): salva result+stdout em vars[save_as]
        save_stdout_as (str, opcional): salva só stdout
    """
    raw_code = (config.get("code") or "").strip()
    if not raw_code:
        return NodeResult(error="code_step: code vazio")

    timeout_s = int(config.get("timeout_s") or 30)
    save_as = (config.get("save_as") or "code_result").strip()
    save_stdout_as = (config.get("save_stdout_as") or "").strip() or None

    # Render vars no código antes de mandar pro sandbox
    code = render_string(raw_code, ctx.template_context)

    from services import code_executor

    result = await code_executor.execute_python(code, timeout_s=timeout_s)

    if not result.ok:
        return NodeResult(
            output={
                "ok": False,
                "stderr": result.stderr[:500],
                "execution_time_ms": result.execution_time_ms,
            },
            error=result.error or "code_step: execução falhou",
        )

    # Salva resultado nas vars
    output_value = result.result or result.stdout
    vars_update = {save_as: output_value}
    ctx.template_context.setdefault("vars", {})[save_as] = output_value

    if save_stdout_as:
        vars_update[save_stdout_as] = result.stdout
        ctx.template_context["vars"][save_stdout_as] = result.stdout

    return NodeResult(
        output={
            "ok": True,
            "stdout_preview": result.stdout[:500],
            "result_preview": result.result[:500],
            "execution_time_ms": result.execution_time_ms,
            "saved_to": save_as,
        },
        vars_update=vars_update,
    )

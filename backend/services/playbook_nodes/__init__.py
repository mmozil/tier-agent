"""Registry de nós do Playbook Builder.

Cada nó expõe `async def execute(ctx, config) -> NodeResult`.
Tipos suportados Sprint 1:
- triggers: trigger_keyword, trigger_manual (no-op em runtime — match já foi feito)
- actions: send_text, branch, wait, set_var

Sprint 3 adiciona: llm_step, knowledge_lookup, call_api, tier_pay,
handoff_human, trigger_intent, trigger_cron, trigger_event.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from . import flow, text, triggers
from .base import ExecutionContext, NodeResult

NodeExecutor = Callable[[ExecutionContext, dict], Awaitable[NodeResult]]

REGISTRY: dict[str, NodeExecutor] = {
    # Triggers — no runtime, são entry points (executor pula-os após match)
    "trigger_keyword": triggers.execute_noop,
    "trigger_manual": triggers.execute_noop,
    "trigger_intent": triggers.execute_noop,  # Sprint 3 (match no router)
    "trigger_cron": triggers.execute_noop,
    "trigger_event": triggers.execute_noop,
    # Actions Sprint 1
    "send_text": text.execute_send_text,
    "branch": flow.execute_branch,
    "wait": flow.execute_wait,
    "set_var": flow.execute_set_var,
}

__all__ = ["REGISTRY", "ExecutionContext", "NodeResult", "NodeExecutor"]

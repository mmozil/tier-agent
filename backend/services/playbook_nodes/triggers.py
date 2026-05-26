"""Triggers — no runtime são no-op (match já feito pelo router antes do executor)."""

from __future__ import annotations

from .base import ExecutionContext, NodeResult


async def execute_noop(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Trigger nó: nada a fazer, segue pra próxima edge."""
    return NodeResult(output={"triggered": True})

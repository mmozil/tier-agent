"""Contratos compartilhados pelos nós do Playbook Builder."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ExecutionContext:
    """Contexto passado pra cada execução de nó.

    `vars` é mutável e persiste entre nós da mesma execução.
    `outbound_messages` acumula respostas que o executor enviará no canal.
    `template_context` é montado em `_build_template_context()` do executor
    e injeta `contact`, `message`, `conversation`, `vars`, `agent`, `tenant`.
    """

    execution_id: int
    playbook_id: int
    agent_id: int
    tenant_id: int
    conversation_id: int | None
    vars: dict[str, Any] = field(default_factory=dict)
    template_context: dict[str, Any] = field(default_factory=dict)
    outbound_messages: list[dict[str, Any]] = field(default_factory=list)
    # Conector pra enviar mensagens (instanciado pelo executor):
    connector_kind: str | None = None
    external_chat_id: str | None = None


@dataclass
class NodeResult:
    """Resultado da execução de um nó.

    `next_handle` indica por qual saída seguir (default None = pega 1ª edge
    sem sourceHandle, ou se nó só tem 1 saída ela mesma). Em nós tipo `branch`
    deve vir `"true"` ou `"false"` pra escolher a edge.

    `pause` indica que o executor deve PARAR e gravar `resume_at`. Usado
    em `wait` (Sprint 1) e `handoff_human` (Sprint 3).
    """

    next_handle: str | None = None
    pause: bool = False
    resume_at_iso: str | None = None  # ISO datetime UTC
    final_status: str | None = None  # ex: 'handed_off' em handoff_human
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    vars_update: dict[str, Any] = field(default_factory=dict)

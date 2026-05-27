"""Executor de playbooks — percorre grafo (nodes+edges) e executa nós.

Fluxo:
1. Recebe `playbook_id` + `trigger_node_id` + contexto inicial
2. Cria `TaPlaybookExecution` (status=running)
3. A partir do trigger node, percorre edges → executa cada nó → grava
   `TaPlaybookStepLog` por nó
4. Acumula `outbound_messages` no ctx
5. Após terminar (sucesso/erro/pause/handoff), envia mensagens via connector
6. Atualiza execution status final

Decisões:
- DFS single-path (sem fan-out paralelo no MVP) — segue 1 edge por vez
- Detecta loop: limite hard de 500 steps + se mesmo node_id visitado > 50x = break
- Erro num nó → grava step status=error + continua para próxima edge (UX
  igual ManyChat — não trava agente). V2 pode ter "stop on error" opcional.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import (
    TaAgent,
    TaConnector,
    TaConversation,
    TaPlaybook,
    TaPlaybookExecution,
    TaPlaybookStepLog,
    TaTenant,
)
from services.connectors.base import ConnectorConfig, OutboundMessage
from services.connectors.registry import registry as connectors_registry
from services.playbook_nodes import REGISTRY as NODE_REGISTRY
from services.playbook_nodes.base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)

MAX_STEPS_PER_EXECUTION = 500
MAX_VISITS_PER_NODE = 50


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _index_nodes(canvas: dict) -> dict[str, dict]:
    return {n["id"]: n for n in (canvas.get("nodes") or []) if isinstance(n, dict) and n.get("id")}


def _index_edges_from(canvas: dict) -> dict[str, list[dict]]:
    """Mapa: source_id → lista de edges (preserva ordem). Cada edge tem `target` + `sourceHandle?`."""
    out: dict[str, list[dict]] = {}
    for e in (canvas.get("edges") or []):
        if not isinstance(e, dict):
            continue
        src = e.get("source")
        if not src:
            continue
        out.setdefault(src, []).append(e)
    return out


def _pick_next_edge(edges: list[dict], handle: str | None) -> dict | None:
    """Escolhe próxima edge: se `handle` foi indicado, busca match por `sourceHandle`.
    Caso contrário, retorna a 1ª edge (ou sem sourceHandle preferencialmente)."""
    if not edges:
        return None
    if handle:
        for e in edges:
            if e.get("sourceHandle") == handle:
                return e
        # fallback: handle indicado mas não existe — não segue
        return None
    # default — pega 1ª edge sem sourceHandle, ou a 1ª
    for e in edges:
        if not e.get("sourceHandle"):
            return e
    return edges[0]


async def _build_template_context(
    db: AsyncSession,
    *,
    agent: TaAgent,
    tenant: TaTenant | None,
    conversation: TaConversation | None,
    inbound_text: str | None,
    inbound_sender: str | None,
    external_chat_id: str | None,
    vars_state: dict,
) -> dict[str, Any]:
    return {
        "contact": {
            "name": inbound_sender or (conversation.contact_name if conversation else None),
            "from": external_chat_id or (conversation.external_id if conversation else None),
        },
        "message": {
            "text": inbound_text or "",
        },
        "conversation": {
            "id": conversation.id if conversation else None,
            "msg_count": conversation.msg_count if conversation else 0,
            "started_at": conversation.started_at.isoformat() if (conversation and conversation.started_at) else None,
        },
        "agent": {
            "id": agent.id,
            "nome": agent.nome,
            "persona": agent.persona,
        },
        "tenant": {
            "id": tenant.id if tenant else None,
            "nome": tenant.nome if tenant else None,
        },
        "vars": vars_state,
    }


async def run_playbook(
    db: AsyncSession,
    *,
    playbook_id: int,
    trigger_node_id: str,
    trigger_type: str,
    agent_id: int,
    conversation_id: int | None,
    inbound_text: str | None = None,
    inbound_sender: str | None = None,
    connector_kind: str | None = None,
    external_chat_id: str | None = None,
    initial_vars: dict | None = None,
) -> dict[str, Any]:
    """Executa playbook do trigger node em diante.

    Retorna dict com:
        execution_id, status, steps_executed, messages_sent
    """
    pb = await db.get(TaPlaybook, playbook_id)
    if not pb:
        return {"status": "playbook_not_found", "playbook_id": playbook_id}

    agent = await db.get(TaAgent, agent_id)
    if not agent:
        return {"status": "agent_not_found", "agent_id": agent_id}

    # Cria registro de execução
    execution = TaPlaybookExecution(
        playbook_id=pb.id,
        agent_id=agent_id,
        conversation_id=conversation_id,
        trigger_type=trigger_type,
        trigger_node_id=trigger_node_id,
        status="running",
        vars_json=dict(initial_vars or {}),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    return await _run_from_node(
        db,
        pb=pb,
        agent=agent,
        execution=execution,
        start_node_id=trigger_node_id,
        inbound_text=inbound_text,
        inbound_sender=inbound_sender,
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
        initial_vars=initial_vars,
    )


async def resume_playbook(db: AsyncSession, execution_id: int) -> dict[str, Any]:
    """Retoma execution status='waiting' a partir de next_node_id salvo.

    Chamado pelo scheduler.resume_waiting_playbooks_job.
    """
    execution = await db.get(TaPlaybookExecution, execution_id)
    if not execution:
        return {"status": "execution_not_found", "execution_id": execution_id}

    if execution.status != "waiting":
        return {"status": "skipped_not_waiting", "current_status": execution.status}

    if not execution.next_node_id:
        # nada pra retomar — marca completed
        execution.status = "completed"
        execution.completed_at = _now_utc()
        await db.commit()
        return {"status": "completed_noop"}

    pb = await db.get(TaPlaybook, execution.playbook_id)
    agent = await db.get(TaAgent, execution.agent_id)
    if not pb or not agent:
        execution.status = "failed"
        execution.error = "playbook ou agent ausente no resume"
        await db.commit()
        return {"status": "failed", "reason": "missing_pb_or_agent"}

    # Recupera contexto inbound original — pra retomar com mesmo channel
    conv = await db.get(TaConversation, execution.conversation_id) if execution.conversation_id else None
    connector_kind = conv.connector_kind if conv else None
    external_chat_id = conv.external_id if conv else None

    # Marca running antes de processar (evita double-pickup)
    next_node = execution.next_node_id
    execution.status = "running"
    execution.resume_at = None
    execution.next_node_id = None
    await db.commit()

    return await _run_from_node(
        db,
        pb=pb,
        agent=agent,
        execution=execution,
        start_node_id=next_node,
        inbound_text=None,  # mensagem inbound não está mais disponível
        inbound_sender=conv.contact_name if conv else None,
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
        initial_vars=execution.vars_json or {},
    )


async def _run_from_node(
    db: AsyncSession,
    *,
    pb: TaPlaybook,
    agent: TaAgent,
    execution: TaPlaybookExecution,
    start_node_id: str,
    inbound_text: str | None,
    inbound_sender: str | None,
    connector_kind: str | None,
    external_chat_id: str | None,
    initial_vars: dict | None,
) -> dict[str, Any]:
    """Loop principal — percorre grafo a partir de `start_node_id`.

    Extraído pra ser reusado por run_playbook (start = trigger node)
    e resume_playbook (start = next_node_id salvo no pause).
    """
    tenant = await db.get(TaTenant, agent.tenant_id)
    conversation = (
        await db.get(TaConversation, execution.conversation_id) if execution.conversation_id else None
    )

    canvas = pb.canvas_json or {}
    nodes = _index_nodes(canvas)
    edges_from = _index_edges_from(canvas)

    ctx = ExecutionContext(
        execution_id=execution.id,
        playbook_id=pb.id,
        agent_id=agent.id,
        tenant_id=agent.tenant_id,
        conversation_id=execution.conversation_id,
        vars=dict(initial_vars or {}),
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
    )

    ctx.template_context = await _build_template_context(
        db,
        agent=agent,
        tenant=tenant,
        conversation=conversation,
        inbound_text=inbound_text,
        inbound_sender=inbound_sender,
        external_chat_id=external_chat_id,
        vars_state=ctx.vars,
    )

    visit_count: dict[str, int] = {}
    steps_executed = 0
    paused = False
    final_status: str | None = None
    final_error: str | None = None
    next_after_pause: str | None = None

    current_node_id: str | None = start_node_id

    while current_node_id and steps_executed < MAX_STEPS_PER_EXECUTION:
        visit_count[current_node_id] = visit_count.get(current_node_id, 0) + 1
        if visit_count[current_node_id] > MAX_VISITS_PER_NODE:
            logger.warning(
                "playbook %s loop suspeito em node %s — abort", pb.id, current_node_id
            )
            final_error = f"loop detectado em node {current_node_id}"
            break

        node = nodes.get(current_node_id)
        if not node:
            final_error = f"node {current_node_id} não encontrado"
            break

        ntype = node.get("type") or ""
        executor = NODE_REGISTRY.get(ntype)
        if not executor:
            logger.warning("playbook %s nó tipo desconhecido: %s", pb.id, ntype)
            await _log_step(
                db,
                execution_id=execution.id,
                node_id=current_node_id,
                node_type=ntype,
                input={},
                output={},
                status="error",
                latency_ms=0,
                error=f"tipo de nó não suportado: {ntype}",
            )
            steps_executed += 1
            next_edge = _pick_next_edge(edges_from.get(current_node_id) or [], None)
            current_node_id = next_edge["target"] if next_edge else None
            continue

        config = dict(node.get("data") or {})
        ctx.template_context["vars"] = ctx.vars

        t0 = time.perf_counter()
        try:
            result: NodeResult = await executor(ctx, config)
        except Exception as e:  # noqa: BLE001
            logger.exception("playbook %s node %s falhou", pb.id, current_node_id)
            result = NodeResult(error=str(e), output={"exception": True})

        latency_ms = int((time.perf_counter() - t0) * 1000)

        if result.vars_update:
            ctx.vars.update(result.vars_update)

        await _log_step(
            db,
            execution_id=execution.id,
            node_id=current_node_id,
            node_type=ntype,
            input=config,
            output=result.output or {},
            status="error" if result.error else "ok",
            latency_ms=latency_ms,
            error=result.error,
        )

        steps_executed += 1

        if result.final_status:
            final_status = result.final_status
            break

        # Calcula próximo nó (antes de break do pause pra poder salvar)
        next_edge = _pick_next_edge(
            edges_from.get(current_node_id) or [], result.next_handle
        )
        possible_next = next_edge["target"] if next_edge else None

        if result.pause:
            paused = True
            next_after_pause = possible_next
            if result.resume_at_iso:
                try:
                    execution.resume_at = datetime.fromisoformat(
                        result.resume_at_iso.replace("Z", "+00:00")
                    ).replace(tzinfo=None)
                except ValueError:
                    pass
            break

        current_node_id = possible_next

    # Determina status final
    if final_status:
        execution.status = final_status
    elif final_error:
        execution.status = "failed"
        execution.error = final_error
    elif paused:
        execution.status = "waiting"
        execution.next_node_id = next_after_pause
    else:
        execution.status = "completed"
        execution.completed_at = _now_utc()

    execution.vars_json = ctx.vars
    if execution.status in ("completed", "failed", "handed_off"):
        execution.completed_at = _now_utc()
        execution.next_node_id = None
    await db.commit()

    sent = await _flush_outbound(db, ctx)

    return {
        "execution_id": execution.id,
        "status": execution.status,
        "steps_executed": steps_executed,
        "messages_sent": sent,
        "vars": ctx.vars,
        "paused_at_node_next": next_after_pause if paused else None,
    }


async def _log_step(
    db: AsyncSession,
    *,
    execution_id: int,
    node_id: str,
    node_type: str,
    input: dict,
    output: dict,
    status: str,
    latency_ms: int,
    error: str | None = None,
) -> None:
    # Extrai cost_cents do output (nós LLM passam isso em output["cost_cents"])
    cost_cents = 0
    if isinstance(output, dict):
        raw_cost = output.get("cost_cents")
        if isinstance(raw_cost, (int, float)):
            cost_cents = int(raw_cost)
    db.add(
        TaPlaybookStepLog(
            execution_id=execution_id,
            node_id=node_id,
            node_type=node_type,
            input_json=_safe_json(input),
            output_json=_safe_json(output),
            status=status,
            latency_ms=latency_ms,
            cost_cents=cost_cents,
            error=(error or "")[:2000] if error else None,
        )
    )
    await db.flush()


def _safe_json(obj: Any, max_chars: int = 2000) -> Any:
    """Trunca strings grandes + redact keys sensíveis."""
    SENSITIVE = {"api_key", "secret", "token", "password", "authorization"}
    if isinstance(obj, dict):
        return {
            k: ("***redacted***" if k.lower() in SENSITIVE else _safe_json(v, max_chars))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_safe_json(v, max_chars) for v in obj]
    if isinstance(obj, str) and len(obj) > max_chars:
        return obj[:max_chars] + f"...[+{len(obj) - max_chars} chars]"
    return obj


async def _flush_outbound(db: AsyncSession, ctx: ExecutionContext) -> int:
    """Envia mensagens acumuladas via connector."""
    if not ctx.outbound_messages or not ctx.connector_kind or not ctx.external_chat_id:
        return 0

    # Acha connector ativo do agente
    conn_row = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == ctx.agent_id,
                TaConnector.kind == ctx.connector_kind,
                TaConnector.enabled.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not conn_row:
        logger.warning("flush_outbound: sem connector ativo agent=%s kind=%s", ctx.agent_id, ctx.connector_kind)
        return 0

    try:
        connector_impl = connectors_registry.get(ctx.connector_kind)
    except Exception:
        logger.exception("connector kind %s não registrado", ctx.connector_kind)
        return 0

    cfg = ConnectorConfig(data=json.loads(decrypt(conn_row.config_json_enc)))

    sent = 0
    for msg in ctx.outbound_messages:
        if msg.get("kind") != "text":
            continue
        try:
            await connector_impl.send(
                cfg,
                OutboundMessage(
                    external_chat_id=ctx.external_chat_id,
                    content=msg["content"],
                ),
            )
            sent += 1
        except Exception:
            logger.exception("envio playbook falhou agent=%s", ctx.agent_id)

    return sent

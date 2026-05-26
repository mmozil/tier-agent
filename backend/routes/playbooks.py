"""Playbooks — workflow visual estilo N8N + ManyChat híbrido.

CRUD + publish + test-run. Sprint 0 entrega skeleton com CRUD;
Sprint 1 implementa publish (popula trigger_index) + integração no
agent_runtime via playbook_router/executor.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import (
    TaAgent,
    TaPlaybook,
    TaPlaybookExecution,
    TaPlaybookStepLog,
    TaPlaybookTriggerIndex,
)
from services import playbook_executor, playbook_seed

router = APIRouter(prefix="/playbooks", tags=["playbooks"])


# ============================================================
# Schemas
# ============================================================
class PlaybookCreate(BaseModel):
    agent_id: int
    nome: str = Field(min_length=2, max_length=120)
    descricao: str | None = None
    canvas_json: dict[str, Any] = Field(default_factory=lambda: {"version": 1, "nodes": [], "edges": []})


class PlaybookUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    descricao: str | None = None
    canvas_json: dict[str, Any] | None = None


class PlaybookOut(BaseModel):
    id: int
    agent_id: int
    nome: str
    descricao: str | None
    canvas_json: dict[str, Any]
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlaybookListItem(BaseModel):
    """Versão enxuta pra listagem (sem canvas_json — pesado)."""
    id: int
    agent_id: int
    nome: str
    descricao: str | None
    status: str
    nodes_count: int
    published_at: datetime | None
    updated_at: datetime


class PublishResult(BaseModel):
    playbook_id: int
    status: str
    triggers_indexed: int
    published_at: datetime


# ============================================================
# Helpers
# ============================================================
async def _ensure_tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant — finalize signup")
    return user.tenant_id


async def _get_playbook_for_tenant(
    db: AsyncSession, playbook_id: int, tenant_id: int
) -> TaPlaybook:
    pb = await db.get(TaPlaybook, playbook_id)
    if pb is None:
        raise HTTPException(404, "Playbook não encontrado")
    agent = await db.get(TaAgent, pb.agent_id)
    if agent is None or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Playbook não encontrado")
    return pb


async def _validate_agent(db: AsyncSession, agent_id: int, tenant_id: int) -> TaAgent:
    agent = await db.get(TaAgent, agent_id)
    if agent is None or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    return agent


def _nodes_count(canvas_json: dict | None) -> int:
    if not canvas_json:
        return 0
    nodes = canvas_json.get("nodes") or []
    return len(nodes) if isinstance(nodes, list) else 0


_TRIGGER_TYPES = {
    "trigger_keyword",
    "trigger_intent",
    "trigger_manual",
    "trigger_cron",
    "trigger_event",
}


def _validate_canvas_for_publish(canvas: dict) -> list[str]:
    """Retorna lista de erros — vazia se OK pra publicar.

    Checks:
        1. Pelo menos 1 trigger node
        2. Todo trigger leva a algum action (DFS)
        3. Sem ciclos
        4. Edges referenciam nodes existentes
    """
    errors: list[str] = []
    nodes = canvas.get("nodes") or []
    edges = canvas.get("edges") or []

    if not isinstance(nodes, list) or not nodes:
        errors.append("Canvas vazio — adicione pelo menos um nó")
        return errors

    node_ids = {n.get("id") for n in nodes if isinstance(n, dict)}

    # Edges referenciam nodes existentes
    for e in edges:
        if not isinstance(e, dict):
            continue
        src = e.get("source")
        tgt = e.get("target")
        if src not in node_ids:
            errors.append(f"Edge {e.get('id')} referencia source inexistente '{src}'")
        if tgt not in node_ids:
            errors.append(f"Edge {e.get('id')} referencia target inexistente '{tgt}'")

    # Pelo menos 1 trigger
    trigger_ids = [
        n.get("id") for n in nodes
        if isinstance(n, dict) and (n.get("type") or "") in _TRIGGER_TYPES
    ]
    if not trigger_ids:
        errors.append("Nenhum nó de gatilho — adicione um Trigger (Palavra-chave, Manual, etc)")

    # Build adjacency
    adj: dict[str, list[str]] = {}
    for e in edges:
        if not isinstance(e, dict):
            continue
        src = e.get("source")
        tgt = e.get("target")
        if src in node_ids and tgt in node_ids:
            adj.setdefault(src, []).append(tgt)

    # Trigger sem saída (orfão)
    for tid in trigger_ids:
        if not adj.get(tid):
            node = next((n for n in nodes if n.get("id") == tid), {})
            ntype = node.get("type") or "?"
            errors.append(f"Gatilho '{ntype}' não está conectado a nenhuma ação")

    # Detect cycles via DFS coloring (3 colors: white/gray/black)
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in node_ids}

    def has_cycle(start: str) -> str | None:
        stack = [(start, iter(adj.get(start, [])))]
        color[start] = GRAY
        while stack:
            node_id, it = stack[-1]
            try:
                nxt = next(it)
            except StopIteration:
                color[node_id] = BLACK
                stack.pop()
                continue
            if color.get(nxt) == GRAY:
                return f"{node_id} -> {nxt}"
            if color.get(nxt) == WHITE:
                color[nxt] = GRAY
                stack.append((nxt, iter(adj.get(nxt, []))))
        return None

    for tid in trigger_ids:
        if color.get(tid) == WHITE:
            cycle = has_cycle(tid)
            if cycle:
                errors.append(f"Ciclo detectado no fluxo: {cycle}")
                break  # 1 ciclo já é suficiente pra bloquear

    return errors


# ============================================================
# Routes
# ============================================================
class ValidateResult(BaseModel):
    ok: bool
    errors: list[str]


@router.post("/{playbook_id}/validate", response_model=ValidateResult)
async def validate_playbook(
    playbook_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Roda validação sem publicar — UX pra mostrar erros no editor."""
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)
    errors = _validate_canvas_for_publish(pb.canvas_json or {})
    return ValidateResult(ok=not errors, errors=errors)


class TemplateInfo(BaseModel):
    key: str
    nome: str
    descricao: str
    nodes_count: int


class SeedIn(BaseModel):
    agent_id: int
    nome: str | None = None  # se omitido, usa nome do template


@router.get("/templates", response_model=list[TemplateInfo])
async def list_playbook_templates(user: CurrentUser = Depends(get_current_user)):
    """Lista templates prontos (FAQ, Recuperar Carrinho, SDR BANT)."""
    await _ensure_tenant(user)
    return [TemplateInfo(**t) for t in playbook_seed.list_templates()]


@router.post("/seed/{template_key}", response_model=PlaybookOut, status_code=201)
async def seed_from_template(
    template_key: str,
    payload: SeedIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria playbook novo a partir de um template pronto."""
    tenant_id = await _ensure_tenant(user)
    await _validate_agent(db, payload.agent_id, tenant_id)

    tpl = playbook_seed.get_template(template_key)
    if not tpl:
        raise HTTPException(404, f"Template '{template_key}' não encontrado")

    pb = TaPlaybook(
        agent_id=payload.agent_id,
        nome=payload.nome or tpl.nome,
        descricao=tpl.descricao,
        canvas_json=tpl.canvas_json,
        status="draft",
    )
    db.add(pb)
    await db.commit()
    await db.refresh(pb)
    return pb


@router.get("", response_model=list[PlaybookListItem])
async def list_playbooks(
    agent_id: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)

    # join via agent_id pra garantir tenant scope
    stmt = (
        select(TaPlaybook, TaAgent)
        .join(TaAgent, TaAgent.id == TaPlaybook.agent_id)
        .where(TaAgent.tenant_id == tenant_id)
        .order_by(TaPlaybook.updated_at.desc())
    )
    if agent_id is not None:
        stmt = stmt.where(TaPlaybook.agent_id == agent_id)

    rows = (await db.execute(stmt)).all()
    return [
        PlaybookListItem(
            id=pb.id,
            agent_id=pb.agent_id,
            nome=pb.nome,
            descricao=pb.descricao,
            status=pb.status,
            nodes_count=_nodes_count(pb.canvas_json),
            published_at=pb.published_at,
            updated_at=pb.updated_at,
        )
        for pb, _agent in rows
    ]


@router.post("", response_model=PlaybookOut, status_code=201)
async def create_playbook(
    payload: PlaybookCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    await _validate_agent(db, payload.agent_id, tenant_id)

    pb = TaPlaybook(
        agent_id=payload.agent_id,
        nome=payload.nome,
        descricao=payload.descricao,
        canvas_json=payload.canvas_json,
        status="draft",
    )
    db.add(pb)
    await db.commit()
    await db.refresh(pb)
    return pb


@router.get("/{playbook_id}", response_model=PlaybookOut)
async def get_playbook(
    playbook_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    return await _get_playbook_for_tenant(db, playbook_id, tenant_id)


@router.put("/{playbook_id}", response_model=PlaybookOut)
async def update_playbook(
    playbook_id: int,
    payload: PlaybookUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)

    if payload.nome is not None:
        pb.nome = payload.nome
    if payload.descricao is not None:
        pb.descricao = payload.descricao
    if payload.canvas_json is not None:
        pb.canvas_json = payload.canvas_json
        # edição põe de volta em draft se estava publicado
        if pb.status == "published":
            pb.status = "draft"

    await db.commit()
    await db.refresh(pb)
    return pb


@router.delete("/{playbook_id}", status_code=204)
async def delete_playbook(
    playbook_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)
    await db.delete(pb)
    await db.commit()


@router.post("/{playbook_id}/publish", response_model=PublishResult)
async def publish_playbook(
    playbook_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marca como publicado + rebuilds ta_playbook_trigger_index.

    Sprint 0: rebuild síncrono dos triggers. Sprint 1 plugará no router.
    """
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)

    canvas = pb.canvas_json or {}
    nodes = canvas.get("nodes") or []
    if not isinstance(nodes, list):
        raise HTTPException(400, "canvas_json.nodes inválido")

    # Validação estrutural antes de publicar
    errors = _validate_canvas_for_publish(canvas)
    if errors:
        raise HTTPException(400, "Playbook não pode ser publicado: " + " · ".join(errors))

    # apaga triggers antigos do playbook
    await db.execute(
        delete(TaPlaybookTriggerIndex).where(TaPlaybookTriggerIndex.playbook_id == pb.id)
    )

    triggers_indexed = 0
    for node in nodes:
        if not isinstance(node, dict):
            continue
        ntype = node.get("type") or ""
        if ntype not in _TRIGGER_TYPES:
            continue
        node_id = str(node.get("id") or "")[:64]
        node_data = node.get("data") or {}
        if not node_id:
            continue
        idx = TaPlaybookTriggerIndex(
            playbook_id=pb.id,
            agent_id=pb.agent_id,
            node_id=node_id,
            trigger_type=ntype,
            trigger_data=node_data,
            enabled=True,
        )
        db.add(idx)
        triggers_indexed += 1

    pb.status = "published"
    pb.published_at = datetime.utcnow()
    await db.commit()
    await db.refresh(pb)

    return PublishResult(
        playbook_id=pb.id,
        status=pb.status,
        triggers_indexed=triggers_indexed,
        published_at=pb.published_at,
    )


class TestRunIn(BaseModel):
    input_message: str = Field(default="", description="Mensagem simulada (string)")
    sender_name: str | None = "Tester"
    trigger_node_id: str | None = Field(
        default=None,
        description="Se omitido, escolhe o 1º trigger do canvas",
    )
    initial_vars: dict[str, Any] = Field(default_factory=dict)


class TestRunResult(BaseModel):
    execution_id: int
    status: str
    steps_executed: int
    messages_sent: int
    vars: dict[str, Any]
    trigger_node_id: str
    trigger_type: str


@router.post("/{playbook_id}/test-run", response_model=TestRunResult)
async def test_run(
    playbook_id: int,
    payload: TestRunIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Roda o playbook num modo simulado — sem enviar mensagem real ao canal.

    Útil pra debug no editor. Cria TaPlaybookExecution + TaPlaybookStepLog
    igual execução real, mas connector_kind/external_chat_id ficam None
    (executor pula `_flush_outbound` quando ausentes).
    """
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)

    canvas = pb.canvas_json or {}
    nodes = canvas.get("nodes") or []
    triggers = [n for n in nodes if isinstance(n, dict) and (n.get("type") or "").startswith("trigger_")]
    if not triggers:
        raise HTTPException(400, "Playbook sem trigger nodes — adicione um trigger")

    trigger_node_id = payload.trigger_node_id
    if trigger_node_id:
        match = next((n for n in triggers if n.get("id") == trigger_node_id), None)
        if not match:
            raise HTTPException(400, f"trigger_node_id '{trigger_node_id}' não encontrado")
        trigger_type = match.get("type") or "trigger_keyword"
    else:
        first = triggers[0]
        trigger_node_id = first.get("id")
        trigger_type = first.get("type") or "trigger_keyword"

    result = await playbook_executor.run_playbook(
        db,
        playbook_id=pb.id,
        trigger_node_id=trigger_node_id,
        trigger_type=trigger_type,
        agent_id=pb.agent_id,
        conversation_id=None,
        inbound_text=payload.input_message,
        inbound_sender=payload.sender_name,
        connector_kind=None,  # sem canal — não envia mensagens reais
        external_chat_id=None,
        initial_vars=payload.initial_vars,
    )

    return TestRunResult(
        execution_id=result["execution_id"],
        status=result["status"],
        steps_executed=result["steps_executed"],
        messages_sent=result["messages_sent"],
        vars=result.get("vars", {}),
        trigger_node_id=trigger_node_id,
        trigger_type=trigger_type,
    )


@router.post("/{playbook_id}/archive", response_model=PlaybookOut)
async def archive_playbook(
    playbook_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Tira do ar: remove triggers do índice e marca status=archived."""
    tenant_id = await _ensure_tenant(user)
    pb = await _get_playbook_for_tenant(db, playbook_id, tenant_id)
    await db.execute(
        delete(TaPlaybookTriggerIndex).where(TaPlaybookTriggerIndex.playbook_id == pb.id)
    )
    pb.status = "archived"
    await db.commit()
    await db.refresh(pb)
    return pb


# ============================================================
# Executions (read-only no Sprint 0)
# ============================================================
class StepLogOut(BaseModel):
    id: int
    node_id: str
    node_type: str
    status: str
    latency_ms: int | None
    cost_cents: int
    input_json: dict | None
    output_json: dict | None
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExecutionOut(BaseModel):
    id: int
    playbook_id: int
    agent_id: int
    conversation_id: int | None
    trigger_type: str | None
    status: str
    vars_json: dict
    started_at: datetime
    completed_at: datetime | None
    error: str | None

    model_config = {"from_attributes": True}


@router.get("/{playbook_id}/executions", response_model=list[ExecutionOut])
async def list_executions(
    playbook_id: int,
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    await _get_playbook_for_tenant(db, playbook_id, tenant_id)

    rows = (
        await db.execute(
            select(TaPlaybookExecution)
            .where(TaPlaybookExecution.playbook_id == playbook_id)
            .order_by(TaPlaybookExecution.id.desc())
            .limit(max(1, min(limit, 200)))
        )
    ).scalars().all()
    return list(rows)


@router.get("/executions/{execution_id}/steps", response_model=list[StepLogOut])
async def list_execution_steps(
    execution_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    exe = await db.get(TaPlaybookExecution, execution_id)
    if exe is None:
        raise HTTPException(404, "Execução não encontrada")
    # valida tenant via playbook → agent
    await _get_playbook_for_tenant(db, exe.playbook_id, tenant_id)

    rows = (
        await db.execute(
            select(TaPlaybookStepLog)
            .where(TaPlaybookStepLog.execution_id == execution_id)
            .order_by(TaPlaybookStepLog.id.asc())
        )
    ).scalars().all()
    return list(rows)

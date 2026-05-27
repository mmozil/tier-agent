"""MCP server Tier-side — expõe ferramentas Tier pra Claude Desktop/Cursor consumirem.

Implementação MVP: JSON-RPC 2.0 over HTTP (sem SSE streaming — V2).

Tools expostas:
- list_agents(): lista agents do tenant
- list_playbooks(agent_id?): lista playbooks
- get_metrics_overview(days=30): KPIs do tenant
- trigger_playbook(playbook_id, message): dispara playbook manualmente
- send_whatsapp(agent_id, to, text): envia mensagem texto

Auth via Bearer token = JWT do user (mesmo do dashboard).
Cliente conecta no Claude Desktop assim:
  {
    "mcpServers": {
      "tier-agent": {
        "url": "https://api-agent.tier.finance/api/v1/mcp/server",
        "headers": {"Authorization": "Bearer <JWT>"}
      }
    }
  }
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaConversation, TaPlaybook, TaUsageDaily

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mcp", tags=["mcp-server"])


# ─── Tool catalog
TOOLS_SPEC = [
    {
        "name": "list_agents",
        "description": "Lista todos os agentes IA do tenant.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_playbooks",
        "description": "Lista playbooks. agent_id opcional filtra.",
        "inputSchema": {
            "type": "object",
            "properties": {"agent_id": {"type": "integer"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_metrics_overview",
        "description": "KPIs do tenant nos últimos N dias.",
        "inputSchema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "default": 30}},
            "additionalProperties": False,
        },
    },
    {
        "name": "send_whatsapp",
        "description": "Envia mensagem WhatsApp via instância conectada do agente.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer"},
                "to": {"type": "string", "description": "Telefone E.164, ex: 5511999999999"},
                "text": {"type": "string"},
            },
            "required": ["agent_id", "to", "text"],
        },
    },
]


@router.post("/server")
async def mcp_server(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Endpoint MCP JSON-RPC 2.0. Roteia methods: initialize / tools/list / tools/call."""
    try:
        body = await request.json()
    except Exception:
        return _err(None, -32700, "Parse error")

    method = body.get("method")
    req_id = body.get("id")
    params = body.get("params") or {}

    if method == "initialize":
        return _ok(
            req_id,
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "tier-agent", "version": "1.0.0"},
            },
        )

    if method == "tools/list":
        return _ok(req_id, {"tools": TOOLS_SPEC})

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            result = await _execute_tool(name, args, user, db)
        except Exception as e:
            logger.exception("mcp tool %s falhou", name)
            return _err(req_id, -32000, str(e))
        return _ok(req_id, {"content": [{"type": "text", "text": result}]})

    return _err(req_id, -32601, f"Method '{method}' not found")


async def _execute_tool(name: str, args: dict, user: CurrentUser, db: AsyncSession) -> str:
    """Executa tool específica + retorna string serializada pro cliente MCP."""
    import json as _json

    if not user.tenant_id:
        return "Erro: usuário sem tenant"

    if name == "list_agents":
        rows = (
            await db.execute(
                select(TaAgent.id, TaAgent.nome, TaAgent.active).where(
                    TaAgent.tenant_id == user.tenant_id
                )
            )
        ).all()
        return _json.dumps([{"id": r[0], "nome": r[1], "active": r[2]} for r in rows], ensure_ascii=False)

    if name == "list_playbooks":
        agent_id = args.get("agent_id")
        stmt = (
            select(TaPlaybook.id, TaPlaybook.nome, TaPlaybook.status, TaPlaybook.agent_id)
            .join(TaAgent, TaAgent.id == TaPlaybook.agent_id)
            .where(TaAgent.tenant_id == user.tenant_id)
        )
        if agent_id:
            stmt = stmt.where(TaPlaybook.agent_id == agent_id)
        rows = (await db.execute(stmt)).all()
        return _json.dumps(
            [{"id": r[0], "nome": r[1], "status": r[2], "agent_id": r[3]} for r in rows],
            ensure_ascii=False,
        )

    if name == "get_metrics_overview":
        from datetime import datetime, timedelta

        days = int(args.get("days") or 30)
        since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
        totals = (
            await db.execute(
                select(
                    func.coalesce(func.sum(TaUsageDaily.messages), 0),
                    func.coalesce(func.sum(TaUsageDaily.tokens_in), 0),
                    func.coalesce(func.sum(TaUsageDaily.tokens_out), 0),
                    func.coalesce(func.sum(TaUsageDaily.cost_cents), 0),
                ).where(
                    TaUsageDaily.tenant_id == user.tenant_id, TaUsageDaily.day >= since
                )
            )
        ).one()
        convs = (
            await db.execute(
                select(func.count(TaConversation.id))
                .join(TaAgent, TaAgent.id == TaConversation.agent_id)
                .where(TaAgent.tenant_id == user.tenant_id)
            )
        ).scalar_one()
        return _json.dumps(
            {
                "period_days": days,
                "messages": int(totals[0]),
                "tokens_in": int(totals[1]),
                "tokens_out": int(totals[2]),
                "cost_cents": int(totals[3]),
                "cost_brl": round(int(totals[3]) / 100, 2),
                "conversations_total": int(convs or 0),
            },
            ensure_ascii=False,
        )

    if name == "send_whatsapp":
        agent_id = int(args["agent_id"])
        to = str(args["to"])
        text = str(args["text"])
        agent = await db.get(TaAgent, agent_id)
        if not agent or agent.tenant_id != user.tenant_id:
            return "Erro: agente não encontrado ou de outro tenant"

        from sqlalchemy import select as _sel

        from core.encryption import decrypt
        from models import TaConnector
        from services.connectors import registry as conn_registry
        from services.connectors.base import ConnectorConfig, OutboundMessage

        conn = (
            await db.execute(
                _sel(TaConnector).where(
                    TaConnector.agent_id == agent_id,
                    TaConnector.kind == "whatsapp",
                    TaConnector.enabled.is_(True),
                )
            )
        ).scalar_one_or_none()
        if not conn:
            return "Erro: agente sem WhatsApp conectado"

        import json as _j

        cfg = ConnectorConfig(data=_j.loads(decrypt(conn.config_json_enc)))
        adapter = conn_registry.get("whatsapp")
        await adapter.send(cfg, OutboundMessage(external_chat_id=to, content=text))
        return _json.dumps({"sent": True, "to": to, "preview": text[:80]}, ensure_ascii=False)

    return f"Erro: tool '{name}' não suportada"


def _ok(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}

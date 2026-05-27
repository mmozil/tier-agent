"""Nó mcp_tool_call — chama tool de um MCP server externo.

Cliente configura URL do MCP server + nome da tool + args (com template vars).
Resultado salvo em vars[save_as] como texto plano.
"""

from __future__ import annotations

import logging

from services import mcp_client
from services.playbook_template_engine import render_dict, render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_mcp_tool_call(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Chama tool de um MCP server externo via JSON-RPC.

    Config:
        server_url (str): URL do MCP server (https://mcp.notion.com/messages, etc) — suporta vars
        tool_name (str): nome da tool (search, create_page, send_message, etc)
        arguments (dict): args da tool (valores suportam vars)
        auth_header (str, opcional): valor inteiro do header Authorization (ex: "Bearer XXX")
        api_key_header (str, opcional): valor de X-API-Key
        save_as (str, opcional): variável onde salvar resultado (default: mcp_result)
        timeout_s (int): timeout HTTP (default 30)
    """
    server_url_raw = (config.get("server_url") or "").strip()
    tool_name = (config.get("tool_name") or "").strip()
    if not server_url_raw or not tool_name:
        return NodeResult(error="mcp_tool_call: server_url e tool_name obrigatórios")

    server_url = render_string(server_url_raw, ctx.template_context)
    arguments = render_dict(config.get("arguments") or {}, ctx.template_context)
    save_as = (config.get("save_as") or "mcp_result").strip()
    timeout_s = int(config.get("timeout_s") or 30)

    headers: dict[str, str] = {}
    auth = (config.get("auth_header") or "").strip()
    if auth:
        headers["Authorization"] = render_string(auth, ctx.template_context)
    api_key = (config.get("api_key_header") or "").strip()
    if api_key:
        headers["X-API-Key"] = render_string(api_key, ctx.template_context)

    result = await mcp_client.call_tool(
        server_url=server_url,
        tool_name=tool_name,
        arguments=arguments if isinstance(arguments, dict) else {},
        headers=headers or None,
        timeout_s=timeout_s,
    )

    vars_update: dict = {save_as: result.raw_text}
    ctx.template_context.setdefault("vars", {})[save_as] = result.raw_text

    return NodeResult(
        output={
            "tool": tool_name,
            "server": server_url[:80],
            "ok": result.ok,
            "latency_ms": result.latency_ms,
            "result_preview": (result.raw_text or "")[:300],
            "saved_to": save_as,
        },
        vars_update=vars_update,
        error=result.error,
    )

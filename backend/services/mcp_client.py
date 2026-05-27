"""MCP (Model Context Protocol) client minimal — JSON-RPC 2.0 over HTTP.

Spec: https://spec.modelcontextprotocol.io/

Usado pelo nó playbook `mcp_tool_call`. Cliente pluga URL de qualquer MCP server
externo (Notion, Slack, GitHub, Linear, 10k+ no ecossistema 2026) e chama tool
diretamente do canvas.

Implementação MVP: HTTP POST. Não cobre SSE streaming (pra V2 quando virarmos host).
Suporte a Bearer/API key opcional via header.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class McpToolResult:
    ok: bool
    content: list[dict[str, Any]]  # [{type:"text", text:"..."}, ...]
    raw_text: str  # primeira string concat ou JSON serialized
    error: str | None = None
    latency_ms: int = 0


async def call_tool(
    *,
    server_url: str,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout_s: int = 30,
) -> McpToolResult:
    """Chama tool de um MCP server via JSON-RPC 2.0.

    Args:
        server_url: URL completa do endpoint MCP (ex: https://mcp.notion.com/messages)
        tool_name: nome da tool (ex: "search", "create_page")
        arguments: dict de argumentos da tool
        headers: headers extras (Authorization, X-API-Key, etc)
        timeout_s: timeout HTTP
    """
    if not server_url or not tool_name:
        return McpToolResult(ok=False, content=[], raw_text="", error="server_url ou tool_name vazio")

    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments or {},
        },
        "id": int(time.time() * 1000),
    }

    req_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if headers:
        req_headers.update(headers)

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(server_url, json=payload, headers=req_headers)
    except Exception as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return McpToolResult(ok=False, content=[], raw_text="", error=str(e), latency_ms=latency_ms)

    latency_ms = int((time.perf_counter() - t0) * 1000)

    if r.status_code >= 400:
        return McpToolResult(
            ok=False,
            content=[],
            raw_text=r.text[:500],
            error=f"HTTP {r.status_code}",
            latency_ms=latency_ms,
        )

    try:
        body = r.json()
    except Exception as e:
        return McpToolResult(
            ok=False,
            content=[],
            raw_text=r.text[:500],
            error=f"json decode: {e}",
            latency_ms=latency_ms,
        )

    # JSON-RPC error
    if "error" in body:
        err = body["error"]
        return McpToolResult(
            ok=False,
            content=[],
            raw_text=str(err)[:500],
            error=f"{err.get('code', '?')}: {err.get('message', 'unknown')}",
            latency_ms=latency_ms,
        )

    result = body.get("result", {}) or {}
    content = result.get("content") or []
    if not isinstance(content, list):
        content = [{"type": "text", "text": str(content)}]

    # Extrai texto plano dos content blocks pra var fácil
    text_parts = []
    for block in content:
        if isinstance(block, dict):
            if block.get("type") == "text" and block.get("text"):
                text_parts.append(str(block["text"]))
            elif block.get("type") == "json" and "data" in block:
                import json as _json

                text_parts.append(_json.dumps(block["data"], ensure_ascii=False))

    raw_text = "\n".join(text_parts) if text_parts else str(content)[:2000]

    return McpToolResult(ok=True, content=content, raw_text=raw_text, latency_ms=latency_ms)


async def list_tools(server_url: str, headers: dict[str, str] | None = None) -> list[dict]:
    """Lista tools disponíveis no MCP server. Usado em discovery/setup."""
    payload = {"jsonrpc": "2.0", "method": "tools/list", "id": int(time.time() * 1000)}
    req_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(server_url, json=payload, headers=req_headers)
        if r.status_code >= 400:
            return []
        body = r.json()
        return (body.get("result") or {}).get("tools") or []
    except Exception:
        logger.exception("mcp list_tools falhou %s", server_url)
        return []

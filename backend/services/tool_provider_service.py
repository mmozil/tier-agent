"""Federação MCP — descoberta de ferramentas remotas por agente.

Lê os `TaToolProvider` ativos de um agente, descobre as tools de cada servidor MCP
(`mcp_client.list_tools`, com cache TTL em memória pra não bloquear cada mensagem) e
devolve schemas no formato OpenAI-function + handlers async que chamam
`mcp_client.call_tool`. O `tier_engine` mescla isso no loop de tool-use.

Auth POR-PROVIDER: cada provider guarda seu próprio bearer (`bearer_enc`, Fernet) —
OAuth Tier escopado p/ o ERP, HMAC próprio p/ o Pet. O agente nunca vê o token cru.

Cache: in-process TTL (single-process backend). `invalidate_cache()` força refresh
(usado no endpoint `/test` e ao editar/remover provider).
"""

from __future__ import annotations

import hashlib
import logging
import time
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaToolProvider
from services import mcp_client

logger = logging.getLogger(__name__)

_DISCOVERY_TTL_S = 300.0
# key = url|sha256(auth)[:12]  ->  (monotonic_ts, tools)
_discovery_cache: dict[str, tuple[float, list[dict]]] = {}

_MAX_REMOTE_TOOLS = 64  # teto de tools remotas por agente (anti-runaway)

# Circuit-breaker por URL: abre após N falhas seguidas no call path e fica aberto
# por um cooldown — evita o LLM gastar 6×timeout num servidor MCP fora do ar.
_CB_FAILS_TO_OPEN = 3
_CB_COOLDOWN_S = 60.0
_circuit: dict[str, tuple[int, float]] = {}  # url -> (falhas_seguidas, aberto_ate_monotonic)


def _circuit_open(url: str) -> bool:
    st = _circuit.get(url)
    return bool(st and st[1] > time.monotonic())


def _record_success(url: str) -> None:
    _circuit.pop(url, None)


def _record_failure(url: str) -> None:
    fails = _circuit.get(url, (0, 0.0))[0] + 1
    opened_until = time.monotonic() + _CB_COOLDOWN_S if fails >= _CB_FAILS_TO_OPEN else 0.0
    if opened_until:
        logger.warning("tool_provider: circuit ABERTO p/ %s (%d falhas seguidas)", url, fails)
    _circuit[url] = (fails, opened_until)


def build_headers(provider: TaToolProvider) -> dict[str, str]:
    """Headers de auth do provider (Bearer). Vazio se não houver token."""
    if not provider.bearer_enc:
        return {}
    try:
        token = decrypt(provider.bearer_enc)
    except Exception:
        logger.exception("tool_provider %s: falha ao decriptar bearer", provider.id)
        return {}
    return {"Authorization": f"Bearer {token}"}


def _cache_key(url: str, headers: dict[str, str]) -> str:
    auth = headers.get("Authorization", "")
    return url + "|" + hashlib.sha256(auth.encode()).hexdigest()[:12]


def invalidate_cache(url: str | None = None, headers: dict[str, str] | None = None) -> None:
    """Limpa o cache de discovery — tudo (url=None) ou de um provider específico."""
    if url is None:
        _discovery_cache.clear()
        return
    _discovery_cache.pop(_cache_key(url, headers or {}), None)


async def _list_tools_cached(url: str, headers: dict[str, str]) -> list[dict]:
    key = _cache_key(url, headers)
    now = time.monotonic()
    hit = _discovery_cache.get(key)
    if hit and (now - hit[0]) < _DISCOVERY_TTL_S:
        return hit[1]
    # Circuit aberto (falhas no call path): não re-sonda, serve stale-while-open.
    if _circuit_open(url):
        return hit[1] if hit else []
    tools = await mcp_client.list_tools(url, headers or None)
    if tools:
        _record_success(url)  # [] é ambíguo (fora OU sem tools) — só conta sucesso
    _discovery_cache[key] = (now, tools)
    return tools


def _make_handler(
    url: str, real_tool: str, headers: dict[str, str], customer_phone: str | None = None
) -> Callable[[dict], Awaitable[str]]:
    """Closure que chama a tool remota. Encapsula (url, headers, tool) — sem estado global."""

    async def _handler(args: dict[str, Any]) -> str:
        if _circuit_open(url):
            return "[fonte temporariamente indisponível — tente novamente em instantes]"
        # 🔒 IDENTIDADE DO CLIENTE vem do CANAL, não do LLM. O modelo às vezes manda um
        # telefone placeholder (ex.: 11999999999) na busca/cadastro -> casa com o tutor
        # errado (seed "Cliente Teste") e atribui pet/agendamento a outro cliente. Aqui
        # forçamos o telefone REAL do contato nas tools de identificação do cliente.
        if customer_phone:
            if real_tool.endswith("cadastrar_cliente"):
                args = {**args, "telefone": customer_phone}
            elif real_tool.endswith("listar_tutores"):
                args = {**args, "busca": customer_phone}
            elif real_tool.endswith(("criar_agendamento", "cadastrar_pet", "salvar_endereco", "obter_tutor", "historico_pet")):
                # tools que precisam do tutor certo — passa o telefone real pra o Pet
                # resolver o tutor por ele (o modelo às vezes manda nome no tutor_id).
                args = {**args, "_customer_phone": customer_phone}
        res = await mcp_client.call_tool(
            server_url=url, tool_name=real_tool, arguments=args, headers=headers or None
        )
        if res.ok:
            _record_success(url)
            return res.raw_text or "(sem conteúdo)"
        _record_failure(url)
        return f"[ferramenta indisponível: {res.error}]"

    return _handler


async def discover_agent_tools(
    db: AsyncSession, agent_id: int, customer_phone: str | None = None
) -> tuple[list[dict], dict[str, Callable[[dict], Awaitable[str]]]]:
    """Descobre as tools MCP de todos os providers ativos do agente.

    Retorna `(schemas OpenAI-function, mapa nome->handler)`. O nome de cada tool é
    prefixado com o id do provider (`mN_<tool>`) pra evitar colisão entre servidores.
    Falha de um provider degrada com log — não derruba os demais nem a resposta.
    """
    rows = (
        await db.execute(
            select(TaToolProvider)
            .where(TaToolProvider.agent_id == agent_id, TaToolProvider.enabled.is_(True))
            .order_by(TaToolProvider.priority.asc(), TaToolProvider.id.asc())
        )
    ).scalars().all()

    schemas: list[dict] = []
    handlers: dict[str, Callable[[dict], Awaitable[str]]] = {}

    for p in rows:
        # Conexão OAuth: renova o access_token se está pra expirar (refresh c/ rotação).
        # Token novo muda o cache-key do discovery automaticamente (hash do auth).
        try:
            from services import oauth_connect

            await oauth_connect.ensure_fresh_token(db, p)
        except Exception:
            logger.exception("tool_provider %s: refresh check falhou", p.id)
        headers = build_headers(p)
        try:
            tools = await _list_tools_cached(p.mcp_server_url, headers)
        except Exception:
            logger.exception("tool_provider %s (%s): list_tools falhou", p.id, p.nome)
            continue
        for t in tools:
            if len(schemas) >= _MAX_REMOTE_TOOLS:
                logger.warning(
                    "tool_provider: teto de %d tools remotas atingido (agent=%s) — resto ignorado",
                    _MAX_REMOTE_TOOLS, agent_id,
                )
                return schemas, handlers
            real = t.get("name")
            if not real:
                continue
            prefixed = f"m{p.id}_{real}"
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": prefixed,
                        "description": (t.get("description") or "")[:1024],
                        "parameters": t.get("inputSchema") or {"type": "object", "properties": {}},
                    },
                }
            )
            handlers[prefixed] = _make_handler(p.mcp_server_url, real, headers, customer_phone)

    return schemas, handlers

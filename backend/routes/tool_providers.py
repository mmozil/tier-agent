"""Tool Providers — fontes de ferramentas MCP plugadas a um agente (federação).

CRUD do "plug": cada provider é um servidor MCP externo (ERP Tier Empresas, Hovio
Pet, etc.) que o agente passa a poder consultar via tool-use. Ligar = criar/ativar;
desligar = desativar/remover. O token (bearer) é criptografado e NUNCA retornado.

Escopo por tenant: toda operação valida que o agente pertence ao tenant do usuário.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import encrypt
from models import TaAgent, TaToolProvider

router = APIRouter(prefix="/agents/{agent_id}/tool-providers", tags=["tool-providers"])

# Callback OAuth (popup volta sem agent_id na URL — o state carrega o contexto)
oauth_router = APIRouter(prefix="/tool-providers/oauth", tags=["tool-providers"])


# ─── Schemas
class ToolProviderCreate(BaseModel):
    nome: str
    mcp_server_url: str
    bearer: str | None = None  # token cru — criptografado no servidor, nunca volta
    priority: int = 100
    enabled: bool = True


class ToolProviderUpdate(BaseModel):
    """Patch parcial. `bearer` presente re-criptografa; `bearer=""` remove a credencial."""

    nome: str | None = None
    mcp_server_url: str | None = None
    bearer: str | None = None
    priority: int | None = None
    enabled: bool | None = None


class ToolProviderOut(BaseModel):
    id: int
    agent_id: int
    tenant_id: int
    nome: str
    mcp_server_url: str
    enabled: bool
    priority: int
    has_bearer: bool
    last_test_at: datetime | None
    last_test_ok: bool | None
    last_tools_count: int


def _to_out(p: TaToolProvider) -> ToolProviderOut:
    return ToolProviderOut(
        id=p.id,
        agent_id=p.agent_id,
        tenant_id=p.tenant_id,
        nome=p.nome,
        mcp_server_url=p.mcp_server_url,
        enabled=p.enabled,
        priority=p.priority,
        has_bearer=bool(p.bearer_enc),
        last_test_at=p.last_test_at,
        last_test_ok=p.last_test_ok,
        last_tools_count=p.last_tools_count,
    )


async def _load_agent(agent_id: int, user: CurrentUser, db: AsyncSession) -> TaAgent:
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant — finalize signup")
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != user.tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    return agent


async def _load_provider(
    agent_id: int, provider_id: int, user: CurrentUser, db: AsyncSession
) -> TaToolProvider:
    await _load_agent(agent_id, user, db)
    p = await db.get(TaToolProvider, provider_id)
    if not p or p.agent_id != agent_id:
        raise HTTPException(404, "Fonte de dados não encontrada")
    return p


@router.get("", response_model=list[ToolProviderOut])
async def list_providers(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _load_agent(agent_id, user, db)
    rows = (
        await db.execute(
            select(TaToolProvider)
            .where(TaToolProvider.agent_id == agent_id)
            .order_by(TaToolProvider.priority.asc(), TaToolProvider.id.asc())
        )
    ).scalars().all()
    return [_to_out(p) for p in rows]


@router.post("", response_model=ToolProviderOut, status_code=201)
async def create_provider(
    agent_id: int,
    payload: ToolProviderCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    agent = await _load_agent(agent_id, user, db)
    nome = payload.nome.strip()
    url = payload.mcp_server_url.strip()
    if not nome or not url:
        raise HTTPException(400, "nome e mcp_server_url são obrigatórios")
    p = TaToolProvider(
        agent_id=agent_id,
        tenant_id=agent.tenant_id,
        nome=nome,
        mcp_server_url=url,
        bearer_enc=encrypt(payload.bearer) if payload.bearer else None,
        priority=payload.priority,
        enabled=payload.enabled,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    _invalidate_discovery()
    return _to_out(p)


@router.patch("/{provider_id}", response_model=ToolProviderOut)
async def update_provider(
    agent_id: int,
    provider_id: int,
    payload: ToolProviderUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await _load_provider(agent_id, provider_id, user, db)
    data = payload.model_dump(exclude_unset=True)
    if "nome" in data and data["nome"] is not None:
        p.nome = data["nome"].strip()
    if "mcp_server_url" in data and data["mcp_server_url"]:
        p.mcp_server_url = data["mcp_server_url"].strip()
    if "priority" in data and data["priority"] is not None:
        p.priority = data["priority"]
    if "enabled" in data and data["enabled"] is not None:
        p.enabled = data["enabled"]
    if "bearer" in data:  # presente → troca a credencial ("" remove)
        bearer = data["bearer"]
        p.bearer_enc = encrypt(bearer) if bearer else None
    await db.commit()
    await db.refresh(p)
    _invalidate_discovery()
    return _to_out(p)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    agent_id: int,
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await _load_provider(agent_id, provider_id, user, db)
    await db.delete(p)
    await db.commit()
    _invalidate_discovery()


class OAuthStartRequest(BaseModel):
    preset: str  # ex: "tier-erp"


@router.post("/oauth/start")
async def oauth_start(
    agent_id: int,
    payload: OAuthStartRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Inicia a conexão OAuth de um preset: devolve a URL de autorização pro
    frontend abrir em popup (PKCE + state gerados aqui). Usuário nunca vê token."""
    agent = await _load_agent(agent_id, user, db)
    from services import oauth_connect

    try:
        url = oauth_connect.start_connect(
            agent_id=agent.id, tenant_id=agent.tenant_id, preset_key=payload.preset
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    return {"authorize_url": url}


class OAuthCallbackRequest(BaseModel):
    state: str
    code: str


@oauth_router.post("/callback", response_model=ToolProviderOut)
async def oauth_callback(
    payload: OAuthCallbackRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Popup voltou da tela de autorização: troca o code por tokens e salva o provider."""
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant")
    from services import oauth_connect, tool_provider_service

    try:
        provider = await oauth_connect.complete_connect(
            db, state=payload.state, code=payload.code, tenant_id=user.tenant_id
        )
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(502, f"Falha ao trocar código por token: {e}") from e
    tool_provider_service.invalidate_cache()
    return _to_out(provider)


@router.post("/{provider_id}/test")
async def test_provider(
    agent_id: int,
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verifica a conexão com o MCP server: lista as tools e grava o resultado."""
    from services import mcp_client, tool_provider_service

    p = await _load_provider(agent_id, provider_id, user, db)
    headers = tool_provider_service.build_headers(p)
    tool_provider_service.invalidate_cache(p.mcp_server_url, headers)
    tools = await mcp_client.list_tools(p.mcp_server_url, headers or None)
    p.last_test_at = datetime.utcnow()
    p.last_test_ok = bool(tools)
    p.last_tools_count = len(tools)
    await db.commit()
    return {
        "ok": bool(tools),
        "tools_count": len(tools),
        "tools": [t.get("name") for t in tools if isinstance(t, dict)],
        # nome + descrição (PT, vem do próprio MCP server) — a UI mostra
        # "o que o agente pode fazer" em linguagem humana
        "tools_detail": [
            {"name": t.get("name"), "description": (t.get("description") or "")[:200]}
            for t in tools
            if isinstance(t, dict) and t.get("name")
        ],
    }


def _invalidate_discovery() -> None:
    try:
        from services import tool_provider_service

        tool_provider_service.invalidate_cache()
    except Exception:
        pass

"""Conexão OAuth das integrações MCP — fluxo "Conectar → Autorizar → pronto".

Padrão Claude↔Notion: o usuário clica Conectar num card, abre a tela de autorização
da fonte (já logado via SSO Tier), clica Permitir, e o popup volta pro callback —
o backend troca o código por tokens (PKCE S256) e guarda criptografado. O usuário
NUNCA vê token. Renovação automática via refresh_token (rotação a cada uso).

PRESETS = fontes conhecidas (catálogo). Pra adicionar um produto novo: registrar o
client/escopos no OAuth Tier + 1 entrada aqui + 1 card no frontend.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt, encrypt
from models import TaToolProvider

logger = logging.getLogger(__name__)
settings = get_settings()

# Fontes conectáveis via OAuth (key = preset do frontend)
PRESETS: dict[str, dict] = {
    "tier-erp": {
        "nome": "Tier Empresas (ERP)",
        "authorize_url": "https://erp.tier.finance/oauth/authorize",
        "token_url": "https://api.tier.finance/api/oauth/token",
        "mcp_url": "https://api.tier.finance/api/mcp/erp/server",
        "scope": "financeiro:read vendas:read vendas:write conversas:read clientes:read",
        "client_id": "tier-agent",
        "secret_env": "TIER_OAUTH_CLIENT_SECRET",
    },
    "hovio-pet": {
        "nome": "Hovio Pet",
        # O Pet é servidor OAuth próprio (separado do Tier) — authorize/token no pet.hovio.com.br
        "authorize_url": "https://pet.hovio.com.br/oauth/authorize",
        "token_url": "https://pet.hovio.com.br/oauth/token",
        "mcp_url": "https://pet.hovio.com.br/api/mcp",
        # STAFF (copiloto interno): acesso amplo — agenda/financeiro/conversas de todos.
        "scope": "pet:read pet:write pet:whatsapp",
        "client_id": "tier-agent",
        "secret_env": "HOVIO_PET_OAUTH_CLIENT_SECRET",
    },
    "hovio-pet-customer": {
        "nome": "Hovio Pet (atendimento ao cliente)",
        # CUSTOMER (agente que fala com o cliente final): SÓ tools escopadas ao próprio
        # cliente. O scope pet:customer faz o servidor MCP do Pet esconder/bloquear as tools
        # petshop-wide (agenda/conversas/financeiro/vacinas/envio avulso) — anti-vazamento.
        "authorize_url": "https://pet.hovio.com.br/oauth/authorize",
        "token_url": "https://pet.hovio.com.br/oauth/token",
        "mcp_url": "https://pet.hovio.com.br/api/mcp",
        "scope": "pet:customer",
        "client_id": "tier-agent",
        "secret_env": "HOVIO_PET_OAUTH_CLIENT_SECRET",
    },
}


def _preset_client_id(preset: dict) -> str:
    return preset.get("client_id") or settings.tier_oauth_client_id


def _preset_secret(preset: dict) -> str:
    return os.getenv(preset.get("secret_env", "") or "", "") or ""


def _creds_for_token_url(token_url: str) -> tuple[str, str]:
    for p in PRESETS.values():
        if p["token_url"] == token_url:
            return _preset_client_id(p), _preset_secret(p)
    return settings.tier_oauth_client_id, settings.tier_oauth_client_secret

# Handshakes pendentes (state → contexto). In-process com TTL — backend single-process;
# restart no meio do popup = usuário clica Conectar de novo.
_PENDING_TTL_S = 600.0
_pending: dict[str, dict] = {}


def _purge_pending() -> None:
    now = time.monotonic()
    for k in [k for k, v in _pending.items() if now - v["ts"] > _PENDING_TTL_S]:
        _pending.pop(k, None)


def start_connect(*, agent_id: int, tenant_id: int, preset_key: str) -> str:
    """Gera PKCE + state e devolve a URL de autorização pro frontend abrir em popup."""
    preset = PRESETS.get(preset_key)
    if not preset:
        raise ValueError(f"preset desconhecido: {preset_key}")
    if not _preset_secret(preset):
        raise RuntimeError(f"secret do preset '{preset_key}' não configurado (env {preset.get('secret_env')})")

    _purge_pending()
    verifier = secrets.token_urlsafe(48)  # 64 chars (43-128 exigido pelo PKCE)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    state = secrets.token_urlsafe(24)
    _pending[state] = {
        "verifier": verifier,
        "agent_id": agent_id,
        "tenant_id": tenant_id,
        "preset_key": preset_key,
        "ts": time.monotonic(),
    }

    params = {
        "client_id": _preset_client_id(preset),
        "redirect_uri": settings.tier_oauth_redirect_uri,
        "scope": preset["scope"],
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "state": state,
    }
    return f"{preset['authorize_url']}?{urlencode(params)}"


async def complete_connect(
    db: AsyncSession, *, state: str, code: str, tenant_id: int
) -> TaToolProvider:
    """Callback: valida o state, troca o code por tokens e cria/atualiza o provider."""
    _purge_pending()
    pending = _pending.pop(state, None)
    if not pending:
        raise ValueError("state inválido ou expirado — clique em Conectar novamente")
    if pending["tenant_id"] != tenant_id:
        raise PermissionError("state de outro tenant")

    preset = PRESETS[pending["preset_key"]]
    tokens = await _token_request(
        preset["token_url"],
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.tier_oauth_redirect_uri,
            "code_verifier": pending["verifier"],
        },
        _preset_client_id(preset),
        _preset_secret(preset),
    )

    expires_at = datetime.utcnow() + timedelta(seconds=int(tokens.get("expires_in") or 86400))
    # Reconectar = atualizar o provider existente do mesmo agente+URL (não duplicar)
    row = (
        await db.execute(
            select(TaToolProvider).where(
                TaToolProvider.agent_id == pending["agent_id"],
                TaToolProvider.mcp_server_url == preset["mcp_url"],
            )
        )
    ).scalars().first()
    if row is None:
        row = TaToolProvider(
            agent_id=pending["agent_id"],
            tenant_id=tenant_id,
            nome=preset["nome"],
            mcp_server_url=preset["mcp_url"],
        )
        db.add(row)
    row.bearer_enc = encrypt(tokens["access_token"])
    row.refresh_enc = encrypt(tokens["refresh_token"]) if tokens.get("refresh_token") else None
    row.token_expires_at = expires_at
    row.token_url = preset["token_url"]
    row.enabled = True
    await db.commit()
    await db.refresh(row)
    logger.info("oauth_connect: provider %s conectado (agent=%s, expira %s)", row.id, row.agent_id, expires_at)
    return row


async def ensure_fresh_token(db: AsyncSession, provider: TaToolProvider) -> None:
    """Renova o access_token se expira em <10min (refresh com rotação). Falha degrada
    com log — o token velho segue no row (a fonte devolve 401 e a tool fica indisponível)."""
    if not provider.token_url or not provider.refresh_enc or not provider.token_expires_at:
        return
    if provider.token_expires_at > datetime.utcnow() + timedelta(minutes=10):
        return
    try:
        cid, sec = _creds_for_token_url(provider.token_url)
        tokens = await _token_request(
            provider.token_url,
            {"grant_type": "refresh_token", "refresh_token": decrypt(provider.refresh_enc)},
            cid,
            sec,
        )
        provider.bearer_enc = encrypt(tokens["access_token"])
        if tokens.get("refresh_token"):
            provider.refresh_enc = encrypt(tokens["refresh_token"])
        provider.token_expires_at = datetime.utcnow() + timedelta(
            seconds=int(tokens.get("expires_in") or 86400)
        )
        await db.commit()
        logger.info("oauth_connect: token renovado provider=%s", provider.id)
    except Exception:
        logger.exception("oauth_connect: refresh falhou provider=%s", provider.id)


async def _token_request(token_url: str, data: dict, client_id: str, client_secret: str) -> dict:
    """POST form no endpoint /token (client creds no corpo, RFC 6749)."""
    payload = {
        **data,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(token_url, data=payload)
    if r.status_code >= 400:
        raise RuntimeError(f"token endpoint {r.status_code}: {r.text[:300]}")
    return r.json()

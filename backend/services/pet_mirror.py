"""Espelho de conversas pro Hovio Pet — push em TEMPO REAL.

Chamado fire-and-forget logo após uma mensagem ser processada (inbound + reply),
pra a conversa aparecer no painel do petshop quase instantaneamente — sem esperar
o job periódico. Lê de `ta_message_log` (mesma fonte do job) → `criadaEm` idêntico
→ o dedup do Pet (Set por criadaEm|papel) evita duplicar entre real-time e job.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select

logger = logging.getLogger("tier-agent.pet_mirror")


async def mirror_recent_to_pet(agent_id: int, conv_id: int, lookback_min: int = 10) -> None:
    """Empurra as mensagens recentes de UMA conversa pro Hovio Pet, se o agente
    estiver conectado a um petshop (tool_provider hovio-pet). Best-effort: falha
    só loga. Sessão de DB própria (roda fora do request)."""
    try:
        from core.db import db_context
        from core.encryption import decrypt
        from models import TaAgent, TaConversation, TaMessageLog, TaToolProvider
        from services import oauth_connect

        async with db_context() as db:
            provider = (
                await db.execute(
                    select(TaToolProvider).where(
                        TaToolProvider.agent_id == agent_id,
                        TaToolProvider.enabled.is_(True),
                        TaToolProvider.mcp_server_url.like("%pet.hovio.com.br%"),
                    )
                )
            ).scalars().first()
            if not provider:
                return  # agente não está conectado a um petshop

            conv = await db.get(TaConversation, conv_id)
            if not conv:
                return
            tel = re.sub(r"\D", "", (conv.external_id or "").split("@")[0])
            if not tel:
                return

            await oauth_connect.ensure_fresh_token(db, provider)
            if not provider.bearer_enc:
                return
            token = decrypt(provider.bearer_enc)
            base = provider.mcp_server_url.split("/api/mcp")[0]
            agente = await db.get(TaAgent, agent_id)

            since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=lookback_min)
            rows = (
                await db.execute(
                    select(TaMessageLog)
                    .where(
                        TaMessageLog.conversation_id == conv_id,
                        TaMessageLog.created_at > since,
                        TaMessageLog.role.in_(("user", "assistant", "agent")),
                        TaMessageLog.content.isnot(None),
                    )
                    .order_by(TaMessageLog.id.asc())
                    .limit(30)
                )
            ).scalars().all()
            if not rows:
                return

            payload = [
                {
                    "telefone": tel,
                    "nome": conv.contact_name,
                    "papel": "user" if m.role == "user" else "assistant",
                    "conteudo": m.content,
                    "criadaEm": m.created_at.isoformat() + "Z",
                }
                for m in rows
            ]
            async with httpx.AsyncClient(timeout=15) as cli:
                r = await cli.post(
                    f"{base}/api/agent/mirror",
                    headers={"Authorization": f"Bearer {token}"},
                    json={
                        "messages": payload,
                        "agente_nome": (agente.nome if agente else None) or "Assistente",
                        "agente_foto_url": (getattr(agente, "avatar_url", None) if agente else None) or None,
                    },
                )
            if r.status_code >= 400:
                logger.warning("mirror realtime push %s falhou %s: %s", base, r.status_code, r.text[:160])
    except Exception:
        logger.exception("mirror_recent_to_pet falhou agent=%s conv=%s", agent_id, conv_id)

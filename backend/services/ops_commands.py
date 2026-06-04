"""Comandos operacionais (DevSecOps) — respostas determinísticas, sem LLM.

Quando um agente com `template_kind="devsecops"` recebe uma mensagem que é um
comando de ops (status/health/ping/uptime/ajuda), respondemos com a saúde REAL
do stack do Tier Agent — em vez de mandar pro LLM (que alucinaria métricas).

Escopo honesto: o backend roda num container (api-agent.tier.finance), então
ele reporta a saúde do PRÓPRIO stack (DB, Engine alcançável, agentes/conectores
ativos, uptime do processo). Métricas do servidor host (CPU/RAM/disco de
46.224.220.223) NÃO vêm daqui — pra isso o canal são os alertas do SecOps
(painel.tier.finance + tier-secops-alert.py). Isso fica claro na resposta.
"""

import time

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from models import TaAgent, TaConnector

# Captura o momento de import do módulo como referência de uptime do processo.
_PROC_START = time.monotonic()

_OPS_WORDS = {
    "status", "health", "saude", "saúde", "ping", "uptime", "ajuda", "help", "comandos",
}


def is_ops_command(text: str | None) -> bool:
    """True se a mensagem (curta) é um comando de ops reconhecido."""
    if not text:
        return False
    t = text.strip().lower().lstrip("/!.")
    if len(t) > 20:  # comando é curto; frase longa = conversa normal
        return False
    first = t.split()[0] if t.split() else ""
    return first in _OPS_WORDS


def _fmt_uptime() -> str:
    secs = int(time.monotonic() - _PROC_START)
    d, secs = divmod(secs, 86400)
    h, secs = divmod(secs, 3600)
    m, _ = divmod(secs, 60)
    parts = []
    if d:
        parts.append(f"{d}d")
    if h:
        parts.append(f"{h}h")
    parts.append(f"{m}min")
    return " ".join(parts)


async def _engine_reachable() -> bool:
    settings = get_settings()
    base = getattr(settings, "tier_whatsapp_engine_url", None)
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as cli:
            r = await cli.get(f"{base}/health")
        return r.status_code < 500
    except Exception:
        return False


async def handle_ops_command(db: AsyncSession, agent: TaAgent, text: str) -> str | None:
    """Responde a um comando de ops. Retorna None se não for comando reconhecido."""
    t = (text or "").strip().lower().lstrip("/!.")
    first = t.split()[0] if t.split() else ""

    if first in ("ajuda", "help", "comandos"):
        return (
            "🤖 *DevSecOps — comandos*\n"
            "• *status* / *health* — saúde do stack do Tier Agent\n"
            "• *uptime* — tempo de atividade do backend\n"
            "• *ping* — teste rápido de resposta\n\n"
            "_Alertas de segurança do servidor chegam automaticamente aqui "
            "(scan-guard / C&C-guard / ingress-guard)._"
        )

    if first == "ping":
        return "pong ✅"

    if first == "uptime":
        return f"⏱️ Backend Tier Agent no ar há *{_fmt_uptime()}*."

    # status / health / saude → saúde real do stack
    db_ok = False
    try:
        await db.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False

    try:
        agentes = (
            await db.execute(
                select(func.count(TaAgent.id)).where(
                    TaAgent.tenant_id == agent.tenant_id, TaAgent.active.is_(True)
                )
            )
        ).scalar() or 0
    except Exception:
        agentes = "?"

    try:
        conns = (
            await db.execute(
                select(func.count(TaConnector.id))
                .join(TaAgent, TaAgent.id == TaConnector.agent_id)
                .where(TaAgent.tenant_id == agent.tenant_id)
            )
        ).scalar() or 0
    except Exception:
        conns = "?"

    engine_ok = await _engine_reachable()

    def mark(ok: bool) -> str:
        return "🟢" if ok else "🔴"

    return (
        "🛡️ *Status — Tier Agent*\n"
        f"{mark(True)} Backend: no ar ({_fmt_uptime()})\n"
        f"{mark(db_ok)} Banco de dados: {'ok' if db_ok else 'falha'}\n"
        f"{mark(engine_ok)} WhatsApp Engine: {'alcançável' if engine_ok else 'sem resposta'}\n"
        f"🤝 Agentes ativos: {agentes} · Canais: {conns}\n\n"
        "_Métricas do servidor (CPU/RAM/disco) e alertas de segurança chegam "
        "automaticamente pelos guards do SecOps — não consultados por aqui._"
    )

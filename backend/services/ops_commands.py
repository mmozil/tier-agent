"""Comandos operacionais (DevOps/SRE/Observability) — respostas determinísticas, sem LLM.

Quando um agente com `template_kind="devsecops"` recebe uma mensagem que É um comando de
ops (status/health/metrics/errors/sla/incidentes/infra/ping/uptime/ajuda), respondemos com
dados REAIS — em vez de mandar pro LLM (que alucinaria métricas). Essa é a regra de ouro do
observability: **nunca inventar número — só reportar o que a fonte retorna.**

Fontes de verdade:
- Saúde do stack: o próprio backend (DB `SELECT 1`, Engine `/health`, contagem de agentes/canais).
- Telemetria RED (Rate/Errors/Duration): `ta_message_log` (latência, custo, tokens, freios) +
  `ta_conversation`/`ta_agent` pra escopo por tenant.
- Incidentes: `ta_incident` (alimentada pelo webhook `/secops/alert` dos guards do servidor).
- Infra do host (CPU/RAM/disco): Prometheus/painel via env `TIER_INFRA_PROM_URL` (opcional).

Cada query é defensiva (try/except → "?"): um schema fora do esperado degrada o campo, nunca
derruba o comando.
"""

import time

import httpx
from sqlalchemy import func, select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from models import TaAgent, TaConnector

# Captura o momento de import do módulo como referência de uptime do processo.
_PROC_START = time.monotonic()

_OPS_WORDS = {
    # saúde / básicos
    "status", "health", "saude", "saúde", "ping", "uptime", "ajuda", "help", "comandos",
    # observabilidade
    "metrics", "metricas", "métricas", "errors", "erros", "erro", "sla",
    "incidentes", "incidents", "incidente", "infra", "host",
}


def is_ops_command(text: str | None) -> bool:
    """True se a mensagem é um comando de ops reconhecido.

    Regra (corrige o over-trigger "ajuda com login" → menu):
    - com prefixo (`/`, `!`, `.`): a 1ª palavra basta ser keyword → comando explícito (aceita args, ex.: `/metrics 7d`).
    - sem prefixo: SÓ é comando se a mensagem for a palavra ISOLADA (1 token). "ajuda com login" não dispara.
    """
    if not text:
        return False
    raw = text.strip()
    has_prefix = raw[:1] in "/!."
    t = raw.lstrip("/!.").strip().lower()
    if not t:
        return False
    toks = t.split()
    if toks[0] not in _OPS_WORDS:
        return False
    return True if has_prefix else len(toks) == 1


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


def _mark(ok: bool) -> str:
    return "🟢" if ok else "🔴"


async def _engine_reachable() -> bool:
    settings = get_settings()
    base = getattr(settings, "tier_whatsapp_engine_url", None)
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as cli:
            r = await cli.get(f"{base}/health")
            return r.status_code < 500
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Telemetria (RED) — escopada por tenant via ta_message_log → ta_conversation → ta_agent
# ──────────────────────────────────────────────────────────────────────────────
async def _red_stats(db: AsyncSession, tenant_id: int, hours: int = 24) -> dict:
    """Rate/Errors/Duration das últimas N horas pro tenant. Defensivo (campos = None se falhar)."""
    out: dict = {"total": None, "assistant": None, "errors": None, "lat_avg": None,
                 "lat_p95": None, "cost_cents": None, "tokens": None, "models": []}
    base_join = (
        "FROM ta_message_log m "
        "JOIN ta_conversation c ON c.id = m.conversation_id "
        "JOIN ta_agent ag ON ag.id = c.agent_id "
        "WHERE ag.tenant_id = :t AND m.created_at > now() - (:h || ' hours')::interval"
    )
    params = {"t": tenant_id, "h": str(hours)}
    try:
        sql = (
            "SELECT "
            "count(*) AS total, "
            "count(*) FILTER (WHERE m.role='assistant') AS assistant, "
            "count(*) FILTER (WHERE m.role='assistant' AND m.brakes_fired IS NOT NULL "
            "                 AND jsonb_array_length(m.brakes_fired::jsonb) > 0) AS errors, "
            "avg(m.latency_ms) FILTER (WHERE m.role='assistant' AND m.latency_ms > 0) AS lat_avg, "
            "sum(m.cost_cents) AS cost_cents, "
            "sum(m.tokens_in + m.tokens_out) AS tokens "
            + base_join
        )
        res = await db.execute(sql_text(sql), params)
        row = res.mappings().first()
        if row:
            out.update({k: row[k] for k in ("total", "assistant", "errors", "lat_avg", "cost_cents", "tokens")})
    except Exception:
        pass
    try:
        sql = (
            "SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY m.latency_ms) AS p95 "
            + base_join + " AND m.role='assistant' AND m.latency_ms > 0"
        )
        res = await db.execute(sql_text(sql), params)
        out["lat_p95"] = res.scalar()
    except Exception:
        pass
    try:
        sql = (
            "SELECT m.model_used AS model, count(*) AS n "
            + base_join + " AND m.role='assistant' AND m.model_used IS NOT NULL "
            "GROUP BY m.model_used ORDER BY n DESC LIMIT 3"
        )
        res = await db.execute(sql_text(sql), params)
        out["models"] = [(r["model"], r["n"]) for r in res.mappings().all()]
    except Exception:
        pass
    return out


async def _errors_recent(db: AsyncSession, tenant_id: int, hours: int = 24, limit: int = 6) -> list[dict]:
    sql = (
        "SELECT ag.nome AS agente, m.brakes_fired AS brakes, m.created_at AS at "
        "FROM ta_message_log m "
        "JOIN ta_conversation c ON c.id = m.conversation_id "
        "JOIN ta_agent ag ON ag.id = c.agent_id "
        "WHERE ag.tenant_id = :t AND m.role='assistant' AND m.brakes_fired IS NOT NULL "
        "  AND jsonb_array_length(m.brakes_fired::jsonb) > 0 "
        "  AND m.created_at > now() - (:h || ' hours')::interval "
        "ORDER BY m.created_at DESC LIMIT :lim"
    )
    try:
        res = await db.execute(sql_text(sql), {"t": tenant_id, "h": str(hours), "lim": limit})
        return [dict(r) for r in res.mappings().all()]
    except Exception:
        return []


async def _sla_open(db: AsyncSession, tenant_id: int) -> dict:
    """Conversas com SLA já alertado e ainda não resolvidas."""
    try:
        res = await db.execute(sql_text(
            "SELECT count(*) FROM ta_conversation c JOIN ta_agent ag ON ag.id = c.agent_id "
            "WHERE ag.tenant_id = :t AND c.sla_alerted_at IS NOT NULL "
            "  AND COALESCE(c.status,'') NOT IN ('resolved','closed','done')"),
            {"t": tenant_id})
        n = res.scalar()
        res = await db.execute(sql_text(
            "SELECT count(*) FROM ta_conversation c JOIN ta_agent ag ON ag.id = c.agent_id "
            "WHERE ag.tenant_id = :t AND COALESCE(c.status,'') IN ('handed_off','waiting','pending')"),
            {"t": tenant_id})
        waiting = res.scalar()
        return {"breached": n, "waiting": waiting}
    except Exception:
        return {"breached": "?", "waiting": "?"}


async def _incidents_open(db: AsyncSession, tenant_id: int, limit: int = 8) -> list[dict]:
    """Incidentes abertos (do tenant OU infra-global tenant_id NULL). Tabela ta_incident (runtime DDL)."""
    sql = (
        "SELECT id, source, severity, kind, title, status, created_at "
        "FROM ta_incident "
        "WHERE status IN ('open','ack') AND (tenant_id IS NULL OR tenant_id = :t) "
        "ORDER BY (severity='critical') DESC, created_at DESC LIMIT :lim"
    )
    try:
        res = await db.execute(sql_text(sql), {"t": tenant_id, "lim": limit})
        return [dict(r) for r in res.mappings().all()]
    except Exception:
        return []


async def _infra_snapshot() -> dict | None:
    """CPU/RAM/disco do host via Prometheus HTTP API (env TIER_INFRA_PROM_URL). None se não configurado."""
    settings = get_settings()
    prom = getattr(settings, "tier_infra_prom_url", None) or ""
    if not prom:
        return None
    prom = prom.rstrip("/")
    queries = {
        "cpu": '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
        "mem": '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
        "disk": '(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100',
        "load1": 'node_load1',
    }
    out: dict = {}
    try:
        async with httpx.AsyncClient(timeout=6.0) as cli:
            for key, q in queries.items():
                try:
                    r = await cli.get(f"{prom}/api/v1/query", params={"query": q})
                    data = r.json()
                    res = data.get("data", {}).get("result", [])
                    out[key] = float(res[0]["value"][1]) if res else None
                except Exception:
                    out[key] = None
    except Exception:
        return None
    return out


def _fmt_num(v, suf: str = "", nd: int = 0) -> str:
    if v is None:
        return "?"
    try:
        return f"{float(v):.{nd}f}{suf}"
    except Exception:
        return str(v)


# ──────────────────────────────────────────────────────────────────────────────
# Dispatch
# ──────────────────────────────────────────────────────────────────────────────
async def handle_ops_command(db: AsyncSession, agent: TaAgent, text: str) -> str | None:
    """Responde a um comando de ops. Retorna None se não for comando reconhecido."""
    t = (text or "").strip().lower().lstrip("/!.")
    toks = t.split()
    first = toks[0] if toks else ""
    tenant_id = agent.tenant_id

    if first in ("ajuda", "help", "comandos"):
        return (
            "🛡️ *DevOps · comandos*\n"
            "• *status* — saúde do stack (backend/DB/Engine/canais)\n"
            "• *metrics* — RED 24h: volume, erros, latência p95, custo\n"
            "• *errors* — freios/falhas recentes do atendimento\n"
            "• *sla* — conversas estouradas / em espera\n"
            "• *incidentes* — alertas de segurança/infra abertos\n"
            "• *infra* — CPU/RAM/disco do host\n"
            "• *uptime* · *ping* — vida do backend\n\n"
            "_Alertas dos guards (scan-guard/C&C-guard/ingress-guard) chegam automaticamente aqui._"
        )

    if first == "ping":
        return "pong ✅"

    if first == "uptime":
        return f"⏱️ Backend Tier Agent no ar há *{_fmt_uptime()}*."

    if first in ("metrics", "metricas", "métricas"):
        s = await _red_stats(db, tenant_id, 24)
        err_rate = "?"
        if isinstance(s["assistant"], int) and s["assistant"]:
            err_rate = f"{(int(s['errors'] or 0) / s['assistant'] * 100):.1f}%"
        cost = "?" if s["cost_cents"] is None else f"R$ {int(s['cost_cents']) / 100:.2f}"
        models = ", ".join(f"{m} ({n})" for m, n in s["models"]) or "?"
        return (
            "📊 *Métricas · últimas 24h* (RED)\n"
            f"• *Rate*: {_fmt_num(s['total'])} mensagens ({_fmt_num(s['assistant'])} respostas do agente)\n"
            f"• *Errors*: {_fmt_num(s['errors'])} freios disparados ({err_rate})\n"
            f"• *Duration*: média {_fmt_num(s['lat_avg'])}ms · p95 {_fmt_num(s['lat_p95'])}ms\n"
            f"• *Custo*: {cost} · *tokens*: {_fmt_num(s['tokens'])}\n"
            f"• *Modelos*: {models}"
        )

    if first in ("errors", "erros", "erro"):
        rows = await _errors_recent(db, tenant_id, 24, 6)
        if not rows:
            return "✅ *Erros 24h*: nenhum freio determinístico disparado. Atendimento limpo."
        linhas = []
        for r in rows:
            brakes = r.get("brakes") or []
            nomes = ", ".join(brakes) if isinstance(brakes, list) else str(brakes)
            quando = r["at"].strftime("%d/%m %H:%M") if r.get("at") else "?"
            linhas.append(f"• {quando} · *{r.get('agente', '?')}* · {nomes}")
        return "⚠️ *Freios/erros recentes (24h)*\n" + "\n".join(linhas)

    if first == "sla":
        s = await _sla_open(db, tenant_id)
        return (
            "⏳ *SLA*\n"
            f"• Estouradas (alertadas, não resolvidas): *{s['breached']}*\n"
            f"• Em espera / handed-off: *{s['waiting']}*"
        )

    if first in ("incidentes", "incidents", "incidente"):
        rows = await _incidents_open(db, tenant_id, 8)
        if not rows:
            return "✅ *Incidentes*: nenhum aberto. Stack sem alertas pendentes."
        sev_icon = {"critical": "🔴", "warning": "🟠", "info": "🔵"}
        linhas = []
        for r in rows:
            ic = sev_icon.get((r.get("severity") or "").lower(), "⚪")
            quando = r["created_at"].strftime("%d/%m %H:%M") if r.get("created_at") else "?"
            linhas.append(f"{ic} *#{r['id']}* [{r.get('source', '?')}] {r.get('title', '')} · {quando} · {r.get('status')}")
        return "🚨 *Incidentes abertos*\n" + "\n".join(linhas)

    if first in ("infra", "host"):
        snap = await _infra_snapshot()
        if snap is None:
            return (
                "ℹ️ *Infra do host* não está conectada aqui.\n"
                "Pra ligar: setar `TIER_INFRA_PROM_URL` (Prometheus) no backend. "
                "Enquanto isso, CPU/RAM/disco vêm pelo painel.tier.finance e pelos alertas do SecOps."
            )
        return (
            "🖥️ *Infra do host*\n"
            f"• CPU: {_fmt_num(snap.get('cpu'), '%', 1)}\n"
            f"• RAM: {_fmt_num(snap.get('mem'), '%', 1)}\n"
            f"• Disco /: {_fmt_num(snap.get('disk'), '%', 1)}\n"
            f"• Load(1m): {_fmt_num(snap.get('load1'), '', 2)}"
        )

    # status / health / saude → saúde real do stack (enriquecido com error rate 24h)
    db_ok = False
    try:
        await db.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False

    try:
        agentes = (await db.execute(
            select(func.count(TaAgent.id)).where(TaAgent.tenant_id == tenant_id, TaAgent.active.is_(True))
        )).scalar() or 0
    except Exception:
        agentes = "?"

    try:
        conns = (await db.execute(
            select(func.count(TaConnector.id)).join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaAgent.tenant_id == tenant_id)
        )).scalar() or 0
    except Exception:
        conns = "?"

    engine_ok = await _engine_reachable()
    s = await _red_stats(db, tenant_id, 24)
    err_rate = "?"
    if isinstance(s["assistant"], int) and s["assistant"]:
        err_rate = f"{(int(s['errors'] or 0) / s['assistant'] * 100):.1f}%"
    inc = await _incidents_open(db, tenant_id, 1)
    inc_line = f"🔴 {len(inc)}+ incidente(s) aberto(s) — veja *incidentes*" if inc else "🟢 sem incidentes abertos"

    return (
        "🛡️ *Status — Tier Agent*\n"
        f"{_mark(True)} Backend: no ar ({_fmt_uptime()})\n"
        f"{_mark(db_ok)} Banco de dados: {'ok' if db_ok else 'falha'}\n"
        f"{_mark(engine_ok)} WhatsApp Engine: {'alcançável' if engine_ok else 'sem resposta'}\n"
        f"🤝 Agentes ativos: {agentes} · Canais: {conns}\n"
        f"📊 24h: {_fmt_num(s['total'])} msgs · erro {err_rate} · p95 {_fmt_num(s['lat_p95'])}ms\n"
        f"{inc_line}\n\n"
        "_CPU/RAM/disco: *infra*. Alertas de segurança chegam automaticamente pelos guards do SecOps._"
    )

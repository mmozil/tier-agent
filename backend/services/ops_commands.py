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

import asyncio
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
    "alertas", "alerts", "alerta",
    # calibragem (parâmetros/thresholds dos alertas)
    "calibragem", "calibracao", "calibração", "parametros", "parâmetros",
    "thresholds", "limites",
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
    # tolera pontuação no comando ("ajuda?", "status!", "/ajuda.")
    first = toks[0].strip(".,!?;:…")
    if first not in _OPS_WORDS:
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
            "                 AND jsonb_typeof(m.brakes_fired::jsonb) = 'array' "
            "                 AND m.brakes_fired::jsonb <> '[]'::jsonb) AS errors, "
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
        "  AND jsonb_typeof(m.brakes_fired::jsonb) = 'array' "
        "  AND m.brakes_fired::jsonb <> '[]'::jsonb "
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


async def _recent_alerts(db: AsyncSession, tenant_id: int, limit: int = 8) -> list[dict]:
    """Últimos alertas/incidentes registrados (QUALQUER status — histórico + abertos),
    do tenant OU infra-global. Alimenta o comando `alertas` e o contexto do agente."""
    sql = (
        "SELECT id, source, severity, kind, title, status, created_at "
        "FROM ta_incident WHERE (tenant_id IS NULL OR tenant_id = :t) "
        "ORDER BY created_at DESC LIMIT :lim"
    )
    try:
        res = await db.execute(sql_text(sql), {"t": tenant_id, "lim": limit})
        return [dict(r) for r in res.mappings().all()]
    except Exception:
        return []


async def recent_alerts_block(db: AsyncSession, tenant_id: int, limit: int = 6) -> str:
    """Bloco de contexto (dados REAIS) injetado no prompt do agente DevOps, pra ele
    responder 'qual o último alerta?' direto — sem mandar o usuário rodar comando."""
    rows = await _recent_alerts(db, tenant_id, limit)
    if not rows:
        return ""
    linhas = []
    for r in rows:
        quando = r["created_at"].strftime("%d/%m %H:%M") if r.get("created_at") else "?"
        st = r.get("status")
        st_txt = "" if st == "resolved" else f", status: {st}"
        linhas.append(f"- {quando} [{r.get('severity')}] {r.get('title', '')} (fonte: {r.get('source')}{st_txt})")
    return (
        "# Últimos alertas/incidentes registrados (dados REAIS do SecOps — use pra responder se "
        "perguntarem 'qual o último alerta', 'teve algum incidente', etc. NUNCA mande o usuário "
        "rodar comando no servidor pra isso; você já tem os dados aqui)\n" + "\n".join(linhas)
    )


async def _infra_from_prometheus(prom: str) -> dict | None:
    """CPU/RAM/disco via Prometheus HTTP API (node_exporter)."""
    queries = {
        "cpu": '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
        "mem": '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
        "disk": '(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100',
        "load1": "node_load1",
    }
    out: dict = {"source": "prometheus"}
    try:
        async with httpx.AsyncClient(timeout=6.0) as cli:
            for key, q in queries.items():
                try:
                    r = await cli.get(f"{prom}/api/v1/query", params={"query": q})
                    res = r.json().get("data", {}).get("result", [])
                    out[key] = float(res[0]["value"][1]) if res else None
                except Exception:
                    out[key] = None
    except Exception:
        return None
    return out if any(out.get(k) is not None for k in ("cpu", "mem", "disk")) else None


# Comando único no host (mesma chave SSH da orquestração). Saída key=value|... pra parse limpo.
_INFRA_SSH_CMD = (
    "L=$(cut -d' ' -f1-3 /proc/loadavg); "
    "N=$(nproc); "
    "M=$(free -m | awk '/^Mem:/{print $2\",\"$3}'); "
    "D=$(df -P / | awk 'NR==2{gsub(/%/,\"\",$5);print $5}'); "
    "C=$(docker ps -q 2>/dev/null | wc -l | tr -d ' '); "
    "echo \"load=$L|mem=$M|disk=$D|ncpu=$N|containers=$C\""
)


async def _infra_from_ssh() -> dict | None:
    """CPU(carga)/RAM/disco/containers do host via SSH (paramiko da orquestração)."""
    if not getattr(get_settings(), "tier_agent_ssh_privkey_b64", ""):
        return None
    try:
        from services.container_orchestrator import _ssh_run
        code, out, _err = await asyncio.to_thread(_ssh_run, _INFRA_SSH_CMD)
    except Exception:
        return None
    if code != 0 or not out:
        return None
    try:
        parts = dict(p.split("=", 1) for p in out.strip().split("|") if "=" in p)
        load = (parts.get("load") or "").split()
        load1 = float(load[0]) if load else None
        ncpu = int(parts.get("ncpu") or 0) or None
        mem = (parts.get("mem") or "").split(",")
        mem_pct = (float(mem[1]) / float(mem[0]) * 100) if len(mem) == 2 and float(mem[0]) else None
        disk = float(parts["disk"]) if parts.get("disk") else None
        containers = int(parts["containers"]) if parts.get("containers") else None
        cpu = (load1 / ncpu * 100) if (load1 is not None and ncpu) else None
        return {"source": "ssh", "cpu": cpu, "mem": mem_pct, "disk": disk,
                "load1": load1, "ncpu": ncpu, "containers": containers}
    except Exception:
        return None


async def _infra_snapshot() -> dict | None:
    """Métricas do host: Prometheus (se TIER_INFRA_PROM_URL) → fallback SSH-to-host. None se nenhum."""
    prom = (getattr(get_settings(), "tier_infra_prom_url", None) or "").rstrip("/")
    if prom:
        snap = await _infra_from_prometheus(prom)
        if snap:
            return snap
    return await _infra_from_ssh()


# ──────────────────────────────────────────────────────────────────────────────
# Calibragem — lê os thresholds + severidades REAIS dos guards do SecOps no host.
# Fonte da verdade: /usr/local/sbin/tier-secops-checks.sh (ssh/cpu/ram/disco/containers)
# + tier-scan-monitor.sh (scan/cc). NUNCA hardcodar valores aqui — extrair do script,
# senão a calibragem "documentada" diverge da que de fato dispara.
# ──────────────────────────────────────────────────────────────────────────────
_CALIB_SSH_CMD = (
    "CHK=/usr/local/sbin/tier-secops-checks.sh; SCN=/usr/local/sbin/tier-scan-monitor.sh; "
    "echo \"ssh_thr=$(grep -oE 'SSH_IP_THRESHOLD:-[0-9]+' $CHK | grep -oE '[0-9]+' | head -1)"
    "|ram_thr=$(grep -oE 'RAM_THRESHOLD:-[0-9]+' $CHK | grep -oE '[0-9]+' | head -1)"
    "|disk_thr=$(grep -oE 'DISK_THRESHOLD:-[0-9]+' $CHK | grep -oE '[0-9]+' | head -1)"
    "|sustain=$(grep -oE 'SUSTAIN_CYCLES:-[0-9]+' $CHK | grep -oE '[0-9]+' | head -1)"
    "|cpu_mult=$(grep -oE 'CORES\\*[0-9]+' $CHK | grep -oE '[0-9]+$' | head -1)"
    "|sev_ssh=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"ssh\\\"' $CHK | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_cpu=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"cpu\\\"' $CHK | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_ram=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"ram\\\"' $CHK | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_disk=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"disk\\\"' $CHK | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_containers=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"containers\\\"' $CHK | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_scan=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"scan\\\"' $SCN | grep -oE 'critico|alerta|info' | head -1)"
    "|sev_cc=$(grep -oE '\\\"(critico|alerta|info)\\\" \\\"cc\\\"' $SCN | grep -oE 'critico|alerta|info' | head -1)\""
)


async def _calibragem_from_ssh() -> dict | None:
    """Thresholds + severidades dos alertas, lidos ao vivo dos scripts dos guards no host."""
    if not getattr(get_settings(), "tier_agent_ssh_privkey_b64", ""):
        return None
    try:
        from services.container_orchestrator import _ssh_run
        code, out, _err = await asyncio.to_thread(_ssh_run, _CALIB_SSH_CMD)
    except Exception:
        return None
    if code != 0 or not out:
        return None
    try:
        parts = dict(p.split("=", 1) for p in out.strip().split("|") if "=" in p)

        def _i(k):
            try:
                return int(parts.get(k) or 0) or None
            except Exception:
                return None

        return {
            "ssh_thr": _i("ssh_thr"), "ram_thr": _i("ram_thr"), "disk_thr": _i("disk_thr"),
            "sustain": _i("sustain"), "cpu_mult": _i("cpu_mult"),
            "sev": {k: (parts.get(f"sev_{k}") or None)
                    for k in ("ssh", "cpu", "ram", "disk", "containers", "scan", "cc")},
        }
    except Exception:
        return None


def _fmt_num(v, suf: str = "", nd: int = 0) -> str:
    if v is None:
        return "?"
    try:
        return f"{float(v):.{nd}f}{suf}"
    except Exception:
        return str(v)


# Severidade do guard → (ícone, rótulo, política). Reflete o que o script de fato emite.
_SEV_META = {
    "critico": ("🔴", "crítico", "acorda"), "critical": ("🔴", "crítico", "acorda"),
    "alerta": ("🟠", "alerta", "importante"), "warning": ("🟠", "alerta", "importante"),
    "info": ("🔵", "info", "registro"),
}


def _status_dot(cur, thr, warn_ratio: float = 0.7) -> str:
    """🟢/🟠/🔴 conforme quão perto o valor atual está do threshold de alerta."""
    try:
        if cur is None or not thr:
            return "⚪"
        r = float(cur) / float(thr)
    except Exception:
        return "⚪"
    if r >= 1.0:
        return "🔴"
    if r >= warn_ratio:
        return "🟠"
    return "🟢"


def _canon_sev(s: str | None) -> str:
    s = (s or "").lower()
    if s in ("critico", "critical"):
        return "critico"
    if s in ("alerta", "warning"):
        return "alerta"
    return "info"


# ──────────────────────────────────────────────────────────────────────────────
# Dispatch
# ──────────────────────────────────────────────────────────────────────────────
async def handle_ops_command(db: AsyncSession, agent: TaAgent, text: str) -> str | None:
    """Responde a um comando de ops. Retorna None se não for comando reconhecido."""
    t = (text or "").strip().lower().lstrip("/!.")
    toks = t.split()
    first = (toks[0].strip(".,!?;:…") if toks else "")
    tenant_id = agent.tenant_id

    if first in ("ajuda", "help", "comandos"):
        return (
            "🛡️ *DevOps · comandos*\n"
            "• *status* — saúde do stack (backend/DB/Engine/canais)\n"
            "• *alertas* — últimos alertas do SecOps (scan/C&C/SSH)\n"
            "• *incidentes* — alertas de segurança/infra ABERTOS\n"
            "• *metrics* — RED 24h: volume, erros, latência p95, custo\n"
            "• *errors* — freios/falhas recentes do atendimento\n"
            "• *sla* — conversas estouradas / em espera\n"
            "• *infra* — CPU/RAM/disco do host (atual → limite de alerta)\n"
            "• *calibragem* — parâmetros atuais: quando cada alerta dispara\n"
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

    if first in ("alertas", "alerts", "alerta"):
        rows = await _recent_alerts(db, tenant_id, 8)
        if not rows:
            return "✅ *Alertas*: nenhum registrado."
        sev_icon = {"critical": "🔴", "warning": "🟠", "info": "🔵"}
        linhas = []
        for r in rows:
            ic = sev_icon.get((r.get("severity") or "").lower(), "⚪")
            quando = r["created_at"].strftime("%d/%m %H:%M") if r.get("created_at") else "?"
            st = "" if r.get("status") == "resolved" else f" · {r.get('status')}"
            linhas.append(f"{ic} {quando} · {r.get('title', '')}{st}")
        return "🛎️ *Últimos alertas*\n" + "\n".join(linhas)

    if first in ("calibragem", "calibracao", "calibração", "parametros", "parâmetros", "thresholds", "limites"):
        cal = await _calibragem_from_ssh()
        if cal is None:
            return (
                "ℹ️ *Calibragem* não acessível aqui (SSH dos guards do SecOps fora).\n"
                "Os parâmetros vivem em `tier-secops-checks.sh` + `tier-scan-monitor.sh` no host."
            )
        sev = cal.get("sev", {})
        sustain_min = (cal["sustain"] * 2) if cal.get("sustain") else None  # cron roda a cada 2min
        descr = {
            "disk": f"Disco / ≥ {cal.get('disk_thr', '?')}%",
            "containers": "Aplicação fora do ar (algum app sem container no ar)",
            "scan": "Varredura de portas detectada (scan-guard)",
            "cc": "Beacon de C&C / trojan (cc-guard)",
            "cpu": f"CPU: load > {cal.get('cpu_mult', '?')}× vCPUs"
                   + (f" sustentado ~{sustain_min}min" if sustain_min else ""),
            "ram": f"RAM ≥ {cal.get('ram_thr', '?')}%"
                   + (f" sustentado ~{sustain_min}min" if sustain_min else ""),
            "ssh": f"Força bruta SSH ≥ {cal.get('ssh_thr', '?')} tentativas/10min (fail2ban já bane)",
        }
        grupos: dict[str, list[str]] = {}
        for kind, d in descr.items():  # ordem de inserção preservada dentro do grupo
            grupos.setdefault(_canon_sev(sev.get(kind)), []).append(d)
        out = [
            "🎚️ *Calibragem de alertas*",
            "_(fonte: guards do SecOps no host · checagem a cada 2min, scan/C&C em tempo real)_",
            "",
        ]
        for canon in ("critico", "alerta", "info"):
            itens = grupos.get(canon)
            if not itens:
                continue
            ic, lbl, pol = _SEV_META[canon]
            out.append(f"{ic} *{lbl}* — {pol}")
            out.extend(f" • {i}" for i in itens)
        out.append("")
        out.append("_Crítico acorda (push). Alerta/info ficam no histórico — veja *alertas*._")
        return "\n".join(out)

    if first in ("infra", "host"):
        snap = await _infra_snapshot()
        if snap is None:
            return (
                "ℹ️ *Infra do host* não está conectada aqui.\n"
                "Pra ligar: `TIER_INFRA_PROM_URL` (Prometheus) ou a chave SSH "
                "(`TIER_AGENT_SSH_PRIVKEY_B64`) no backend."
            )
        cal = await _calibragem_from_ssh() or {}
        sev = cal.get("sev", {})
        ncpu, load1 = snap.get("ncpu"), snap.get("load1")
        cpu_pct, ram_pct, disk_pct = snap.get("cpu"), snap.get("mem"), snap.get("disk")
        ct = snap.get("containers")
        sustain_min = (cal["sustain"] * 2) if cal.get("sustain") else None
        cpu_mult, ram_thr, disk_thr = cal.get("cpu_mult"), cal.get("ram_thr"), cal.get("disk_thr")
        cpu_load_thr = (cpu_mult * ncpu) if (cpu_mult and ncpu) else None

        def _tag(kind, fallback):
            ic, lbl, _pol = _SEV_META[_canon_sev(sev.get(kind) or fallback)]
            return ic, lbl

        lines = ["🖥️ *Infra do host*  _(atual → limite de alerta)_"]

        cpu_cur = f"{_fmt_num(cpu_pct, '%', 1)} · load {_fmt_num(load1, '', 2)}/{ncpu or '?'} vCPU"
        if cpu_load_thr:
            ic, lbl = _tag("cpu", "alerta")
            mins = f" por ~{sustain_min}min" if sustain_min else ""
            lines.append(f"{_status_dot(load1, cpu_load_thr)} CPU: {cpu_cur} → {ic} {lbl} se load > {cpu_load_thr} ({cpu_mult}× vCPU){mins}")
        else:
            lines.append(f"{_status_dot(load1, cpu_load_thr)} CPU: {cpu_cur}")

        if ram_thr:
            ic, lbl = _tag("ram", "alerta")
            mins = f" sustentado ~{sustain_min}min" if sustain_min else ""
            lines.append(f"{_status_dot(ram_pct, ram_thr)} RAM: {_fmt_num(ram_pct, '%', 1)} → {ic} {lbl} ≥ {ram_thr}%{mins}")
        else:
            lines.append(f"{_status_dot(ram_pct, ram_thr)} RAM: {_fmt_num(ram_pct, '%', 1)}")

        if disk_thr:
            ic, lbl = _tag("disk", "critico")
            lines.append(f"{_status_dot(disk_pct, disk_thr)} Disco /: {_fmt_num(disk_pct, '%', 1)} → {ic} {lbl} ≥ {disk_thr}%")
        else:
            lines.append(f"{_status_dot(disk_pct, disk_thr)} Disco /: {_fmt_num(disk_pct, '%', 1)}")

        if ct is not None:
            if sev.get("containers"):
                ic, lbl = _tag("containers", "critico")
                lines.append(f"🟢 Containers: {ct} no ar → {ic} {lbl} se algum app sumir")
            else:
                lines.append(f"🟢 Containers: {ct} no ar")

        if not cal:
            lines.append("\n_Thresholds indisponíveis (SSH dos guards fora) — só valores atuais._")
        return "\n".join(lines)

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

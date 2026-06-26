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
# CPU% real = delta de /proc/stat em 0.4s (idle+iowait vs total). Memória/disco com TOTAIS.
_INFRA_SSH_CMD = (
    "A=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}' /proc/stat); "
    "sleep 0.4; "
    "B=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}' /proc/stat); "
    "CPU=$(awk -v a=\"$A\" -v b=\"$B\" 'BEGIN{split(a,X,\" \");split(b,Y,\" \");dt=Y[1]-X[1];di=Y[2]-X[2];if(dt>0)printf \"%.1f\",(1-di/dt)*100;else printf \"0\"}'); "
    "N=$(nproc); L=$(cut -d' ' -f1 /proc/loadavg); "
    "M=$(free -m | awk '/^Mem:/{printf \"%d,%d\", $2, $3}'); "
    "D=$(df -P / | awk 'NR==2{gsub(/%/,\"\",$5); printf \"%.0f,%.0f,%s\", $2/1048576, $3/1048576, $5}'); "
    "C=$(docker ps -q 2>/dev/null | wc -l | tr -d ' '); "
    "echo \"cpu=$CPU|ncpu=$N|load1=$L|mem=$M|disk=$D|containers=$C\""
)


async def _infra_from_ssh() -> dict | None:
    """CPU%/RAM/disco (com totais) + containers do host via SSH (paramiko da orquestração)."""
    if not getattr(get_settings(), "tier_agent_ssh_privkey_b64", ""):
        return None
    try:
        from services.container_orchestrator import _ssh_run
        code, out, _err = await asyncio.to_thread(_ssh_run, _INFRA_SSH_CMD)
    except Exception:
        return None
    if code != 0 or not out:
        return None

    def _f(v):
        try:
            return float(v)
        except Exception:
            return None

    try:
        parts = dict(p.split("=", 1) for p in out.strip().split("|") if "=" in p)
        ncpu = int(parts["ncpu"]) if parts.get("ncpu") else None
        mem = (parts.get("mem") or "").split(",")
        mt, mu = (_f(mem[0]) if len(mem) >= 1 else None), (_f(mem[1]) if len(mem) >= 2 else None)
        mem_pct = (mu / mt * 100) if (mt and mu is not None) else None
        disk = (parts.get("disk") or "").split(",")
        return {
            "source": "ssh",
            "cpu": _f(parts.get("cpu")), "ncpu": ncpu, "load1": _f(parts.get("load1")),
            "mem_total_mb": mt, "mem_used_mb": mu, "mem_pct": mem_pct,
            "disk_total_gb": _f(disk[0]) if len(disk) >= 1 else None,
            "disk_used_gb": _f(disk[1]) if len(disk) >= 2 else None,
            "disk_pct": _f(disk[2]) if len(disk) >= 3 else None,
            "containers": int(parts["containers"]) if parts.get("containers") else None,
        }
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
# Calibragem de alertas — ESPELHA a tela "Calibragem de alertas" do painel Tier
# (painel.tier.finance → static/app.js ALERT_TYPES). Mesmos tipos/severidades/gatilhos;
# o re-aviso (throttle) é lido AO VIVO de /etc/tier-secops/alert.conf no host (igual o
# painel faz). Manter sincronizado com o painel ao mudar limites nos guards.
# ──────────────────────────────────────────────────────────────────────────────
ALERT_TYPES = [
    {"key": "scan", "sev": "critico", "name": "Varredura de saída (port-scan)",
     "when": "Um container faz varredura de portas para a internet (detectado e bloqueado em tempo real pelo scan-guard).",
     "why": "Comportamento de container comprometido — foi o que causou o aviso de abuse da Hetzner.",
     "action": "Investigar/reiniciar a aplicação e trocar credenciais. O scan-guard já bloqueia o tráfego.",
     "limit": "evento (tempo real)"},
    {"key": "cc", "sev": "critico", "name": "Beacon de C&C (malware)",
     "when": "Um container tenta conectar a um servidor de comando de malware (C&C / sinkhole conhecido) — bloqueado pelo C&C-guard.",
     "why": "Container comprometido \"ligando pra casa\". Gerou a listagem Spamhaus XBL (trojan ranbyus).",
     "action": "O C&C-guard já bloqueou. Reiniciar/rebuildar a aplicação e trocar credenciais.",
     "limit": "evento (tempo real)"},
    {"key": "containers", "sev": "critico", "name": "Aplicação fora do ar",
     "when": "Um serviço persistente para de responder (nenhum container no ar).",
     "why": "Queda real de uma aplicação.",
     "action": "Ver logs no Coolify e reiniciar.",
     "limit": "4 camadas anti-falso-positivo"},
    {"key": "ssh", "sev": "critico", "name": "Força bruta SSH",
     "when": "Um IP concentra muitas tentativas de login SSH falhas em 10 minutos.",
     "why": "Tentativa de invasão do servidor.",
     "action": "O fail2ban já bane o IP automaticamente (4 tentativas → ban 1h). Alerta é só ciência.",
     "limit": "≥ 40 tentativas / IP / 10 min"},
    {"key": "cpu", "sev": "alerta", "name": "CPU alta (sobrecarga)",
     "when": "Carga do servidor (load) acima de 3× os vCPUs, de forma sustentada.",
     "why": "Apps lentas, possíveis timeouts.",
     "action": "Ver o app no topo de consumo (a mensagem do alerta mostra).",
     "limit": "load > 3× vCPUs, por 3 ciclos (6 min)"},
    {"key": "ram", "sev": "alerta", "name": "RAM alta",
     "when": "Uso de memória ≥ 95%, de forma sustentada.",
     "why": "Risco de OOM — o kernel pode matar containers.",
     "action": "Reiniciar o app que estiver vazando memória.",
     "limit": "≥ 95%, por 3 ciclos (6 min)"},
    {"key": "disk", "sev": "critico", "name": "Disco quase cheio",
     "when": "Partição / com uso ≥ 90%.",
     "why": "Se encher, bancos e apps param de gravar (quebra geral).",
     "action": "\"docker image prune -a\" + truncar os maiores logs.",
     "limit": "≥ 90%"},
]


# Re-aviso (throttle, em segundos) por tipo — lido ao vivo de alert.conf (igual o painel).
_THROTTLE_SSH_CMD = (
    "CONF=/etc/tier-secops/alert.conf; "
    "echo \"default=$(grep -oE 'ALERT_THROTTLE_SEC=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|scan=$(grep -oE 'THROTTLE_scan=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|cc=$(grep -oE 'THROTTLE_cc=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|containers=$(grep -oE 'THROTTLE_containers=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|ssh=$(grep -oE 'THROTTLE_ssh=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|cpu=$(grep -oE 'THROTTLE_cpu=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|ram=$(grep -oE 'THROTTLE_ram=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)"
    "|disk=$(grep -oE 'THROTTLE_disk=\\\"?[0-9]+' $CONF | grep -oE '[0-9]+' | head -1)\""
)


async def _throttle_from_ssh() -> dict:
    """Re-aviso (segundos) por tipo, lido de alert.conf no host. {} se SSH indisponível."""
    if not getattr(get_settings(), "tier_agent_ssh_privkey_b64", ""):
        return {}
    try:
        from services.container_orchestrator import _ssh_run
        code, out, _err = await asyncio.to_thread(_ssh_run, _THROTTLE_SSH_CMD)
    except Exception:
        return {}
    if code != 0 or not out:
        return {}
    try:
        return dict(p.split("=", 1) for p in out.strip().split("|") if "=" in p)
    except Exception:
        return {}


def _throttle_label(throttle: dict, key: str) -> str:
    raw = throttle.get(key) or throttle.get("default") or "600"
    try:
        n = int(raw)
    except Exception:
        n = 600
    return f"{round(n / 60)} min" if n >= 60 else f"{n}s"


def _fmt_num(v, suf: str = "", nd: int = 0) -> str:
    if v is None:
        return "?"
    try:
        return f"{float(v):.{nd}f}{suf}"
    except Exception:
        return str(v)


# Severidade → (ícone, rótulo). Mesmas labels do painel (crítico/alerta/info).
_SEV_META = {
    "critico": ("🔴", "crítico"), "critical": ("🔴", "crítico"),
    "alerta": ("🟠", "alerta"), "warning": ("🟠", "alerta"),
    "info": ("🔵", "info"),
}


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
            "• *infra* — CPU/RAM/disco do host (quanto tem + % usado)\n"
            "• *calibragem* — parâmetros dos alertas (igual ao painel Tier)\n"
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
        throttle = await _throttle_from_ssh()
        out = [
            "🎚️ *Calibragem de alertas*",
            f"_{len(ALERT_TYPES)} tipos · o que disparam · limites configurados (espelha o painel Tier)_",
        ]
        for ty in ALERT_TYPES:
            ic, lbl = _SEV_META.get(ty["sev"], ("⚪", ty["sev"]))
            out.append("")  # separação entre tipos
            out.append(f"{ic} *{ty['name']}* · {lbl}")
            out.append(f"_Quando_: {ty['when']}")
            out.append(f"_Risco_: {ty['why']}")
            out.append(f"_Ação_: {ty['action']}")
            out.append(f"⚡ Gatilho: {ty['limit']}  ·  ⏱ Re-aviso: {_throttle_label(throttle, ty['key'])}")
        out.append("")
        out.append("_Cada alerta vai por e-mail + WhatsApp e aparece em *alertas*. Ajustável sem redeploy (alert.conf + tier-secops-checks.sh)._")
        return "\n".join(out)

    if first in ("infra", "host"):
        snap = await _infra_snapshot()
        if snap is None:
            return (
                "ℹ️ *Infra do host* não está conectada aqui.\n"
                "Pra ligar: `TIER_INFRA_PROM_URL` (Prometheus) ou a chave SSH "
                "(`TIER_AGENT_SSH_PRIVKEY_B64`) no backend."
            )
        host = getattr(get_settings(), "tier_agent_ssh_host", "") or ""
        ncpu, cpu, load1 = snap.get("ncpu"), snap.get("cpu"), snap.get("load1")
        mt_mb, mu_mb = snap.get("mem_total_mb"), snap.get("mem_used_mb")
        mem_pct = snap.get("mem_pct") if snap.get("mem_pct") is not None else snap.get("mem")
        dt, du = snap.get("disk_total_gb"), snap.get("disk_used_gb")
        disk_pct = snap.get("disk_pct") if snap.get("disk_pct") is not None else snap.get("disk")
        ct = snap.get("containers")

        lines = ["🖥️ *Infra do host*" + (f"  _{host}_" if host else "")]

        cpu_line = f"• *CPU*: {_fmt_num(cpu, '%', 1)} em uso"
        if ncpu:
            cpu_line += f" · {ncpu} vCPUs"
        if load1 is not None:
            cpu_line += f" · load {_fmt_num(load1, '', 2)}"
        lines.append(cpu_line)

        if mt_mb:
            lines.append(
                f"• *Memória*: {_fmt_num((mu_mb or 0) / 1024, ' GB', 1)} / {_fmt_num(mt_mb / 1024, ' GB', 1)} em uso "
                f"· {_fmt_num(mem_pct, '%', 0)}"
            )
        else:
            lines.append(f"• *Memória*: {_fmt_num(mem_pct, '%', 0)} em uso")

        if dt:
            lines.append(
                f"• *Disco /*: {_fmt_num(du, ' GB', 0)} / {_fmt_num(dt, ' GB', 0)} em uso · {_fmt_num(disk_pct, '%', 0)}"
            )
        else:
            lines.append(f"• *Disco /*: {_fmt_num(disk_pct, '%', 0)} em uso")

        if ct is not None:
            lines.append(f"• *Containers*: {ct} no ar")

        lines.append("\n_Limites de alerta de cada um: veja *calibragem*._")
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

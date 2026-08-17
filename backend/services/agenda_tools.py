"""Agenda tools — ferramentas BUILTIN de agendamento de visita (calendário público do CRM).

Gate por agente via `TaRuntimeParam` (escopo='agent', key='agenda_slug'): se o agente tem o
param setado (ex.: 'ccda'), ele ganha as tools `consultar_horarios_visita` e `agendar_visita`
no loop de tool-use do tier_engine — mesma mecânica de merge da federação MCP, mas chamando
a API pública do calendário do CRM direto por HTTP (GET config/slots + POST agendar), sem
servidor MCP no meio.

GENÉRICO por agenda: o slug vem da config do agente; os rótulos de nome/empresa, as opções
de assunto (série) e as perguntas extras vêm do `GET /crm-agenda/{slug}` — nada de cliente
hardcodado aqui. O schema da tool `agendar_visita` é montado dinamicamente a partir da
config da agenda (perguntas extras viram parâmetros; obrigatórias entram em `required`).

REGRA DURA: `agendar_visita` só executa o POST quando TODOS os campos obrigatórios da agenda
vierem preenchidos (pré-checagem local + a própria API devolve 422 com a mensagem certa, que
é repassada ao modelo). Timeout HTTP de 10s; falha de rede → o handler devolve instrução pra
o agente pedir desculpas e oferecer o link público `https://crm.tier.finance/calendario/{slug}`.

Imports de `models` são adiados pra dentro das funções: o módulo fica importável em teste
unitário puro (sem env de banco).
"""

from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

AGENDA_SLUG_PARAM = "agenda_slug"

_HTTP_TIMEOUT_S = 10.0  # REGRA DURA do contrato — nunca segurar o turno além disso
_CONFIG_TTL_S = 300.0
# slug -> (monotonic_ts, config). Stale-if-error: config velha é melhor que tool nenhuma.
_config_cache: dict[str, tuple[float, dict]] = {}

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_MAX_DIAS = 7
_MAX_SLOTS_POR_DIA = 12

PUBLIC_CALENDAR_BASE = "https://crm.tier.finance/calendario"


def _base_url() -> str:
    return get_settings().tier_erp_api_url.rstrip("/") + "/api/crm-agenda"


def _fallback_msg(slug: str) -> str:
    return (
        "[a agenda está temporariamente indisponível. Peça desculpas ao cliente, diga que não "
        "conseguiu acessar a agenda agora e ofereça o link "
        f"{PUBLIC_CALENDAR_BASE}/{slug} para ele agendar direto pela página.]"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Lógica PURA (testável sem HTTP/banco)
# ─────────────────────────────────────────────────────────────────────────────
def _slugify(label: str) -> str:
    """Transforma o label de uma pergunta em nome de parâmetro seguro pro schema.

    Ex.: 'Como conheceu o Colégio?' -> 'como_conheceu_o_colegio'."""
    s = unicodedata.normalize("NFKD", label or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:48] or "campo"


def build_tool_schemas(slug: str, config: dict) -> tuple[list[dict], dict[str, str]]:
    """Monta os schemas OpenAI-function das duas tools a partir da config da agenda.

    Devolve `(schemas, extras_map)` onde extras_map mapeia nome-do-parâmetro -> label
    ORIGINAL da pergunta extra (o POST /agendar casa resposta por label exato)."""
    titulo = (config.get("titulo") or "visita").strip()
    labels = config.get("labels") or {}
    nome_label = (labels.get("nome") or "Nome completo").strip()
    empresa_label = (labels.get("empresa") or "").strip()
    assuntos = [a.get("nome") for a in (config.get("assuntos") or []) if isinstance(a, dict) and a.get("nome")]
    perguntas = config.get("perguntas_extras") or []
    local = (config.get("local") or "").strip()

    consultar = {
        "type": "function",
        "function": {
            "name": "consultar_horarios_visita",
            "description": (
                f"Consulta os horários DISPONÍVEIS do calendário de agendamento ('{titulo}'). "
                "SEMPRE consulte aqui antes de oferecer qualquer horário — nunca invente horário "
                "nem ofereça horário que não veio desta ferramenta."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "string",
                        "description": "Data desejada no formato AAAA-MM-DD (ex.: 2026-08-20).",
                    }
                },
                "required": ["data"],
            },
        },
    }

    props: dict[str, dict] = {
        "inicio": {
            "type": "string",
            "description": (
                "Horário escolhido pelo cliente — copie EXATAMENTE o campo 'inicio' de um "
                "horário disponível retornado por consultar_horarios_visita "
                "(ISO 8601 com fuso, ex.: 2026-08-20T09:40:00-03:00). Nunca invente."
            ),
        },
        "nome": {"type": "string", "description": f"{nome_label} (pergunte na conversa se ainda não tiver)."},
    }
    required = ["inicio", "nome"]
    if empresa_label:
        props["empresa"] = {
            "type": "string",
            "description": f"{empresa_label} (pergunte na conversa se ainda não tiver).",
        }
        required.append("empresa")
    assunto_desc = "Assunto da visita — OBRIGATÓRIO. Use exatamente uma das opções da lista."
    props["assunto"] = {"type": "string", "description": assunto_desc}
    if assuntos:
        props["assunto"]["enum"] = assuntos
    required.append("assunto")
    props["telefone"] = {
        "type": "string",
        "description": (
            "Telefone/WhatsApp do cliente com DDD (opcional — se não informar, o número do "
            "WhatsApp da própria conversa é usado automaticamente)."
        ),
    }
    props["email"] = {"type": "string", "description": "E-mail do cliente (opcional, se ele informar)."}

    extras_map: dict[str, str] = {}
    for i, p in enumerate(perguntas):
        label = str((p or {}).get("label") or "").strip()
        if not label:
            continue
        pname = _slugify(label)
        if pname in props or pname in extras_map:
            pname = f"{pname}_{i + 1}"
        extras_map[pname] = label
        props[pname] = {
            "type": "string",
            "description": f'Resposta do cliente à pergunta: "{label}"',
        }
        if (p or {}).get("obrigatoria"):
            required.append(pname)

    agendar = {
        "type": "function",
        "function": {
            "name": "agendar_visita",
            "description": (
                f"Cria o agendamento de visita ('{titulo}')"
                + (f" — local: {local}." if local else ".")
                + " Só chame quando o cliente JÁ escolheu um horário disponível E você já coletou "
                "TODOS os campos obrigatórios na conversa. Se faltar algo, pergunte antes."
            ),
            "parameters": {"type": "object", "properties": props, "required": required},
        },
    }
    return [consultar, agendar], extras_map


def missing_required_fields(args: dict, agendar_schema: dict) -> list[str]:
    """Campos obrigatórios do schema que vieram vazios/ausentes nos args do modelo."""
    fn = (agendar_schema or {}).get("function") or {}
    required = ((fn.get("parameters") or {}).get("required")) or []
    return [r for r in required if not str((args or {}).get(r) or "").strip()]


def build_agendar_payload(
    args: dict, extras_map: dict[str, str], customer_phone: str | None = None
) -> dict:
    """Monta o body do POST /crm-agenda/{slug}/agendar a partir dos args da tool.

    - extras (parâmetros dinâmicos) voltam a ser `respostas_extras: [{label, resposta}]`
      com o label ORIGINAL da agenda (o backend valida por label exato);
    - telefone: o informado na conversa; sem ele, cai no telefone REAL do canal
      (identidade vem do WhatsApp, não do modelo — evita placeholder)."""
    args = args or {}
    telefone = re.sub(r"\D", "", str(args.get("telefone") or "")) or re.sub(
        r"\D", "", customer_phone or ""
    )
    body: dict[str, Any] = {
        "inicio": str(args.get("inicio") or "").strip(),
        "nome": str(args.get("nome") or "").strip(),
        "assunto": str(args.get("assunto") or "").strip(),
    }
    empresa = str(args.get("empresa") or "").strip()
    if empresa:
        body["empresa"] = empresa
    if telefone:
        body["telefone"] = telefone
    email = str(args.get("email") or "").strip()
    if email:
        body["email"] = email
    extras = []
    for pname, label in extras_map.items():
        resposta = str(args.get(pname) or "").strip()
        if resposta:
            extras.append({"label": label, "resposta": resposta})
    if extras:
        body["respostas_extras"] = extras
    return body


def summarize_slots(slots_payload: dict, data_pedida: str) -> dict:
    """Resume a resposta de /slots pro modelo: só horários disponíveis, agrupados por dia.

    O marcador 'AGENDÁVEIS' no resumo é DE PROPÓSITO: liga o freio `denies_slots` do
    tier_engine (que pega o modelo negando horário quando a ferramenta retornou algum)."""
    slots = (slots_payload or {}).get("slots") or []
    disponiveis = [s for s in slots if s.get("disponivel")]
    dias: dict[str, list[dict]] = {}
    for s in disponiveis:
        dia = s.get("dia") or str(s.get("inicio") or "")[:10]
        if len(dias) >= _MAX_DIAS and dia not in dias:
            continue
        lst = dias.setdefault(dia, [])
        if len(lst) >= _MAX_SLOTS_POR_DIA:
            continue
        lst.append({"hora": s.get("hora"), "inicio": s.get("inicio")})
    total = sum(len(v) for v in dias.values())
    if not total:
        return {
            "data_pedida": data_pedida,
            "aviso": (
                "Nenhum horário disponível nesse período "
                f"({slots_payload.get('de')} a {slots_payload.get('ate')}). "
                "Consulte outra data."
            ),
        }
    return {
        "status": f"{total} horários AGENDÁVEIS",
        "data_pedida": data_pedida,
        "duracao_min": slots_payload.get("duracao_min"),
        "timezone": slots_payload.get("timezone"),
        "dias": [{"dia": d, "horarios": h} for d, h in sorted(dias.items())],
        "instrucao": (
            "Ofereça 2 a 3 opções ao cliente. Para agendar, use o campo 'inicio' EXATO do "
            "horário escolhido em agendar_visita."
        ),
    }


def _detail_text(resp: httpx.Response) -> str:
    """Extrai o `detail` de um erro FastAPI (str ou lista Pydantic) como texto legível."""
    try:
        detail = resp.json().get("detail")
    except Exception:  # noqa: BLE001
        detail = None
    if detail is None:
        return (resp.text or "")[:300]
    if isinstance(detail, str):
        return detail[:400]
    return json.dumps(detail, ensure_ascii=False)[:400]


# ─────────────────────────────────────────────────────────────────────────────
# Config da agenda (HTTP + cache) e gate por agente
# ─────────────────────────────────────────────────────────────────────────────
async def get_agenda_slug(db, agent_id: int) -> str | None:
    """Slug da agenda do agente (TaRuntimeParam escopo='agent', key='agenda_slug')."""
    from sqlalchemy import select

    from models import TaRuntimeParam

    row = (
        await db.execute(
            select(TaRuntimeParam.value)
            .where(
                TaRuntimeParam.escopo == "agent",
                TaRuntimeParam.escopo_id == agent_id,
                TaRuntimeParam.key == AGENDA_SLUG_PARAM,
            )
            .order_by(TaRuntimeParam.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    slug = (row or "").strip().lower()
    if not slug:
        return None
    if not _SLUG_RE.match(slug):
        logger.warning("agenda_tools: agenda_slug inválido agent=%s (%r) — ignorando", agent_id, slug)
        return None
    return slug


def invalidate_config_cache(slug: str | None = None) -> None:
    if slug is None:
        _config_cache.clear()
    else:
        _config_cache.pop(slug, None)


async def _get_config(slug: str) -> dict | None:
    hit = _config_cache.get(slug)
    now = time.monotonic()
    if hit and (now - hit[0]) < _CONFIG_TTL_S:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
            r = await cli.get(f"{_base_url()}/{slug}")
        if r.status_code >= 400:
            logger.warning("agenda_tools: GET config %s retornou %s", slug, r.status_code)
            return hit[1] if hit else None  # stale-if-error
        cfg = r.json()
    except Exception:
        logger.exception("agenda_tools: GET config %s falhou", slug)
        return hit[1] if hit else None
    if isinstance(cfg, dict):
        _config_cache[slug] = (now, cfg)
        return cfg
    return hit[1] if hit else None


# ─────────────────────────────────────────────────────────────────────────────
# Handlers (assinatura idêntica às tools MCP: (args: dict) -> Awaitable[str])
# ─────────────────────────────────────────────────────────────────────────────
def _make_consultar_handler(slug: str) -> Callable[[dict], Awaitable[str]]:
    async def _handler(args: dict) -> str:
        data = str((args or {}).get("data") or "").strip()
        if not _DATE_RE.match(data):
            return "[data inválida — chame de novo com data no formato AAAA-MM-DD, ex.: 2026-08-20]"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
                r = await cli.get(f"{_base_url()}/{slug}/slots", params={"data": data})
        except Exception:
            logger.exception("agenda_tools: GET slots %s falhou", slug)
            return _fallback_msg(slug)
        if r.status_code >= 400:
            logger.warning("agenda_tools: GET slots %s retornou %s", slug, r.status_code)
            return _fallback_msg(slug)
        try:
            payload = r.json()
        except Exception:  # noqa: BLE001
            return _fallback_msg(slug)
        return json.dumps(summarize_slots(payload, data), ensure_ascii=False)

    return _handler


def _make_agendar_handler(
    slug: str,
    config: dict,
    agendar_schema: dict,
    extras_map: dict[str, str],
    customer_phone: str | None,
) -> Callable[[dict], Awaitable[str]]:
    labels = (config or {}).get("labels") or {}
    nomes_legiveis = {
        "inicio": "horário escolhido (campo 'inicio' do slot)",
        "nome": labels.get("nome") or "nome completo",
        "empresa": labels.get("empresa") or "empresa",
        "assunto": "assunto/série (uma das opções da lista)",
        **extras_map,
    }

    async def _handler(args: dict) -> str:
        # REGRA DURA: não executa sem TODOS os obrigatórios coletados na conversa.
        faltam = missing_required_fields(args or {}, agendar_schema)
        if faltam:
            legiveis = "; ".join(nomes_legiveis.get(f, f) for f in faltam)
            return (
                f"[NÃO agendado — ainda faltam dados obrigatórios: {legiveis}. "
                "Pergunte ao cliente o que falta (de forma natural, sem listar tudo de uma vez) "
                "e chame agendar_visita de novo com tudo preenchido.]"
            )
        body = build_agendar_payload(args or {}, extras_map, customer_phone)
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
                r = await cli.post(f"{_base_url()}/{slug}/agendar", json=body)
        except Exception:
            logger.exception("agenda_tools: POST agendar %s falhou", slug)
            return _fallback_msg(slug)

        if r.status_code in (200, 201):
            try:
                data = r.json() if r.content else {}
            except Exception:  # noqa: BLE001
                data = {}
            if not isinstance(data, dict):
                data = {}
            resultado = {
                "sucesso": True,
                # 'agendamento_id' também liga o freio de confirmação do tier_engine
                # (garante que o modelo confirme ao cliente depois de criar).
                "agendamento_id": data.get("id") or data.get("agendamento_id"),
                "inicio": body.get("inicio"),
                "assunto": body.get("assunto"),
                "local": (config or {}).get("local"),
                "mensagem": (
                    "Visita agendada com sucesso. Confirme ao cliente o dia, o horário e o local."
                ),
            }
            return json.dumps(resultado, ensure_ascii=False)
        if r.status_code == 409:
            return (
                f"[horário indisponível: {_detail_text(r)}. Esse horário acabou de ser tomado — "
                "chame consultar_horarios_visita de novo e ofereça outra opção ao cliente.]"
            )
        if r.status_code == 422:
            # A API valida os obrigatórios da agenda e devolve a mensagem certa — repassa.
            return (
                f"[agendamento recusado pela agenda: {_detail_text(r)}. Colete o que falta com o "
                "cliente e chame agendar_visita de novo.]"
            )
        logger.warning("agenda_tools: POST agendar %s retornou %s: %s", slug, r.status_code, r.text[:200])
        return _fallback_msg(slug)

    return _handler


async def discover_agenda_tools(
    db, agent_id: int, customer_phone: str | None = None
) -> tuple[list[dict], dict[str, Callable[[dict], Awaitable[str]]]]:
    """Descobre as tools de agenda do agente (se ele tiver `agenda_slug` configurado).

    Mesmo contrato do `tool_provider_service.discover_agent_tools`: devolve
    `(schemas OpenAI-function, mapa nome->handler)`. Sem slug OU config inacessível →
    `([], {})` e o agente segue sem as tools (degrada, nunca derruba a resposta)."""
    slug = await get_agenda_slug(db, agent_id)
    if not slug:
        return [], {}
    config = await _get_config(slug)
    if not config:
        logger.warning("agenda_tools: config da agenda '%s' indisponível — agente sem tools de agenda", slug)
        return [], {}
    schemas, extras_map = build_tool_schemas(slug, config)
    agendar_schema = schemas[1]
    handlers = {
        "consultar_horarios_visita": _make_consultar_handler(slug),
        "agendar_visita": _make_agendar_handler(slug, config, agendar_schema, extras_map, customer_phone),
    }
    return schemas, handlers

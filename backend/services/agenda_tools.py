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


_SEMANA_PT = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
              "sexta-feira", "sábado", "domingo")


def _dia_da_semana(iso: str) -> str:
    """O dia da semana de uma data ISO.

    🚨 NÃO entra na oferta de visita: o documento manda 'Dia 00/00 às 00h', sem
    dia da semana, e o agente dizendo "Domingo 31/08" estava errado duas vezes —
    o dia estava errado E não devia estar ali. Fica no payload só para quando a
    família pergunta que dia da semana é. Conta, não juízo: quem tem o calendário
    é o servidor."""
    try:
        from datetime import date as _d

        y, m, dd = (int(x) for x in iso[:10].split("-"))
        return _SEMANA_PT[_d(y, m, dd).weekday()]
    except Exception:  # noqa: BLE001
        return ""


def _dia_br(iso: str) -> str:
    """dd/mm — o formato que a família lê."""
    try:
        return "%s/%s" % (iso[8:10], iso[5:7])
    except Exception:  # noqa: BLE001
        return iso


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
        # 🚨 `semana` e `dia_br` vêm do SERVIDOR. Sem eles o modelo tinha de
        # deduzir o dia da semana da data ISO — e errava. Medido numa conversa
        # real: 31/08 é SEGUNDA e ele ofereceu "domingo", a família corrigiu, ele
        # ofereceu "sábado", errado de novo. Dia da semana é conta, não juízo:
        # quem tem o calendário é o servidor.
        "dias": [
            {"dia": d, "semana": _dia_da_semana(d), "dia_br": _dia_br(d), "horarios": h}
            for d, h in sorted(dias.items())
        ],
        "instrucao": (
            "Ofereça 2 a 3 opções no formato exato 'Dia {dia_br} às {hora}' — use o "
            "'dia_br' como está e NÃO diga o dia da semana ao oferecer visita. "
            "'semana' está aqui só para o caso de a família perguntar diretamente que "
            "dia da semana é; nunca calcule isso você mesmo. "
            "Para agendar, use o campo 'inicio' EXATO do horário escolhido em agendar_visita."
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


# As seis etapas do eixo 1 do documento v3 que o agente alcança pela conversa.
# 🚨 "Entrada de Lead" fica FORA: é onde o card nasce, e uma tool que pudesse
# voltar pra lá deixaria o modelo desfazer progresso. E "Perdido" saiu do enum —
# tem ferramenta própria, por causa da regra de negativa (ver `marcar_perda`).
ETAPAS_QUE_O_AGENTE_MOVE = [
    "Série identificada",
    "Motivo identificado",
    "Interesse em avançar",
    "Visita Agendada",
    "Visita Realizada",
]

# 🚨 Lista FECHADA de motivos. O v3 é explícito sobre o que NÃO é perda, e sem um
# enum o modelo escreveria "cliente disse que vai pensar" como motivo — que é
# exatamente o caso em que ele não deveria ter chamado a ferramenta.
MOTIVOS_DE_PERDA = ["não tem interesse"]


def build_etapa_tool_schema() -> dict:
    """Schema da tool que registra no funil o que a conversa resolveu.

    🚨 Só o que a CONVERSA resolve. O resto do funil (tentativa de contato,
    no-show, reengajamento) é consequência de coisas que acontecem FORA da
    conversa, e quem move é a automação. Uma tool que aceitasse qualquer etapa
    convidaria o modelo a inventar movimento de funil a partir de conversa fiada.

    🚨 As etapas do enum são o NOME exato da coluna. O agente não tem como saber
    ids, e id numa instrução de prompt é o tipo de coisa que fica errada em
    silêncio quando alguém reordena o funil na tela.
    """
    return {
        "type": "function",
        "function": {
            "name": "atualizar_etapa_crm",
            "description": (
                "Registra no CRM o estágio comercial que a conversa acabou de alcançar. "
                "Use assim que o evento acontecer de fato: "
                "'Série identificada' quando souber o ano escolar; "
                "'Motivo identificado' quando a família contar por que está procurando escola; "
                "'Interesse em avançar' quando ela demonstrar intenção de continuar (conhecer, ligação); "
                "'Visita Agendada' logo depois de agendar_visita dar certo; "
                "'Visita Realizada' quando a visita tiver acontecido. "
                "NÃO avance uma etapa só porque a família respondeu — avance quando o evento "
                "daquela etapa ocorrer. Para perda, use marcar_perda. "
                "Nunca avise a família de que fez isso."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "etapa": {
                        "type": "string",
                        "enum": ETAPAS_QUE_O_AGENTE_MOVE,
                        "description": "A etapa do funil para onde o card vai.",
                    },
                },
                "required": ["etapa"],
            },
        },
    }


# Os campos que a CONVERSA descobre. Fechado, e igual ao do lado do CRM — se as
# duas listas divergirem, o modelo chama um campo que o endpoint recusa e a
# jornada trava sem explicacao na tela.
CAMPOS_DO_AGENTE = [
    # 🚨 `nome` é campo NATIVO do contato, não custom — mas o modelo tentou
    # gravá-lo e levou "[campo inválido]" de volta. Ele estava certo em querer:
    # o roteiro manda usar o nome do responsável assim que souber. Quem trata a
    # diferença é o CRM, não o modelo.
    "nome",
    "ano_escolar",
    "nome_do_filho",
    "escola_atual",
    "motivo_procura",
    "motivo_procura_categoria",
    "preco_apresentado",
    "valor_apresentado",
]

CATEGORIAS_DE_MOTIVO = [
    "Adaptação", "Pedagógico", "Rotina", "Logística",
    "Estrutura", "Desempenho", "Preço", "Mudança", "Outro",
]


# ── Série pela data de nascimento ──────────────────────────────────────────────
# 🚨 A regra é NACIONAL e é uma data: a criança precisa de 6 anos completos até
# 31 de março do ano letivo para entrar no 1º ano (CNE/CEB 2/2018). Um dia de
# diferença muda o ano inteiro — nascido em 31/03 entra, nascido em 01/04 espera.
# É exatamente essa a dúvida que as famílias trazem.
CORTE_MES, CORTE_DIA = 3, 31

# Idade em 31/03 → série. O CCDA vai do Jardim I ao 3º do Médio; fora dessa
# faixa a resposta é "fora do que a escola atende", não um palpite.
SERIE_POR_IDADE = {
    4: "Jardim I",
    5: "Jardim II",
    6: "1º ano do Ensino Fundamental",
    7: "2º ano do Ensino Fundamental",
    8: "3º ano do Ensino Fundamental",
    9: "4º ano do Ensino Fundamental",
    10: "5º ano do Ensino Fundamental",
    11: "6º ano do Ensino Fundamental",
    12: "7º ano do Ensino Fundamental",
    13: "8º ano do Ensino Fundamental",
    14: "9º ano do Ensino Fundamental",
    15: "1ª série do Ensino Médio",
    16: "2ª série do Ensino Médio",
    17: "3ª série do Ensino Médio",
}


def calcular_serie(data_nascimento: str, ano_letivo: int) -> dict:
    """A série da criança no ano letivo pedido, pelo corte de 31/03.

    Devolve também a idade na data de corte e um aviso quando o aniversário cai
    perto dela — não para hesitar, mas porque é o caso em que a família costuma
    ter ouvido coisa diferente em outra escola.
    """
    from datetime import date as _date

    try:
        ano, mes, dia = (int(x) for x in str(data_nascimento)[:10].split("-"))
        nasc = _date(ano, mes, dia)
    except Exception:  # noqa: BLE001
        return {"erro": "data de nascimento inválida — use AAAA-MM-DD"}

    corte = _date(ano_letivo, CORTE_MES, CORTE_DIA)
    if nasc >= corte:
        return {"erro": "data de nascimento posterior à data de corte do ano letivo pedido"}

    idade = corte.year - nasc.year - ((corte.month, corte.day) < (nasc.month, nasc.day))
    serie = SERIE_POR_IDADE.get(idade)

    out = {
        "ano_letivo": ano_letivo,
        "idade_no_corte": idade,
        "data_corte": corte.strftime("%d/%m/%Y"),
        "serie": serie,
    }
    if not serie:
        out["serie"] = None
        idade_minima = min(SERIE_POR_IDADE)
        if idade < idade_minima:
            # 🚨 Isto NÃO é um "não" — é um "quando". A criança entra, só que no
            # ano seguinte, e às vezes por dois dias de diferença. O atendimento
            # que responde "infelizmente terá que aguardar" e muda de assunto
            # perde uma matrícula que já estava decidida.
            anos_a_esperar = idade_minima - idade
            out["entra_em"] = ano_letivo + anos_a_esperar
            out["serie_quando_entrar"] = SERIE_POR_IDADE[idade_minima]
            out["orientacao"] = (
                f"NÃO diga apenas que não é elegível, e NUNCA use 'infelizmente'. "
                f"A criança ENTRA — no {SERIE_POR_IDADE[idade_minima]} em "
                f"{ano_letivo + anos_a_esperar}. Diga isso primeiro, com a data de "
                f"corte (31/03) explicando o porquê. Reconheça se ficou perto do "
                f"corte: para a família dois dias parecem injustos, e ela precisa "
                f"sentir que você entende isso. Depois ofereça continuar o contato "
                f"— visita para conhecer, ou avisar quando abrir a matrícula. "
                f"Nunca encerre a conversa nem mude de assunto."
            )
        else:
            out["orientacao"] = (
                "Idade acima do que o colégio atende (vai até o 3º do Ensino Médio). "
                "NÃO invente uma série: diga que confirma pessoalmente."
            )
        return out

    # 🚨 O caso de borda é o que gera a dúvida: quem faz aniversário em abril
    # espera um ano inteiro, e a família quase sempre acha que não. Vale dizer a
    # data de corte em voz alta nesse caso.
    if (nasc.month, nasc.day) > (CORTE_MES, CORTE_DIA):
        out["observacao"] = (
            f"O aniversário é depois de 31/03, então em {ano_letivo} a idade no corte é "
            f"{idade}. Explique o corte de 31/03 com naturalidade — é a dúvida mais comum "
            f"das famílias, e ela costuma achar que conta. Não soe burocrática: a regra é "
            f"do calendário escolar, não uma decisão do colégio."
        )
    return out


def build_serie_tool_schema() -> dict:
    """Schema da tool que calcula a série pela data de nascimento.

    🚨 Existe porque o modelo NÃO PODE fazer esta conta. O corte de 31/03 muda o
    ano letivo inteiro por um dia de diferença, e conta feita por modelo erra —
    foi o que aconteceu com o dia da semana, errado em 3 de 3. Aqui o erro é
    caro: a família ouve que o filho entra este ano quando entra no que vem.
    """
    return {
        "type": "function",
        "function": {
            "name": "consultar_serie_por_nascimento",
            "description": (
                "Calcula em que série a criança se enquadra, pela data de nascimento e pelo "
                "corte legal de 31 de março. Use SEMPRE que a família der a data de nascimento "
                "ou perguntar se o filho já pode entrar no 1º ano. "
                "NUNCA calcule a série você mesmo — um dia de diferença muda o ano letivo "
                "inteiro. Responda com a série que a ferramenta devolver. Se a criança "
                "ainda não tiver idade, a ferramenta diz em que ano ela ENTRA: diga isso, "
                "nunca apenas que não é elegível."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "data_nascimento": {
                        "type": "string",
                        "description": "Data de nascimento no formato AAAA-MM-DD.",
                    },
                    "ano_letivo": {
                        "type": "integer",
                        "description": (
                            "O ano letivo da matrícula. Se a família não disser, use o ano "
                            "seguinte ao atual (matrícula nova é para o próximo ano)."
                        ),
                    },
                },
                "required": ["data_nascimento", "ano_letivo"],
            },
        },
    }


def _make_serie_handler() -> Callable[[dict], Awaitable[str]]:
    async def _handler(args: dict) -> str:
        from datetime import date as _d

        nasc = str((args or {}).get("data_nascimento") or "").strip()
        try:
            ano = int((args or {}).get("ano_letivo") or 0)
        except (TypeError, ValueError):
            ano = 0
        if not ano:
            # Matrícula nova é para o ano seguinte — é o que a família quer saber.
            ano = _d.today().year + 1
        return json.dumps(calcular_serie(nasc, ano), ensure_ascii=False)

    return _handler


def build_campo_tool_schema() -> dict:
    """Schema da tool que grava no card o que a conversa descobriu.

    🚨 Esta tool é o PRIMEIRO ELO da jornada. Duas transições do funil acontecem
    quando o DADO chega, não quando alguém move o card: `ano_escolar` preenchido
    leva a "Série identificada", `motivo_procura_categoria` leva a "Motivo
    identificado". Sem ela o agente conversa bem, o CRM não sabe de nada e o card
    fica parado em Entrada de Lead para sempre.

    🚨 A tool NÃO move etapa, de propósito. Pedir ao modelo que grave o campo E
    mova o card seria pedir que ele repita uma regra que o CRM já sabe — e ele
    erraria em algum momento. Quem move é a automação, do lado do CRM.

    🚨 `motivo_procura_categoria` tem enum: a categoria escolhe qual dos nove
    textos de reengajamento sai depois. Texto livre ali viraria uma categoria
    nova por conversa, e a cascata cairia sempre no genérico.
    """
    return {
        "type": "function",
        "function": {
            "name": "atualizar_campo_crm",
            "description": (
                "Grava no CRM uma informação que a família acabou de dar. Chame assim que "
                "souber, uma vez por informação: ano_escolar (a série), nome_do_filho, "
                "escola_atual, motivo_procura (o que a família disse, com as palavras dela), "
                "motivo_procura_categoria (classifique o motivo), preco_apresentado ('sim' "
                "quando você acabou de informar o valor) e valor_apresentado. "
                "Nunca avise a família de que fez isso."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "campo": {
                        "type": "string",
                        "enum": CAMPOS_DO_AGENTE,
                        "description": "Qual informação está sendo gravada.",
                    },
                    "valor": {
                        "type": "string",
                        "description": (
                            "O valor. Para motivo_procura_categoria use exatamente uma destas: "
                            + ", ".join(CATEGORIAS_DE_MOTIVO)
                        ),
                    },
                },
                "required": ["campo", "valor"],
            },
        },
    }


def _make_campo_handler(slug: str, customer_phone: str | None) -> Callable[[dict], Awaitable[str]]:
    async def _handler(args: dict) -> str:
        if not customer_phone:
            logger.warning("agenda_tools: atualizar_campo_crm sem telefone (slug=%s)", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        campo = str((args or {}).get("campo") or "").strip()
        valor = str((args or {}).get("valor") or "").strip()
        if campo not in CAMPOS_DO_AGENTE:
            return f"[campo inválido. Use um destes: {', '.join(CAMPOS_DO_AGENTE)}]"
        if not valor:
            return "[valor vazio, não registrei. NÃO mencione isso. Responda a mensagem da família e siga o roteiro.]"

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
                r = await cli.post(
                    f"{_base_url()}/{slug}/campo",
                    json={"telefone": customer_phone, "campo": campo, "valor": valor},
                )
        except Exception:
            logger.exception("agenda_tools: POST campo %s falhou", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        if r.status_code == 404:
            logger.info("agenda_tools: campo %s sem card para %s", slug, customer_phone[-4:])
            return "[registrado no sistema. NÃO mencione isso para a família. Agora responda a mensagem dela e siga o roteiro — não deixe de responder.]"
        if r.status_code == 422:
            # o CRM recusou o campo: devolve o motivo pro modelo corrigir agora
            return f"[{(r.json() or {}).get('detail', 'campo recusado')}]"
        if r.status_code >= 400:
            logger.warning("agenda_tools: campo %s retornou %s: %s", slug, r.status_code, r.text[:200])
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        movido = (r.json() or {}).get("movido_para")
        logger.info("agenda_tools: campo %s=%r gravado%s", campo, valor[:40],
                    f" (card -> {movido})" if movido else "")
        return "[registrado no sistema. NÃO mencione isso para a família. Agora responda a mensagem dela e siga o roteiro — não deixe de responder.]"

    return _handler


def build_perda_tool_schema() -> dict:
    """Schema da tool de perda — separada da de etapa, e de propósito.

    🚨 A regra que justifica a separação é a NEGATIVA. O v3 lista o que não é
    perda: "vou pensar", "depois vejo", "agora não", "está caro", "vou conversar
    com meu marido/esposa", "estou pesquisando", "estou olhando outras escolas".
    Como valor de enum dentro da tool de etapa, essa regra não teria onde morar —
    a descrição do enum é uma linha, e ali ela some.

    Perder um lead cedo demais é o erro caro: o card sai do funil, para de ser
    reengajado, e ninguém revisita.
    """
    return {
        "type": "function",
        "function": {
            "name": "marcar_perda",
            "description": (
                "Registra que a família NÃO quer mais seguir. Use SOMENTE diante de recusa "
                "explícita: 'não tenho interesse', 'não quero mais informações', 'pode encerrar', "
                "'já escolhi outra escola', 'não entre mais em contato'. "
                "NUNCA conte como perda: 'vou pensar', 'depois vejo', 'agora não', 'está caro', "
                "'vou conversar com meu marido/esposa', 'estou pesquisando', 'estou olhando outras "
                "escolas'. Na dúvida, NÃO chame esta ferramenta. "
                "Nunca avise a família de que fez isso."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "motivo": {
                        "type": "string",
                        "enum": MOTIVOS_DE_PERDA,
                        "description": "O motivo da perda.",
                    },
                },
                "required": ["motivo"],
            },
        },
    }


def _make_etapa_handler(slug: str, customer_phone: str | None) -> Callable[[dict], Awaitable[str]]:
    async def _handler(args: dict) -> str:
        if not customer_phone:
            # Sem telefone não há como achar o card. Falha SILENCIOSA para o
            # cliente: o agente não deve pedir desculpa por uma engrenagem
            # interna que a família não sabe que existe.
            logger.warning("agenda_tools: atualizar_etapa_crm sem telefone (slug=%s)", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        etapa = str((args or {}).get("etapa") or "").strip()
        if etapa not in ETAPAS_QUE_O_AGENTE_MOVE:
            validas = ", ".join(ETAPAS_QUE_O_AGENTE_MOVE)
            return f"[etapa inválida. Use exatamente uma destas: {validas}]"

        corpo = {"telefone": customer_phone, "etapa": etapa}
        # A perda não passa mais por aqui: tem ferramenta própria. Motivo que
        # chegasse nesta tool seria motivo sem perda — dado solto no card.
        motivo = str((args or {}).get("motivo") or "").strip()
        if motivo:
            logger.info("agenda_tools: motivo ignorado em atualizar_etapa_crm (use marcar_perda)")

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
                r = await cli.post(f"{_base_url()}/{slug}/mover-etapa", json=corpo)
        except Exception:
            logger.exception("agenda_tools: POST mover-etapa %s falhou", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        if r.status_code == 404:
            # contato ou card ainda não existem — comum quando a conversa começou
            # agora. Não é erro que a família precise ver.
            logger.info("agenda_tools: mover-etapa %s sem card para %s", slug, customer_phone[-4:])
            return "[ainda não há negociação aberta para este contato. Siga a conversa normalmente.]"
        if r.status_code >= 400:
            logger.warning("agenda_tools: mover-etapa %s retornou %s: %s", slug, r.status_code, r.text[:200])
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        try:
            resp = r.json()
        except Exception:  # noqa: BLE001
            resp = {}
        destino = resp.get("funil") or ""
        onde = f" no funil {destino}" if destino else ""
        return f"[registrado no CRM: card em '{resp.get('etapa', etapa)}'{onde}. Não comente isso com a família.]"

    return _handler


def _make_perda_handler(slug: str, customer_phone: str | None) -> Callable[[dict], Awaitable[str]]:
    """Registra a perda pelo endpoint da cascata, que já sabe fazer as três
    coisas que uma perda exige: guardar de onde o card saiu
    (`ultima_etapa_ativa`, sem o qual a reativação do v3 não tem para onde
    voltar), gravar o motivo como CAMPO — a perda virou uma coluna só — e rodar
    o handoff para o funil de Loss.
    """

    async def _handler(args: dict) -> str:
        if not customer_phone:
            logger.warning("agenda_tools: marcar_perda sem telefone (slug=%s)", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        motivo = str((args or {}).get("motivo") or "").strip() or MOTIVOS_DE_PERDA[0]
        if motivo not in MOTIVOS_DE_PERDA:
            # 🚨 Não recusa: normaliza. Recusar faria o modelo tentar de novo com
            # outro texto e, na terceira, desistir de registrar — a perda ficaria
            # invisível no funil, que é pior do que um motivo aproximado.
            logger.info("agenda_tools: motivo de perda fora da lista (%r) — normalizado", motivo)
            motivo = MOTIVOS_DE_PERDA[0]

        corpo = {"telefone": customer_phone, "campos": {"status_atendimento": "PERDIDO"},
                 "perda": motivo}
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
                r = await cli.post(f"{_base_url()}/{slug}/cascata", json=corpo)
        except Exception:
            logger.exception("agenda_tools: POST cascata (perda) %s falhou", slug)
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        if r.status_code == 404:
            logger.info("agenda_tools: perda %s sem card para %s", slug, customer_phone[-4:])
            return "[registrado no sistema. NÃO mencione isso para a família. Agora responda a mensagem dela e siga o roteiro — não deixe de responder.]"
        if r.status_code >= 400:
            logger.warning("agenda_tools: perda %s retornou %s: %s", slug, r.status_code, r.text[:200])
            return "[não consegui registrar no sistema agora. NÃO mencione isso para a família. Responda a mensagem dela normalmente e siga o roteiro.]"

        logger.info("agenda_tools: perda registrada (%s) para %s", motivo, customer_phone[-4:])
        return "[registrado no sistema. NÃO mencione isso para a família. Agora responda a mensagem dela e siga o roteiro — não deixe de responder.]"

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
        "atualizar_etapa_crm": _make_etapa_handler(slug, customer_phone),
        "marcar_perda": _make_perda_handler(slug, customer_phone),
        "atualizar_campo_crm": _make_campo_handler(slug, customer_phone),
        "consultar_serie_por_nascimento": _make_serie_handler(),
    }
    schemas = list(schemas) + [
        build_etapa_tool_schema(),
        build_perda_tool_schema(),
        build_campo_tool_schema(),
        build_serie_tool_schema(),
    ]
    return schemas, handlers

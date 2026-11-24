"""Agent runtime — orquestra recepção de mensagem → Engine → envio de volta no canal.

Fluxo:
1. Webhook channel chega
2. resolve_agent_from_connector identifica o agente
3. ensure_conversation cria/atualiza TaConversation
4. tier_engine.send_message → Engine responde
5. connectors.registry.send → envia resposta de volta no canal
6. log usage em TaMessageLog + TaUsageDaily
"""

import json
import logging
import os
import time
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaUsageDaily
from services import tier_engine, playbook_executor, playbook_router, templates as _templates
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage
from services.previa_link import anexos_para_log

logger = logging.getLogger(__name__)


class _Cronometro:
    """Carimbos de tempo por etapa do turno — sem isso, latência é adivinhação.

    Uso: `cron.marca("rag")` depois de cada etapa; `cron.resumo()` devolve uma
    linha legível (`total=3.42s guardas=0.61s rag=0.48s llm=1.95s ...`) que vai
    pro log no fim do turno. Etapas abaixo de 10ms são omitidas do resumo pra
    linha não virar ruído."""

    def __init__(self) -> None:
        self.t0 = time.monotonic()
        self._ultimo = self.t0
        self.etapas: list[tuple[str, float]] = []

    def marca(self, nome: str) -> None:
        agora = time.monotonic()
        self.etapas.append((nome, agora - self._ultimo))
        self._ultimo = agora

    def resumo(self) -> str:
        total = time.monotonic() - self.t0
        partes = " ".join(f"{n}={d:.2f}s" for n, d in self.etapas if d >= 0.01)
        return f"total={total:.2f}s {partes}".strip()


async def build_rag_block(db: AsyncSession, agent_id: int, query: str) -> tuple[str, list[str]]:
    """Monta o bloco de Base de Conhecimento pro system prompt.

    Extraido pra ser o PONTO UNICO de RAG: producao (send_message, abaixo) e o
    playground do painel usam esta mesma funcao. Antes o playground chamava o
    motor de LLM direto, sem RAG nenhum — entao o cliente subia um documento,
    testava, o agente nao sabia, e ele concluia que a indexacao estava quebrada.
    Testar com um caminho diferente do de producao nao e testar.

    Devolve (bloco, fontes). Nunca levanta: RAG e enriquecimento, nao requisito —
    se a busca falhar o agente responde sem ela, como sempre respondeu.
    """
    if not query or not query.strip():
        return "", []
    try:
        from sqlalchemy import text as _sa_text

        # So embeda a query se o agente TIVER conhecimento indexado (evita
        # chamada de embedding a toa em todo turno de agente sem base).
        tem_base = (
            await db.execute(
                _sa_text("SELECT 1 FROM ta_knowledge_chunk WHERE agent_id = :aid LIMIT 1"),
                {"aid": agent_id},
            )
        ).first()
        if not tem_base:
            return "", []

        from services import rag_engine

        hits = await rag_engine.search(db, agent_id=agent_id, query=query, top_k=4)
        if not hits:
            return "", []

        cabecalho = "# Base de conhecimento (responda com base nisto; não invente além)"
        corpo = "\n\n".join(f"- {h.text.strip()}" for h in hits)
        bloco = f"{cabecalho}\n{corpo}"
        fontes = []
        for h in hits:
            titulo = getattr(h, "title", None) or getattr(h, "source", None)
            if titulo and titulo not in fontes:
                fontes.append(str(titulo))
        logger.info("rag agent=%s hits=%s", agent_id, len(hits))
        return bloco, fontes
    except Exception:
        logger.exception("rag search falhou agent=%s — segue sem RAG", agent_id)
        return "", []



def build_contact_block(
    *, connector_kind: str, external_chat_id: str | None, sender_name: str | None
) -> str:
    """Bloco "Contato atual" — o agente JÁ tem nome/telefone pelo canal.

    Ponto ÚNICO: produção e playground montam o mesmo texto. Evita o agente pedir
    ao cliente dado que já temos (irrita, e cada atendente re-pergunta).
    """
    is_wa = connector_kind in ("whatsapp", "whatsapp_cloud")
    jid = external_chat_id or ""
    # LID (@lid) é um ID INTERNO do WhatsApp, NÃO o telefone real — não apresentar
    # como telefone (senão o agente cadastra com número falso e nunca acha).
    is_lid = "@lid" in jid
    phone = "" if (not is_wa or is_lid) else _re.sub(r"\D", "", jid.split("@")[0])
    out = ["# Contato atual (você JÁ tem estes dados — NÃO peça ao cliente)"]
    out.append(f"- Nome: {sender_name or '(não informado pelo WhatsApp)'}")
    if phone:
        out.append(
            f"- Telefone/WhatsApp: {phone} — este JÁ é o número do cliente. Ao buscar ou cadastrar, "
            "use este número DIRETO. NUNCA pergunte o telefone/WhatsApp."
        )
    elif is_wa:
        out.append(
            "- Telefone/WhatsApp: não veio automaticamente nesta conversa. Se for cadastrar o "
            "cliente e ele JÁ tiver dito o número aqui, USE o que ele disse — não peça de novo. "
            "Cadastre com o nome do WhatsApp + o que tiver; só peça o número UMA vez se for "
            "realmente indispensável (ex.: contato pro Taxidog) e ele nunca tiver informado."
        )
    out.append(
        "Use esses dados diretamente. NUNCA peça o nome (você já tem). Pergunte só o que "
        "realmente falta."
    )
    return "\n".join(out)


import re as _re_horario  # noqa: E402 — o `import re as _re` deste arquivo vem mais abaixo

_DIAS_CURTOS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
_DIAS_LONGOS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
_RE_HORARIO = _re_horario.compile(
    r"\[horario:\s*(seg|ter|qua|qui|sex|sab|dom)\s*-\s*(seg|ter|qua|qui|sex|sab|dom)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*\]",
    _re_horario.IGNORECASE,
)


def _pascoa(ano: int):
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)."""
    from datetime import date as _date

    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    lv = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * lv) // 451
    mes = (h + lv - 7 * m + 114) // 31
    dia = ((h + lv - 7 * m + 114) % 31) + 1
    return _date(ano, mes, dia)


def feriados_nacionais(ano: int) -> dict:
    """Feriados nacionais do Brasil {data: nome} (19/11/2026, M7).

    Lei 662/1949 + 6.802/1980 + 14.759/2023 (Consciência Negra, desde 2024) e a Sexta-feira da
    Paixão. Carnaval e Corpus Christi são ponto facultativo — não entram; feriado de estado ou
    de cidade também não."""
    from datetime import date as _date
    from datetime import timedelta as _td

    fixos = {
        (1, 1): "Confraternização Universal",
        (4, 21): "Tiradentes",
        (5, 1): "Dia do Trabalho",
        (9, 7): "Independência do Brasil",
        (10, 12): "Nossa Senhora Aparecida",
        (11, 2): "Finados",
        (11, 15): "Proclamação da República",
        (12, 25): "Natal",
    }
    if ano >= 2024:
        fixos[(11, 20)] = "Dia da Consciência Negra"
    out = {_date(ano, m, d): n for (m, d), n in fixos.items()}
    out[_pascoa(ano) - _td(days=2)] = "Sexta-feira da Paixão"
    return out


def feriado_em(d) -> str | None:
    return feriados_nacionais(d.year).get(d)


def _e_dia_util(d, uteis: list[int]) -> bool:
    return d.weekday() in uteis and not feriado_em(d)


def _proximo_dia_util(hoje, uteis: list[int]):
    from datetime import timedelta as _td

    return next(hoje + _td(days=k) for k in range(1, 40) if _e_dia_util(hoje + _td(days=k), uteis))


def _calculo_horario(texto: str, agora) -> dict | None:
    """O horário da marcação `[horario: seg-sex 08:00-17:00]` aplicado a AGORA, com feriado."""
    m = _RE_HORARIO.search(texto or "")
    if not m:
        return None
    d0, d1 = _DIAS_CURTOS.index(m.group(1).lower()), _DIAS_CURTOS.index(m.group(2).lower())
    uteis = list(range(d0, d1 + 1)) if d0 <= d1 else list(range(d0, 7)) + list(range(0, d1 + 1))
    hoje = agora.date()
    prox = _proximo_dia_util(hoje, uteis)
    return {
        "ini": int(m.group(3)) * 60 + int(m.group(4)),
        "fim": int(m.group(5)) * 60 + int(m.group(6)),
        "minuto": agora.hour * 60 + agora.minute,
        "hora_ini": f"{int(m.group(3))}h" + (f"{m.group(4)}" if m.group(4) != "00" else ""),
        "uteis": uteis,
        "util_hoje": _e_dia_util(hoje, uteis),
        "prox": prox,
        "dias_ate": (prox - hoje).days,
    }


def _horario_agora(texto: str, agora) -> tuple[str, str] | None:
    """(código, próximo atendimento) pela marcação `[horario: seg-sex 08:00-17:00]` da persona.

    Código: «dentro», «fora_dia_util» ou «fim_de_semana» (sábado, domingo e o último dia útil
    depois do expediente — o domingo à noite também). Sem a marcação, None.
    19/11/2026: feriado nacional não é dia útil — na véspera do feriado de 20/11 a IA da M7
    prometia «amanhã a partir das 8h» (a sexta era feriado). Feriado cai em «fim_de_semana»."""
    c = _calculo_horario(texto, agora)
    if not c:
        return None
    if c["util_hoje"] and c["ini"] <= c["minuto"] < c["fim"]:
        return "dentro", ""
    if c["util_hoje"] and c["minuto"] < c["ini"]:
        return "fora_dia_util", f"hoje, a partir das {c['hora_ini']}"
    nome = _DIAS_LONGOS[c["prox"].weekday()]
    if c["dias_ate"] == 1:
        quando = f"amanhã, {nome}, a partir das {c['hora_ini']}"
    elif c["dias_ate"] <= 6:
        quando = f"{nome}, a partir das {c['hora_ini']}"
    else:  # semana inteira de feriado: o dia da semana sozinho fica ambíguo
        quando = f"{nome}, {c['prox']:%d/%m}, a partir das {c['hora_ini']}"
    codigo = "fora_dia_util" if (c["util_hoje"] and c["dias_ate"] == 1) else "fim_de_semana"
    return codigo, quando


_DIA_COM_PREPOSICAO = ["na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado", "no domingo"]


def quando_retorno(texto: str, agora) -> str:
    """O que entra no lugar de `{quando}` na persona (09/11/2026, M7).

    «amanhã a partir das 8h», «na segunda a partir das 8h», «hoje a partir das 8h» (antes da
    abertura). O Marcos escreveu «te ligo {amanhã / na segunda / próximo dia útil}» e deixou a
    escolha com o modelo, que às 18:55 de segunda respondeu como se fosse horário comercial.
    Dentro do horário ou sem a marcação `[horario: …]`: "" (o `{quando}` fica como está)."""
    c = _calculo_horario(texto, agora)
    h = _horario_agora(texto, agora)
    if not c or not h or h[0] == "dentro":
        return ""
    if h[1].startswith("hoje"):
        return f"hoje a partir das {c['hora_ini']}"
    if c["dias_ate"] == 1:
        quem = "amanhã"
    elif c["dias_ate"] <= 6:
        quem = _DIA_COM_PREPOSICAO[c["prox"].weekday()]
    else:
        quem = f"{_DIA_COM_PREPOSICAO[c['prox'].weekday()]}, {c['prox']:%d/%m},"
    return f"{quem} a partir das {c['hora_ini']}"


def situacao_do_horario(texto: str, agora) -> str:
    """Bloco «Situação do horário AGORA» quando a persona declara `[horario: seg-sex 08:00-17:00]`.

    Calculado aqui porque o modelo erra a comparação de hora (09/11/2026, M7). Sem a marcação,
    devolve "" — nenhum agente muda sem pedir."""
    h = _horario_agora(texto, agora)
    if not h:
        return ""
    codigo, quando = h
    titulo = "# Situação do horário AGORA (calculada pelo sistema — use isto, não calcule)\n"
    if codigo == "dentro":
        return titulo + "- DENTRO do horário comercial.\n\n"
    if codigo == "fora_dia_util":
        tipo = "dia útil"
    elif feriado_em(agora.date()) and agora.weekday() in _calculo_horario(texto, agora)["uteis"]:
        tipo = f"feriado ({feriado_em(agora.date())})"
    elif _e_vespera_de_feriado(agora.date(), _calculo_horario(texto, agora)["uteis"]):
        tipo = "véspera de feriado"
    else:
        tipo = "fim de semana (sexta à noite até domingo)"
    return titulo + f"- FORA do horário comercial — {tipo}.\n" + f"- Próximo atendimento: {quando}.\n\n"


def _e_vespera_de_feriado(hoje, uteis: list[int]) -> bool:
    from datetime import timedelta as _td

    amanha = hoje + _td(days=1)
    return amanha.weekday() in uteis and bool(feriado_em(amanha))


def bloco_feriados(agora) -> str:
    """Feriado nacional hoje ou nos próximos 7 dias, com o próximo dia útil já calculado.

    19/11/2026 (M7): a persona manda tratar «feriado ou véspera de feriado» de outro jeito, mas o
    modelo só recebia a data — e às 18:09 da véspera do 20/11 prometeu «amanhã a partir das 8h»
    a dois clientes. Sem feriado à vista, devolve "" (o prompt de sempre)."""
    from datetime import timedelta as _td

    hoje = agora.date()
    perto = [(hoje + _td(days=k), feriado_em(hoje + _td(days=k))) for k in range(0, 8)]
    perto = [(d, n) for d, n in perto if n and d.weekday() < 5]  # feriado no fim de semana não muda nada
    if not perto:
        return ""
    linhas = ["# Feriados nacionais (calculado pelo sistema — use isto, não calcule)"]
    for d, n in perto:
        k, nome_dia = (d - hoje).days, _DIAS_LONGOS[d.weekday()]
        quando = f"Hoje ({nome_dia}, {d:%d/%m})" if k == 0 else f"Amanhã ({nome_dia}, {d:%d/%m})" if k == 1 else (
            f"{nome_dia.capitalize()}, {d:%d/%m},"
        )
        linhas.append(f"- {quando} é feriado nacional: {n}.")
    prox = _proximo_dia_util(hoje, [0, 1, 2, 3, 4])
    linhas.append(f"- Próximo dia útil (segunda a sexta, sem feriado): {_DIAS_LONGOS[prox.weekday()]}, {prox:%d/%m}.")
    return "\n".join(linhas) + "\n\n"


_RE_BLOCO_HORARIO = _re_horario.compile(
    r"\[\[(dentro|fora|fora_dia_util|fim_de_semana)\]\](.*?)\[\[/\1\]\]", _re_horario.DOTALL
)


def _bloco_fica(tag: str, codigo: str) -> bool:
    """`[[fora]]` vale para qualquer horário fora do comercial (dia útil OU fim de semana)."""
    return tag == codigo or (tag == "fora" and codigo != "dentro")


def persona_do_horario(texto: str, agora) -> str:
    """Deixa na persona SÓ o bloco do horário de agora (09/11/2026, M7).

    Com a marcação `[horario: …]` e blocos `[[dentro]]…[[/dentro]]`, `[[fora_dia_util]]…` e
    `[[fim_de_semana]]…` (e `[[fora]]…`, que vale para os dois de fora), os blocos de outro
    horário saem do prompt, e `{quando}` vira o próximo atendimento. Mesmo com a situação
    calculada, o gpt-4.1-mini escolheu o modelo errado em 4 de 6 testes: o que o modelo não vê
    ele não escolhe. Persona sem blocos passa igual."""
    if "[[" not in (texto or "") and "{quando}" not in (texto or ""):
        return texto
    h = _horario_agora(texto, agora)
    if not h:
        return texto
    codigo = h[0]
    saida = _RE_BLOCO_HORARIO.sub(lambda m: m.group(2).strip("\n") if _bloco_fica(m.group(1), codigo) else "", texto)
    quando = quando_retorno(texto, agora)
    return saida.replace("{quando}", quando) if quando else saida


_DIAS_IA = {"seg-sex", "seg-sab", "seg-dom"}
_RE_HHMM = _re_horario.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validar_ia_horario(h: dict | None) -> dict | None:
    """Normaliza o horário da IA do número; levanta ValueError com a frase para a tela.

    `None` ou modo «sempre» = a IA responde a qualquer hora (o padrão de sempre)."""
    if not h or (h.get("modo") or "sempre") == "sempre":
        return None
    modo, dias = h.get("modo"), h.get("dias") or "seg-sex"
    inicio, fim = (h.get("inicio") or "").strip(), (h.get("fim") or "").strip()
    if modo not in ("dentro", "fora"):
        raise ValueError("Modo deve ser «sempre», «dentro» ou «fora»")
    if dias not in _DIAS_IA:
        raise ValueError("Dias devem ser seg-sex, seg-sab ou seg-dom")
    if not _RE_HHMM.match(inicio) or not _RE_HHMM.match(fim):
        raise ValueError("Horário no formato HH:MM")
    if inicio >= fim:
        raise ValueError("O início tem de ser antes do fim (para a noite, use «fora do horário»)")
    return {"modo": modo, "dias": dias, "inicio": inicio, "fim": fim}


def ia_no_horario(conn, agora=None) -> bool:
    """O horário da IA deste número permite responder AGORA? (10/11/2026, M7)

    Pedido do dono: «conseguimos colocar um horário para que ele funcione?». O número guarda
    `{modo, dias, inicio, fim}`: «dentro» = a IA só responde no horário; «fora» = só fora
    dele (a equipe atende no expediente). Sem horário, sempre. Fuso de São Paulo. Fora do
    horário o número age como IA desligada: grava, abre card, não responde."""
    import json as _json_h

    bruto = getattr(conn, "ia_horario", None)
    if not bruto:
        return True
    try:
        h = validar_ia_horario(_json_h.loads(bruto) if isinstance(bruto, str) else bruto)
    except Exception:  # noqa: BLE001 — horário ilegível não pode calar o agente
        return True
    if not h:
        return True
    if agora is None:
        from datetime import datetime as _dth
        from zoneinfo import ZoneInfo as _ZIh

        agora = _dth.now(_ZIh("America/Sao_Paulo"))
    situacao = _horario_agora(f"[horario: {h['dias']} {h['inicio']}-{h['fim']}]", agora)
    dentro = bool(situacao and situacao[0] == "dentro")
    return dentro if h["modo"] == "dentro" else not dentro


def ia_responde_agora(conn, agora=None) -> bool:
    """Interruptor «IA ligada» E horário da IA do número."""
    return bool(getattr(conn, "ia_ligada", True)) and ia_no_horario(conn, agora)


def persona_efetiva(agent, agora=None) -> str:
    """A persona como ela vai para o modelo — produção e teste do painel usam esta (ponto único)."""
    if agora is None:
        from datetime import datetime as _dtp
        from zoneinfo import ZoneInfo as _ZIp

        agora = _dtp.now(_ZIp("America/Sao_Paulo"))
    return persona_do_horario(agent.persona or agent.system_prompt or "", agora)


def build_base_directives(agent, *, connector_kind: str, extra_block: str = "") -> str:
    """Data/hora + diretrizes base herdadas por TODO agente.

    Ponto ÚNICO, pelo mesmo motivo do bloco de contato. A persona TEM PRIORIDADE;
    isto só preenche lacunas. Resolve "não sei a data", loop de perguntas repetidas
    e alucinação de horário. `extra_block` entra na MESMA posição em que o runtime
    injetava os alertas do DevSecOps (antes das regras de formatação do WhatsApp).
    """
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _ZoneInfo

    DIAS = [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ]
    agora = _dt.now(_ZoneInfo("America/Sao_Paulo"))
    date_block = (
        "# Data e hora atuais (fuso de São Paulo — use SEMPRE isto como referência)\n"
        f"- Hoje é {DIAS[agora.weekday()]}, {agora.strftime('%d/%m/%Y')}, {agora.strftime('%H:%M')}.\n"
        "- Ao falar de 'hoje', 'amanhã', 'esta semana' ou dias da semana, calcule a partir desta data. "
        "NUNCA diga que não sabe a data.\n\n"
    )
    # 09/11/2026 (M7): a situação do horário vem CALCULADA, não deduzida pelo modelo. A persona da
    # M7 escolhe a 1ª mensagem por horário e o gpt-4o-mini errou 2 de 3 vezes às 18:20 de segunda.
    date_block += situacao_do_horario(agent.persona or agent.system_prompt or "", agora)
    date_block += bloco_feriados(agora)
    # Diretrizes GENÉRICAS + guidelines do TEMPLATE do agente (definidas em
    # services/templates.py — o runtime não conhece nenhum nicho).
    base = date_block + _templates.GENERIC_GUIDELINES
    # Silêncio de propósito (15/11/2026, M7): só vale quando a PERSONA manda calar.
    base += (
        "\n\n# Quando a sua persona mandar não responder\n"
        "- Se as regras da sua persona disserem para você NÃO enviar mensagem agora (ficar em "
        "silêncio, deixar para o atendimento humano), responda exatamente [SILENCIO] e nada mais. "
        "Nunca use isso por conta própria: só quando a persona mandar."
    )
    tmpl = _templates.get_template(agent.template_kind or "")
    if tmpl is not None and tmpl.guidelines:
        base = f"{base}\n\n{tmpl.guidelines}"
    if extra_block:
        base = f"{base}\n\n{extra_block}"
    if connector_kind in ("whatsapp", "whatsapp_cloud"):
        base += (
            "\n\n# Formatação no WhatsApp\n"
            "- Use SÓ a formatação nativa do WhatsApp: *negrito* (UM asterisco), _itálico_. "
            "NUNCA use markdown (**, ##, ###, ou '-' como marcador).\n"
            "- Listas: uma linha por item começando com '• ' (bullet). Nada de '-' nem '*' como marcador.\n"
            "- Emoji com parcimônia (no máximo 1 por mensagem, e nunca como marcador de lista).\n"
            "- Mensagens curtas e escaneáveis; evite blocos longos de texto."
        )
    if connector_kind in _CANAIS_COBRADOS_POR_MENSAGEM:
        # Cada mensagem entregue é cobrada (ver _baloes_do_canal). O envio já junta a
        # resposta num balão; isto evita as idas e vindas que viram mensagens a mais.
        base += (
            "\n\n# Cada mensagem é cobrada neste canal\n"
            "- Responda numa mensagem só, completa. Nada de saudação separada, nada de mensagem só "
            "para perguntar se ficou alguma dúvida, nada de despedida à parte.\n"
            "- Resolva na primeira resposta: entregue a informação inteira de uma vez (por exemplo, o "
            "preço E o que está incluído), em vez de esperar a próxima pergunta.\n"
            "- No máximo UMA pergunta por resposta, e só quando ela for necessária para avançar.\n"
            "- Termine na informação ou na pergunta. Sem frase de encerramento padrão como "
            "'Se precisar de mais informações, é só avisar'."
        )
    return base


# Filtro de segurança: remove caracteres CJK (chinês/japonês/coreano) que o
# MiniMax ocasionalmente vaza em respostas em português. 2ª camada sobre a regra
# de idioma da persona — garante que o cliente nunca veja caractere oriental.
import re as _re

# Observabilidade: grava o system prompt / memory / RAG no log da resposta do assistant
# (debug "ver o que foi enviado ao LLM"). Desligar com TA_LOG_PROMPTS=0.
_LOG_PROMPTS = os.getenv("TA_LOG_PROMPTS", "1") != "0"

_CJK_RE = _re.compile(
    r"[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿"
    r"豈-﫿＀-￯가-힯\U00020000-\U0003FFFF]"
)


# Emoji de bandeira = "regional indicators" (U+1F1E6–U+1F1FF) que o MiniMax às vezes
# injeta aleatoriamente (ex: as bandeiras depois de "Perfeito!"). Nunca intencionais
# no atendimento → remove antes do envio.
_FLAG_RE = _re.compile(r"[\U0001F1E6-\U0001F1FF]")


def _sanitize_reply(text: str | None) -> str:
    """Remove CJK vazado + emoji de bandeira aleatório e limpa espaços/pontuação."""
    if not text:
        return text or ""
    if not _CJK_RE.search(text) and not _FLAG_RE.search(text):
        return text
    cleaned = _CJK_RE.sub("", text)
    cleaned = _FLAG_RE.sub("", cleaned)
    cleaned = _re.sub(r"[ \t]{2,}", " ", cleaned)  # espaços duplos
    cleaned = _re.sub(r"\s+([.,!?;:])", r"\1", cleaned)  # espaço antes de pontuação
    logger.warning("resposta tinha CJK/bandeira vazado — caracteres removidos antes do envio")
    return cleaned.strip()


def _format_for_whatsapp(text: str) -> str:
    """Normaliza markdown que o modelo às vezes gera para a formatação NATIVA do
    WhatsApp. Markdown cru (`**negrito**`, `## título`, `- item`) aparece LITERAL no
    WhatsApp, e um `**` ou asterisco solto quebra o negrito da mensagem inteira."""
    if not text:
        return text or ""
    t = text
    # Cabeçalhos markdown (#, ##, ...) → *negrito*
    t = _re.sub(r"(?m)^[ \t]{0,3}#{1,6}[ \t]*(.+?)[ \t]*$", r"*\1*", t)
    # Negrito markdown **x** / ***x*** / __x__ → *x* (WhatsApp usa UM asterisco)
    t = _re.sub(r"\*\*+(.+?)\*\*+", r"*\1*", t)
    t = _re.sub(r"__(.+?)__", r"*\1*", t)
    # Marcadores de lista no início da linha (-, *, ·, •, –) → "• " (limpa espaço à esquerda)
    t = _re.sub(r"(?m)^[ \t]*[-*·•–][ \t]+", "• ", t)
    # Limpa espaço à direita e colapsa 3+ quebras de linha em 2
    t = _re.sub(r"[ \t]+\n", "\n", t)
    t = _re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _sem_travessao(text: str) -> str:
    """Travessão no meio da frase denuncia texto de máquina (pedido do dono do
    CCDA, 18/08 — higiene geral de linguagem). Em/en dash viram vírgula, e
    somem quando abrem linha (marcador de lista). HÍFEN comum não é tocado:
    telefone 4043-0461, CNPJ e datas ficam intactos."""
    if not text or ("—" not in text and "–" not in text):
        return text
    # 15/11/2026 — traço ENTRE NÚMEROS é telefone/intervalo, não travessão de frase: vira hífen. As instruções do
    # CCDA escrevem «(11) 4043–0461» com traço longo de propósito (com hífen comum o filtro de dados pessoais
    # troca o número por {TELEFONE_1} antes do modelo) — e a regra abaixo transformava em «4043, 0461».
    text = _re.sub(r"(?<=\d)[ \t]*[—–][ \t]*(?=\d)", "-", text)
    if "—" not in text and "–" not in text:
        return text
    text = _re.sub(r"(?m)^[ \t]*[—–][ \t]*", "", text)
    text = _re.sub(r"[ \t]*[—–][ \t]*", ", ", text)
    text = _re.sub(r",[ \t]*,", ", ", text)
    text = _re.sub(r"([.!?:;])[ \t]*,[ \t]+", r"\1 ", text)
    return text


def _split_into_bubbles(text: str, max_len: int = 700) -> list[str]:
    """Divide resposta longa em até 4 balões (mais humano no WhatsApp).

    Quebra em parágrafos (\\n\\n), mantém listas/blocos inteiros, agrupa blocos
    pequenos. Resposta curta SEM parágrafos → 1 balão (sem split)."""
    text = (text or "").strip()
    if not text:
        return []
    # Rajada à brasileira (18/08): parágrafo separado pelo agente vira balão
    # próprio MESMO em resposta curta — mensagem, enter, outra mensagem.
    # Sem linha em branco, resposta curta segue inteira como sempre.
    if len(text) <= max_len and "\n\n" not in text:
        return [text]
    if len(text) <= max_len:
        # Cada parágrafo vira um balão ("Oi, Marcos!" sozinho é EXATAMENTE o
        # padrão brasileiro) — quem decide o fatiamento é a persona; aqui só
        # respeitamos, com teto de 4 pra nunca virar metralhadora.
        curtos = [b.strip() for b in text.split("\n\n") if b.strip()]
        return curtos[:4] if len(curtos) > 1 else [text]
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    bubbles: list[str] = []
    cur = ""
    for b in blocks:
        if len(b) > max_len:  # bloco grande (ex: lista de planos) → balão próprio
            if cur:
                bubbles.append(cur)
                cur = ""
            bubbles.append(b)
            continue
        if cur and len(cur) + 2 + len(b) > max_len:
            bubbles.append(cur)
            cur = b
        else:
            cur = (cur + "\n\n" + b) if cur else b
    if cur:
        bubbles.append(cur)
    return bubbles[:4]


# Canais em que CADA balão é uma mensagem cobrada pela Meta. Desde 1º/out/2026 a
# resposta livre (mensagem de serviço) no WhatsApp oficial custa R$ 0,0350 por
# mensagem entregue, fora a franquia de 1.000/mês por número — e a rajada acima
# fazia uma resposta custar até 4. Nesses canais a resposta vai num balão só; os
# parágrafos continuam separados por linha em branco DENTRO dele. O WhatsApp
# não-oficial (`whatsapp`, Baileys) não paga a Meta e segue com a rajada de 18/08.
_CANAIS_COBRADOS_POR_MENSAGEM = {"whatsapp_cloud"}
# Teto do texto na Cloud API é 4.096 caracteres; folga para a formatação.
_LIMITE_TEXTO_CLOUD = 4000


def _baloes_do_canal(text: str, connector_kind: str) -> list[str]:
    """Balões que o canal vai receber. Nos canais cobrados por mensagem, um só —
    e só passa disso se o texto estourar o limite da API, cortando por parágrafo."""
    if connector_kind not in _CANAIS_COBRADOS_POR_MENSAGEM:
        return _split_into_bubbles(text)
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= _LIMITE_TEXTO_CLOUD:
        return [text]
    partes: list[str] = []
    cur = ""
    for b in [p.strip() for p in text.split("\n\n") if p.strip()]:
        while len(b) > _LIMITE_TEXTO_CLOUD:  # parágrafo maior que o limite: corte seco
            if cur:
                partes.append(cur)
                cur = ""
            partes.append(b[:_LIMITE_TEXTO_CLOUD])
            b = b[_LIMITE_TEXTO_CLOUD:]
        if cur and len(cur) + 2 + len(b) > _LIMITE_TEXTO_CLOUD:
            partes.append(cur)
            cur = b
        else:
            cur = f"{cur}\n\n{b}" if cur else b
    if cur:
        partes.append(cur)
    return partes


async def resolve_connector_by_instance(
    db: AsyncSession, kind: str, instance_id: str
) -> TaConnector | None:
    """Procura TaConnector cujo config_json_enc contenha instance_id (heurística por canal)."""
    result = await db.execute(
        select(TaConnector).where(TaConnector.kind == kind, TaConnector.enabled.is_(True))
    )
    for conn in result.scalars().all():
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:
            continue
        # WhatsApp: match instance_id direto
        if kind == "whatsapp" and cfg.get("instance_id") == instance_id:
            return conn
        # WhatsApp Cloud API (oficial): instance_id = phone_number_id
        if kind == "whatsapp_cloud" and str(cfg.get("phone_number_id") or "") == instance_id:
            return conn
        # Telegram: instance_id = bot_id (extraído do bot_token "1234567:ABCdef...")
        if kind == "telegram":
            token = cfg.get("bot_token") or ""
            bot_id = token.split(":")[0] if ":" in token else ""
            if bot_id and bot_id == instance_id:
                return conn
        # Email: instance_id = connector.id direto (webhook usa /email/{connector_id})
        if kind == "email":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Slack: instance_id = connector.id direto (webhook usa /slack/{connector_id})
        if kind == "slack":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Discord: instance_id = connector.id direto (Gateway worker usa conn.id)
        if kind == "discord":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Instagram: instance_id = ig_user_id (instagram business account id)
        if kind == "instagram":
            if str(cfg.get("ig_user_id") or "") == instance_id:
                return conn
        # Webchat (link público / demonstração): instance_id = slug do link
        if kind == "webchat":
            if str(cfg.get("slug") or "") == instance_id:
                return conn
        # Default fallback (compat)
        if cfg.get("instance_id") == instance_id:
            return conn
    return None


async def _atribuir_pelo_numero(db: AsyncSession, conv: TaConversation, connector_id: int | None) -> None:
    """Etapa 2 do caminho A (09/09/2026): o número tem dona (`ta_connector.member_id`)?
    Então a conversa que entra por ele é dela — atribuída na hora, sem fila. Só preenche
    quando ainda não há atendente (não rouba conversa já atribuída). Vale para todo
    canal que passa por `ensure_conversation` — um ponto só."""
    if not connector_id or conv.assigned_member_id:
        return
    conn = await db.get(TaConnector, connector_id)
    member_id = getattr(conn, "member_id", None) if conn else None
    if not member_id:
        return
    from models import TaMember

    m = await db.get(TaMember, member_id)
    if not m or m.status == "disabled":
        return
    conv.assigned_member_id = m.id
    conv.assigned_to = m.nome


# 🚨 11/11/2026 — conversa ASSUMIDA continua sendo a conversa do contato.
# «Assumir (pausar IA)» grava `status = "handed_off"`, e a busca de `ensure_conversation` só achava
# conversa `active`. Medido: o cliente escreveu de novo, a conversa assumida (26) não foi achada,
# nasceu a 28 ativa e a IA respondeu 36 vezes por cima do atendente — o guarda `handed_off` de
# `handle_inbound_message` nunca disparava. Agora a assumida é achada enquanto teve mensagem nos
# últimos 7 dias: a MESMA janela que o follow-up usa para calar o bot (`_sem_atendimento_humano` em
# scheduler.py, caso CCDA 210 × 212). Assumida e parada há mais que isso → abre conversa nova e a
# IA volta a atender.
JANELA_CONVERSA_ASSUMIDA = timedelta(days=7)


def _filtros_em_curso(agent_id: int, connector_kind: str, external_id: str, connector_id: int | None) -> list:
    """Conversa EM CURSO deste contato — a mesma regra para quem abre (`ensure_conversation`) e
    para quem só procura (`conversa_em_curso`). `connector_id` só nos números em registro."""
    filtros = [
        TaConversation.agent_id == agent_id,
        TaConversation.connector_kind == connector_kind,
        TaConversation.external_id == external_id,
        or_(
            TaConversation.status == "active",
            and_(
                TaConversation.status == "handed_off",
                TaConversation.last_message_at >= datetime.utcnow() - JANELA_CONVERSA_ASSUMIDA,
            ),
        ),
    ]
    if connector_id:
        filtros.append(TaConversation.connector_id == connector_id)
    return filtros


async def conversa_em_curso(
    db: AsyncSession, *, agent_id: int, connector_kind: str, external_id: str
) -> TaConversation | None:
    """Acha a conversa em curso SEM abrir uma nova."""
    return (
        (
            await db.execute(
                select(TaConversation)
                .where(*_filtros_em_curso(agent_id, connector_kind, external_id, None))
                .order_by(TaConversation.id.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )


async def ensure_conversation(
    db: AsyncSession,
    agent_id: int,
    connector_kind: str,
    external_id: str,
    contact_name: str | None = None,
    connector_id: int | None = None,
    por_numero: bool = False,
) -> TaConversation:
    """Acha a conversa EM CURSO deste contato (ou abre uma).

    Em curso = `active`, ou `handed_off` com mensagem dentro de `JANELA_CONVERSA_ASSUMIDA`
    (11/11/2026): a assumida volta como está, e quem chama decide — `handle_inbound_message`
    vê o `handed_off` e cala a IA.

    `por_numero=True` (números em registro, 07/10/2026): a conversa é de UM número.
    Todos os números das consultoras ficam sob o mesmo agente-sistema; procurar só
    por (agente, contato) juntava numa conversa só a família que falou com a Débora
    e com a Karolaine — ficava com a primeira dona e as métricas por número mentiam.
    """
    filtros = _filtros_em_curso(agent_id, connector_kind, external_id, connector_id if por_numero else None)
    # 31/10/2026 — trava por CONTATO antes de procurar/criar. Duas mensagens do mesmo cliente
    # chegando juntas («oi» + «tudo bem?», comum no WhatsApp) rodavam em paralelo, nenhuma achava
    # a conversa e as duas criavam: na simulação da conta fictícia, 900 mensagens deram 226
    # conversas onde eram 224 — histórico do cliente partido em dois. A trava vale até o commit
    # deste bloco (os dois ramos abaixo terminam em commit). Só no Postgres (os testes de unidade
    # usam bancos de mentira).
    try:
        _dialeto = db.get_bind().dialect.name
    except Exception:  # noqa: BLE001
        _dialeto = ""
    if _dialeto == "postgresql":
        await db.execute(
            sa_text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"conv:{agent_id}:{connector_id if por_numero else ''}:{connector_kind}:{external_id}"},
        )
    result = await db.execute(
        select(TaConversation)
        .where(*filtros)
        # .first() (não scalar_one_or_none): tolera conversas ativas duplicadas antigas
        # (de antes da trava acima) sem quebrar o atendimento.
        .order_by(TaConversation.id.desc())
        .limit(1)
    )
    conv = result.scalars().first()
    if conv:
        conv.last_message_at = datetime.utcnow()
        conv.msg_count += 1
        if conv.snoozed_until is not None:
            conv.snoozed_until = None  # cliente voltou — tira do snooze
        if connector_id and not getattr(conv, "connector_id", None):
            conv.connector_id = connector_id  # conversa antiga aprende de qual número é
        # 29/10/2026 (M7): o nome só entrava quando a conversa NASCIA. A vendedora escreve primeiro pelo
        # celular → a conversa nasce sem nome, e a resposta do cliente (que traz o nome do perfil) não
        # preenchia depois: 108 das 109 conversas sem nome da M7 eram assim. Só preenche o VAZIO —
        # nome já gravado (ou trocado à mão no painel) não é sobrescrito.
        if contact_name and not (conv.contact_name or "").strip():
            conv.contact_name = contact_name
        await _atribuir_pelo_numero(db, conv, connector_id)
        await db.commit()
        return conv

    conv = TaConversation(
        agent_id=agent_id,
        connector_kind=connector_kind,
        external_id=external_id,
        contact_name=contact_name,
        msg_count=1,
        connector_id=connector_id,
    )
    await _atribuir_pelo_numero(db, conv, connector_id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


async def log_message(
    db: AsyncSession,
    *,
    conversation_id: int,
    tenant_id: int,
    role: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: int = 0,
    latency_ms: int = 0,
    model_used: str | None = None,
    content: str | None = None,
    tool_calls_json: list | None = None,
    brakes_fired: list | None = None,
    attachments_json: list | None = None,
    system_prompt_sent: str | None = None,
    memory_block: str | None = None,
    rag_block: str | None = None,
    member_id: int | None = None,
) -> int | None:
    from services import wa_chave

    chave = wa_chave.consumir(role)  # a chave do WhatsApp, quando o webhook a deixou (reação)
    log = TaMessageLog(
        conversation_id=conversation_id,
        role=role,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_cents=cost_cents,
        latency_ms=latency_ms,
        model_used=model_used,
        content=(content or "")[:8000] or None,
        tool_calls_json=tool_calls_json or None,
        brakes_fired=brakes_fired or None,
        attachments_json=attachments_json or None,
        system_prompt_sent=(system_prompt_sent or None),
        memory_block=(memory_block or None),
        rag_block=(rag_block or None),
        member_id=member_id,
        wa_message_id=(chave or {}).get("id"),
        wa_remote_jid=(chave or {}).get("remote_jid"),
        wa_from_me=bool(chave.get("from_me")) if chave else None,
    )
    db.add(log)
    # 16/11/2026 — o id volta para quem chamou: a rajada (services/rajada.py) compara «a minha mensagem»
    # com a última do cliente para saber se chegou outra depois.
    await db.flush()
    log_id = log.id

    # Atualiza usage daily (upsert)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    result = await db.execute(
        select(TaUsageDaily)
        .where(TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day == today)
        .order_by(TaUsageDaily.id.desc())
        .limit(1)
    )
    usage = result.scalars().first()  # .first() tolera linhas duplicadas sem quebrar
    if usage:
        usage.messages += 1
        usage.tokens_in += tokens_in
        usage.tokens_out += tokens_out
        usage.cost_cents += cost_cents
    else:
        db.add(
            TaUsageDaily(
                tenant_id=tenant_id,
                day=today,
                messages=1,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_cents=cost_cents,
            )
        )
    await db.commit()
    return log_id


async def load_history(db: AsyncSession, conversation_id: int, limit: int = 80) -> list[dict]:
    """Carrega os últimos turnos (user/assistant) da conversa pra dar MEMÓRIA ao
    modelo. Sem isso o agente trata cada mensagem isolada e "esquece" o cliente
    (responde "nao" com saudação genérica). Exclui a mensagem atual do usuário
    (já gravada antes de chamar o engine) — ela vai separada como user_content.

    11/11/2026 — o modelo enviado pelo DISPARO do ERP (`role="agent"`, `model_used` começando por
    `disparo_oficial.MARCA_DISPARO`) entra como fala nossa (`assistant`): sem isso o lead
    respondia «Falar conosco» e a IA não sabia a que mensagem. Mensagem humana comum continua fora.

    11/11/2026 (noite) — o modelo enviado pela equipe em «Nova conversa com modelo»
    (`iniciar-conversa`, marca `MARCA_MODELO`) também entra. Só o do disparo entrava: no CCDA o
    `visita_perdida_reagendar` saiu por ali, a família respondeu «Ótimo.» e a IA, sem ver o
    modelo, abriu com a apresentação e perguntou o ano (conversa 1338).
    """
    from services.disparo_oficial import MARCA_DISPARO, MARCA_MODELO

    rows = (
        await db.execute(
            select(TaMessageLog)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                or_(
                    TaMessageLog.role.in_(["user", "assistant"]),
                    and_(
                        TaMessageLog.role == "agent",
                        or_(
                            TaMessageLog.model_used.like(f"{MARCA_DISPARO}%"),
                            TaMessageLog.model_used.like(f"{MARCA_MODELO}%"),
                        ),
                    ),
                ),
                TaMessageLog.content.isnot(None),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(limit + 1)
        )
    ).scalars().all()
    rows = list(reversed(rows))  # ordem cronológica
    if rows:
        rows = rows[:-1]  # remove o turno atual (acabou de ser logado)
    return [{"role": "assistant" if r.role == "agent" else r.role, "content": r.content} for r in rows]


async def _log_deterministic_turn(db, agent, connector_kind, external_id, contact_name, user_text, reply):
    """Loga (user + assistant) de um turno DETERMINÍSTICO (ops-command/guard) no inbox.

    Esses caminhos respondem sem LLM e retornam cedo; sem isto, a interação fica invisível
    nas conversas do painel (foi o motivo de `/ajuda`, `Infra` etc. não aparecerem). Logar
    aqui também deixa a resposta legível no painel mesmo quando o WhatsApp não consegue
    descriptografar (sessão Baileys quebrada).

    🚨 Usa uma SESSÃO PRÓPRIA (`SessionLocal`), nunca o `db` do caller. A telemetria de ops
    pode deixar `db` com transação abortada; um `db.rollback()` aqui recuperava a sessão MAS
    expirava TODOS os ORMs do caller (`agent` E `connector`) — e logo depois o caller acessa
    `connector.config_json_enc` (enviar resposta) e `agent.id` (return). Em AsyncSession, ler
    atributo expirado dispara IO implícito proibido → `MissingGreenlet` → o caminho de ops
    estourava e caía no LLM ("fica só pensando", sem menu). Sessão isolada não toca no caller."""
    # Captura escalares do ORM em memória (ainda carregado — caller não deu rollback).
    agent_id = agent.id
    tenant_id = agent.tenant_id
    try:
        from core.db import SessionLocal

        async with SessionLocal() as s:
            conv = await ensure_conversation(
                s, agent_id=agent_id, connector_kind=connector_kind,
                external_id=external_id, contact_name=contact_name,
            )
            await log_message(s, conversation_id=conv.id, tenant_id=tenant_id, role="user", content=user_text)
            await log_message(s, conversation_id=conv.id, tenant_id=tenant_id, role="assistant", content=reply)
            await s.commit()
    except Exception:
        logger.exception("log de turno determinístico falhou agent=%s", agent_id)


async def juntar_conversa_do_codigo_oculto(db: AsyncSession, conv: TaConversation, jid_cru: str | None) -> int:
    """Junta na conversa do TELEFONE a conversa aberta pelo código oculto do mesmo cliente (29/10/2026).

    A vendedora escreve primeiro pelo celular e o WhatsApp manda o chat como `<código>@lid`, sem o telefone:
    a conversa nasce com esse código (na tela, um número sem sentido). A resposta do cliente vem com o
    telefone (`resolvedPhoneJid`) e abria OUTRA conversa — no celular é uma só, aqui eram duas. Medido em
    29/10: 53 na M7, 155 no CCDA, todas só com mensagens da vendedora. Esta resposta traz os dois (o
    código em `key.remoteJid`), então é aqui que se junta. Devolve quantas foram juntadas."""
    lid = (jid_cru or "").strip()
    if not lid.endswith("@lid") or lid == conv.external_id or not getattr(conv, "connector_id", None):
        return 0
    fantasmas = (
        await db.execute(
            select(TaConversation).where(
                TaConversation.agent_id == conv.agent_id,
                TaConversation.connector_id == conv.connector_id,
                TaConversation.external_id == lid,
                TaConversation.id != conv.id,
            )
        )
    ).scalars().all()
    if not fantasmas:
        return 0
    from sqlalchemy import update as _update

    from models import TaNotification, TaPlaybookExecution

    for f in fantasmas:
        for modelo in (TaMessageLog, TaNotification, TaPlaybookExecution):
            await db.execute(_update(modelo).where(modelo.conversation_id == f.id).values(conversation_id=conv.id))
        conv.msg_count = (conv.msg_count or 0) + (f.msg_count or 0)
        if f.started_at and (not conv.started_at or f.started_at < conv.started_at):
            conv.started_at = f.started_at
        if not (conv.contact_name or "").strip() and (f.contact_name or "").strip():
            conv.contact_name = f.contact_name
        if not conv.crm_opportunity_id and f.crm_opportunity_id:
            conv.crm_opportunity_id = f.crm_opportunity_id
        if not conv.assigned_member_id and f.assigned_member_id:
            conv.assigned_member_id = f.assigned_member_id
        await db.delete(f)
    await db.commit()
    logger.info("conversa do código oculto %s juntada na %s (%d)", lid, conv.id, len(fantasmas))
    return len(fantasmas)


async def registrar_mensagem_sem_ia(
    db: AsyncSession,
    connector: TaConnector,
    *,
    connector_kind: str,
    external_chat_id: str,
    sender_name: str | None,
    text_content: str,
    attachments: list | None,
    role: str,
) -> dict:
    """Etapa 1 do caminho A (09/09/2026) — número em modo registro.

    `role="user"` = a família escreveu; `role="agent"` = a consultora respondeu
    pelo celular (evento `fromMe` do Engine). Nada é respondido: o registro
    existe para o inbox e para as métricas (atendimento, abordagem, 1ª resposta).
    """
    agent = await db.get(TaAgent, connector.agent_id)
    if not agent:
        return {"status": "no_agent", "connector_id": connector.id}

    # 🚨 Eco do PAINEL (07/10/2026). Resposta dada pelo inbox sai pelo número e o
    # Baileys a devolve como `fromMe` — que aqui é gravado. O painel já gravou a
    # mensagem (com quem respondeu) e pré-carimba o id do envio para o webhook
    # descartar o eco; esta é a segunda trava, por conteúdo, para quando o
    # carimbo não existir. Janela curta: a mesma frase dita de novo pelo celular
    # minutos depois é outra mensagem e entra.
    if role == "agent" and (text_content or "").strip():
        from datetime import timedelta as _td

        from services.assinatura import tirar_assinatura

        # O painel grava SEM o «*Nome:*» que a família vê (ver services/assinatura.py).
        _iguais = {text_content[:8000], tirar_assinatura(text_content)[:8000]}
        ja = (
            await db.execute(
                select(TaMessageLog.id)
                .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
                .where(
                    TaConversation.connector_id == connector.id,
                    TaConversation.external_id == external_chat_id,
                    TaMessageLog.role == "agent",
                    TaMessageLog.content.in_(_iguais),
                    TaMessageLog.created_at >= datetime.utcnow() - _td(minutes=2),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if ja:
            return {"status": "eco_do_painel", "message_id": ja, "connector_id": connector.id}

    conv = await ensure_conversation(
        db,
        agent_id=agent.id,
        connector_kind=connector_kind,
        external_id=external_chat_id,
        contact_name=sender_name if role == "user" else None,
        connector_id=connector.id,
        por_numero=True,
    )
    if role == "user":
        from services import wa_chave as _wa_chave

        await juntar_conversa_do_codigo_oculto(db, conv, _wa_chave.remote_jid_atual())
    _att = anexos_para_log(attachments)
    await log_message(
        db, conversation_id=conv.id, tenant_id=agent.tenant_id, role=role, tokens_in=0,
        content=text_content, attachments_json=_att or None,
        # a consultora falou pelo celular: a mensagem é da dona do número
        member_id=(getattr(connector, "member_id", None) if role == "agent" else None),
    )
    try:
        connector.last_event_at = datetime.utcnow()
        await db.commit()
    except Exception:  # noqa: BLE001 — carimbo é luxo
        await db.rollback()
    return {"status": "registro", "agent_id": agent.id, "conversation_id": conv.id, "role": role}


async def registrar_fala_do_celular(
    db: AsyncSession,
    connector: TaConnector,
    *,
    instance_id: str | None,
    external_chat_id: str,
    text_content: str,
    attachments: list | None,
    enviada_em: datetime | None = None,
) -> dict:
    """`fromMe` num número com IA (18/11/2026): a equipe escreveu pelo celular do número.

    🚨 Antes era tudo descartado como «eco da IA» e a conversa no Agent ficava só com o lado do
    cliente — na M7, a Isa responde pelo WhatsApp do número principal e 47 mensagens dela em 7 dias
    não existiam no Agent (card 30963: a Marisa respondendo «Sim, estou precisando muito» a uma
    pergunta que no Agent não aparecia).

    - Eco do que o sistema mandou (IA, painel, disparo): o adaptador anotou o envio, o eco consome
      a anotação e nada é gravado (`services/eco_envio.py`).
    - Só entra em conversa que JÁ existe. Sem conversa, a fala fica guardada e entra quando o outro
      lado responder (`absorver_fala_pendente`) — abrir na hora poria no Atendimento toda pessoa a
      quem alguém escreveu pelo celular.
    - Grava como `agent` com a dona do número: o callback já lê `agent` como «a equipe respondeu».
    """
    from services import eco_envio

    eco = await eco_envio.consumir(instance_id, text_content)
    if eco:
        return {"status": "eco_do_envio"}
    conv = await conversa_em_curso(
        db, agent_id=connector.agent_id, connector_kind="whatsapp", external_id=external_chat_id
    )
    if conv is None:
        # 23/11/2026 (M7): a equipe escreveu primeiro. Não abre conversa; guarda a fala para quando o
        # outro lado responder (services/fala_pendente.py). Com o Redis fora não dá para saber se era
        # eco, e não há onde guardar.
        if eco is None:
            return {"status": "sem_conversa"}
        from datetime import timedelta as _td_guarda

        from services import fala_pendente, wa_chave

        quando = enviada_em or datetime.utcnow()
        if datetime.utcnow() - quando > _td_guarda(seconds=fala_pendente.TTL_SEGUNDOS):
            return {"status": "sem_conversa"}  # histórico antigo que o WhatsApp reenvia ao reparear
        _chave = wa_chave.consumir("agent") or {}
        guardou = await fala_pendente.guardar(
            connector.id,
            [external_chat_id, _chave.get("remote_jid")],
            {
                "id": _chave.get("id"),
                "remote_jid": _chave.get("remote_jid"),
                "texto": (text_content or "")[:8000],
                "anexos": anexos_para_log(attachments) or None,
                "em": quando.isoformat(),
            },
        )
        return {"status": "guardada" if guardou else "sem_conversa"}
    if eco is None:
        # Redis fora: sem anotação para consumir. Segunda trava, por conteúdo — a fala da IA é
        # gravada inteira e sai em balões, então o eco é um PEDAÇO dela; a do painel vai com a
        # assinatura «*Nome:*», que a gravação não tem.
        from datetime import timedelta as _td

        from services.assinatura import tirar_assinatura

        alvo = eco_envio.normalizar(tirar_assinatura(text_content or ""))
        recentes = (
            await db.execute(
                select(TaMessageLog.content).where(
                    TaMessageLog.conversation_id == conv.id,
                    TaMessageLog.role.in_(("agent", "assistant")),
                    TaMessageLog.created_at >= datetime.utcnow() - _td(minutes=10),
                )
            )
        ).scalars().all()
        if alvo and any(alvo in eco_envio.normalizar(c) for c in recentes):
            return {"status": "eco_por_conteudo"}
    agent = await db.get(TaAgent, connector.agent_id)
    if not agent:
        return {"status": "no_agent"}
    _att = anexos_para_log(attachments)
    await log_message(
        db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="agent", tokens_in=0,
        content=text_content, attachments_json=_att or None,
        member_id=getattr(connector, "member_id", None),
    )
    # 23/11/2026 (M7, conversas 2159 e 2155): pausa a IA, como a resposta pelo painel já faz
    # (`routes/conversations._gravar_resposta`). `load_history` deixa a fala humana comum de fora de
    # propósito — contava com esta pausa —, então sem ela a regra da persona «já houver mensagem de
    # uma pessoa da M7» não tinha como ser cumprida: o modelo não via a Camilla e abriu de novo.
    # Só o status: de quem é a conversa (quem vê) não muda aqui.
    conv.status = "handed_off"
    conv.last_message_at = datetime.utcnow()
    conv.msg_count = (conv.msg_count or 0) + 1
    await db.commit()
    return {"status": "gravada", "conversation_id": conv.id}


async def absorver_fala_pendente(
    db: AsyncSession, connector: TaConnector, conv: TaConversation, *, connector_kind: str, jids: list[str | None]
) -> bool:
    """O cliente respondeu a quem falou primeiro pelo celular: põe essas falas na conversa, na ordem e
    na hora em que saíram, e pausa a IA (23/11/2026, M7 — conversas 2159 e 2161).

    Chamar ANTES de gravar a mensagem do cliente, para a fala da equipe ficar acima dela. Devolve True
    só para quem gravou — é quem espelha o card no CRM, já que a conversa pausada sai cedo.

    As mensagens do cliente chegam juntas e rodam em paralelo («ainda não» + «bom dia» + …): a chave só
    sai do Redis DEPOIS do commit. Quem ainda a vê espera a trava e não duplica (pelo id do WhatsApp);
    quem já não a vê relê o status, que naquele ponto está gravado."""
    if connector_kind != "whatsapp" or (getattr(connector, "modo", None) or "agente") != "agente":
        return False
    from services import fala_pendente

    gravou = False
    if await fala_pendente.ha(connector.id, jids):
        try:
            gravou = await _gravar_falas_pendentes(
                connector.id, getattr(connector, "member_id", None), conv.id, jids
            )
        except Exception:  # noqa: BLE001 — a mensagem do cliente tem de entrar de qualquer jeito
            logger.exception("falas do celular anteriores à conversa não entraram conv=%s", conv.id)
    await db.refresh(conv, ["status", "msg_count"])
    return gravou


async def _gravar_falas_pendentes(
    connector_id: int, member_id: int | None, conversation_id: int, jids: list[str | None]
) -> bool:
    """Sessão PRÓPRIA: um `rollback` na de quem chama expiraria o agente e o conector que ele ainda vai
    usar, e a mensagem do cliente se perderia por causa de uma fala antiga."""
    from sqlalchemy import update

    from core.db import db_context
    from services import fala_pendente

    async with db_context() as s:
        if s.get_bind().dialect.name == "postgresql":
            await s.execute(
                sa_text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"fala_celular:{conversation_id}"}
            )
        falas, lidas = await fala_pendente.ler(connector_id, jids)
        if not falas:
            return False
        ja = set(
            (
                await s.execute(
                    select(TaMessageLog.wa_message_id).where(
                        TaMessageLog.conversation_id == conversation_id,
                        TaMessageLog.wa_message_id.in_([f["id"] for f in falas]),
                    )
                )
            )
            .scalars()
            .all()
        )
        novas = [f for f in falas if f["id"] not in ja]
        for f in novas:
            s.add(
                TaMessageLog(
                    conversation_id=conversation_id, role="agent", content=(f.get("texto") or "")[:8000] or None,
                    attachments_json=f.get("anexos") or None, member_id=member_id,
                    wa_message_id=f["id"], wa_remote_jid=f.get("remote_jid"), wa_from_me=True,
                    created_at=datetime.fromisoformat(f["em"]),
                )
            )
            await s.flush()  # um a um: a tela ordena pelo id
        if novas:
            await s.execute(
                update(TaConversation)
                .where(TaConversation.id == conversation_id)
                .values(status="handed_off", msg_count=TaConversation.msg_count + len(novas))
            )
        await s.commit()
    await fala_pendente.apagar(lidas)
    if novas:
        logger.info("conv=%s %s fala(s) do celular anteriores à conversa — IA pausada", conversation_id, len(novas))
    return bool(novas)


async def _espelhar_no_crm(
    db: AsyncSession,
    *,
    agent: TaAgent,
    conv: TaConversation,
    connector,
    connector_kind: str,
    external_chat_id: str,
    sender_name: str | None,
    text_content: str,
    origem_canal: dict | None,
    agente_respondeu: bool,
) -> None:
    """Auto-CRM: espelha TODA conversa nova como card no CRM do ERP.

    Captura de lead automática: não exige intenção de compra. Gated por
    TIER_ERP_AUTO_CRM. Best-effort: nunca derruba o atendimento.

    🚨 Roda também quando o agente NÃO responde (modelo fora do ar, envio recusado,
    pedido de humano). O card é do cliente que chegou, não da resposta: com a chamada
    só depois do envio, modelo fora do ar significava lead que nunca entrou no CRM.
    `agente_respondeu` diz ao ERP se o card pode sair da entrada do funil.

    Idempotência AO VIVO (padrão de mercado): NÃO gateia por crm_opportunity_id
    cacheado (fica stale se o card for apagado). Chama sempre — o ERP dedup pela
    coluna indexada conversa_externa_id em card ATIVO. Apagou o card + mandou msg
    → o ERP não acha nenhum ativo → recria. Sem sincronizar delete, sem stale.
    """
    try:
        from core.config import get_settings

        if not get_settings().tier_erp_auto_crm:
            return
        from services import erp_crm_client
        from services.origem_whatsapp import sem_invisiveis

        if not erp_crm_client.integracao_ativa():
            return
        # Colega da própria conta não é lead (só confere antes do 1º card: o caminho normal não paga).
        if conv.crm_opportunity_id is None:
            from services import numeros as _numeros

            if await _numeros.eh_numero_da_casa(db, agent.tenant_id, external_chat_id, connector_kind):
                logger.info("auto-CRM: conv=%s é de um número da própria conta, sem card", conv.id)
                return
        import re as _re_crm

        # Foto: busca só quando ainda NÃO temos link (1ª vez / recriação). Nas msgs
        # seguintes o call é só o dedup barato (sem HTTP ao Engine). Se o card foi
        # apagado e recriado, o cliente mantém a foto (delete não apaga o cliente).
        # Só Baileys ('whatsapp'); Cloud API não expõe foto de contato.
        _foto = None
        if conv.crm_opportunity_id is None and connector_kind == "whatsapp" and connector is not None:
            try:
                import httpx as _httpx_pic
                from urllib.parse import quote as _quote_pic

                _cfg = json.loads(decrypt(connector.config_json_enc))
                _iid = _cfg.get("instance_id")
                _akey = _cfg.get("api_key")
                _jid = external_chat_id or ""
                if _iid and _akey and _jid:
                    if "@" not in _jid:
                        _jid = _re_crm.sub(r"\D", "", _jid) + "@s.whatsapp.net"
                    _base = get_settings().tier_whatsapp_engine_url
                    async with _httpx_pic.AsyncClient(timeout=5.0) as _pc:
                        _pr = await _pc.get(
                            f"{_base}/v1/instances/{_iid}/contacts/{_quote_pic(_jid, safe='')}/profile-pic",
                            headers={"X-API-Key": _akey},
                        )
                    if _pr.status_code < 400:
                        _foto = (_pr.json() or {}).get("url") or None
            except Exception:
                _foto = None

        _res = await erp_crm_client.enviar_conversa_para_crm(
            agent_tenant_id=agent.tenant_id,
            conversa_externa_id=str(conv.id),
            contato_nome=sender_name,
            contato_avatar=_foto,
            telefone=_re_crm.sub(r"\D", "", external_chat_id or ""),
            canal="whatsapp",
            resumo=sem_invisiveis(text_content)[:300],
            origem_canal=origem_canal,
            agente_respondeu=agente_respondeu,
        )
        _op_id = _res.get("oportunidade_id") if isinstance(_res, dict) else None
        # Atualiza o link só se mudou (ex.: card recriado com id novo após delete).
        if _op_id and _op_id != conv.crm_opportunity_id:
            conv.crm_opportunity_id = _op_id
            await db.commit()
    except Exception:
        logger.exception("auto-CRM (todo lead) falhou agent=%s — ignorando", agent.id)


async def handle_inbound_message(
    db: AsyncSession,
    *,
    connector_kind: str,
    instance_id: str,
    external_chat_id: str,
    sender_name: str | None,
    text_content: str,
    attachments: list | None = None,
    modo_voz: bool = False,
    origem_canal: dict | None = None,
    digitando_desde: float | None = None,
) -> dict:
    """Pipeline completo: webhook → Engine → resposta no canal.

    `modo_voz=True` só vem da tela de voz do link público. Encurta a resposta,
    porque em voz o texto comprido é ruim duas vezes: demora mais pra gerar (o
    tempo cresce com o número de tokens) e ninguém quer ouvir um parágrafo.
    WhatsApp e demais canais não passam por aqui — o default é desligado.

    `digitando_desde` (13/11/2026): `time.monotonic()` de quando o webhook do WhatsApp pediu o
    «digitando…». Com ele, a resposta da IA respeita o «digitando» mínimo do agente
    (`services.digitando`, param `digitando_minimo`). Sem ele — e sem o param — nada muda.
    """
    _cron = _Cronometro()
    connector = await resolve_connector_by_instance(db, connector_kind, instance_id)
    if not connector:
        return {"status": "no_connector", "instance_id": instance_id}

    # 18/11/2026 — «parar»/«sair» sozinho logo depois de um DISPARO pelo número não oficial: entra na
    # lista de quem não quer receber (a mesma do oficial). Só consulta o banco quando o texto é uma
    # dessas palavras. No registro a mensagem segue para o inbox; no número com IA, confirma e para.
    if connector_kind == "whatsapp":
        from services import disparo_qr

        _parar = await disparo_qr.descadastro_depois_do_disparo(
            db, connector, external_chat_id=external_chat_id, sender_name=sender_name, texto=text_content
        )
        if _parar is not None:
            return _parar

    # 🚨 Modo REGISTRO (Etapa 1 do caminho A, 09/09/2026): o número não tem IA.
    # Grava a mensagem e para — sem gate de agente ativo (que descartava antes
    # de gravar), sem STT, sem moderação, sem LLM, sem «digitando».
    if (getattr(connector, "modo", None) or "agente") == "registro":
        return await registrar_mensagem_sem_ia(
            db, connector, connector_kind=connector_kind, external_chat_id=external_chat_id,
            sender_name=sender_name, text_content=text_content, attachments=attachments, role="user",
        )

    agent = await db.get(TaAgent, connector.agent_id)
    if not agent or not agent.active:
        return {"status": "agent_inactive", "agent_id": connector.agent_id}
    _cron.marca("resolver")

    # ─── Transcrição de áudio (STT local, grátis) — vale pra TODOS os canais ───
    # Se chegou áudio sem texto real (ou só placeholder "[audio]"), transcreve
    # local via whisper. Centralizado aqui pra Cloud (Maria Luiza) + Baileys.
    try:
        _audio = next(
            (a for a in (attachments or [])
             if getattr(a, "kind", None) == "audio" and getattr(a, "url", None)),
            None,
        )
        _needs_stt = (not text_content) or text_content.strip().startswith("[")
        if _audio and _needs_stt:
            from services.voice import whisper_local

            _tr = await whisper_local.transcribe_url(_audio.url, language="pt")
            if _tr.ok and _tr.text:
                text_content = _tr.text
                logger.info(
                    "ASR ok agent=%s (%.1fs) text='%s'",
                    agent.id, _tr.duration_seconds, _tr.text[:80],
                )
            else:
                logger.warning("ASR falhou agent=%s: %s", agent.id, _tr.error)
                text_content = "[áudio não compreendido]"
    except Exception:
        logger.exception("ASR exception agent=%s — segue sem transcrição", agent.id)
    _cron.marca("stt")

    # ─── IA DESLIGADA no número, ou FORA do horário dela (10/11/2026, M7) ───
    # Botão «IA ligada» e «Horário da IA» da tela de Números. Desligado NÃO é desconectar:
    # a sessão do WhatsApp segue viva, a mensagem entra no Atendimento e o lead nasce no
    # CRM como sempre — só ninguém responde pelo sistema. Fica ANTES das guardas, do CSAT
    # e dos comandos de ops, que também mandam mensagem ao cliente.
    if not ia_responde_agora(connector):
        conv = await ensure_conversation(
            db,
            agent_id=agent.id,
            connector_kind=connector_kind,
            external_id=external_chat_id,
            contact_name=sender_name,
            connector_id=connector.id,
        )
        from services import wa_chave as _wa_chave_off

        await absorver_fala_pendente(
            db, connector, conv, connector_kind=connector_kind,
            jids=[external_chat_id, _wa_chave_off.remote_jid_atual()],
        )
        _att = anexos_para_log(attachments)
        await log_message(
            db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="user", tokens_in=0,
            content=text_content, attachments_json=_att or None,
        )
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        _motivo = "ia_desligada" if not getattr(connector, "ia_ligada", True) else "fora_do_horario_da_ia"
        logger.info("conv=%s número %s %s — só registra", conv.id, connector.id, _motivo)
        return {"status": _motivo, "agent_id": agent.id, "conversation_id": conv.id}

    # ─── Comandos de ops (DevSecOps) — resposta determinística, sem LLM ───
    # Agente marcado como template_kind="devsecops" responde status/health/ping
    # com a saúde REAL do stack (sem alucinar). Conversa normal segue o fluxo.
    if agent.template_kind == "devsecops":
        try:
            from services import ops_commands

            if ops_commands.is_ops_command(text_content):
                reply = await ops_commands.handle_ops_command(db, agent, text_content)
                if reply:
                    await _log_deterministic_turn(
                        db, agent, connector_kind, external_chat_id, sender_name, text_content, reply
                    )
                    try:
                        connector_impl = registry.get(connector_kind)
                        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                        await connector_impl.send(
                            cfg, OutboundMessage(external_chat_id=external_chat_id, content=reply)
                        )
                    except Exception:
                        logger.exception("envio ops command falhou agent=%s", agent.id)
                    return {"status": "ops_command", "agent_id": agent.id}
        except Exception:
            logger.exception("ops_command falhou agent=%s — segue fluxo normal", agent.id)

        # Guard anti-injeção determinístico (independente do modelo). Recusa troca-de-papel
        # ANTES do LLM e re-ancora a identidade. Registra um incidente info pra observabilidade.
        try:
            from services import devops_guard

            if devops_guard.detect_injection(text_content):
                await _log_deterministic_turn(
                    db, agent, connector_kind, external_chat_id, sender_name, text_content, devops_guard.REFUSAL
                )
                try:
                    connector_impl = registry.get(connector_kind)
                    cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                    await connector_impl.send(
                        cfg, OutboundMessage(external_chat_id=external_chat_id, content=devops_guard.REFUSAL)
                    )
                except Exception:
                    logger.exception("envio do guard anti-injeção falhou agent=%s", agent.id)
                try:
                    from sqlalchemy import text as _sql_text

                    await db.execute(
                        _sql_text(
                            "INSERT INTO ta_incident (tenant_id, source, severity, kind, title, fingerprint, status) "
                            "VALUES (:t, 'agent-guard', 'info', 'prompt_injection', :title, :fp, 'open') "
                            "ON CONFLICT (fingerprint) WHERE status IN ('open','ack') AND fingerprint IS NOT NULL "
                            "DO UPDATE SET updated_at = now()"
                        ),
                        {
                            "t": agent.tenant_id,
                            "title": f"Tentativa de injeção de prompt no agente {agent.nome}",
                            "fp": f"injection|{agent.id}|{external_chat_id}",
                        },
                    )
                    await db.commit()
                except Exception:
                    logger.exception("registro de incidente de injeção falhou (não-fatal)")
                return {"status": "injection_blocked", "agent_id": agent.id}
        except Exception:
            logger.exception("guard anti-injeção falhou agent=%s — segue fluxo normal", agent.id)

    # ─── CSAT: resposta de avaliação (0-5) a uma conversa resolvida ───
    # Captura ANTES de ensure_conversation pra não abrir conversa nova.
    try:
        from services import csat

        thanks = await csat.maybe_capture_csat(
            db, agent_id=agent.id, external_chat_id=external_chat_id, text=text_content
        )
        if thanks:
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=thanks)
                )
            except Exception:
                logger.exception("envio csat thanks falhou agent=%s", agent.id)
            return {"status": "csat_captured", "agent_id": agent.id}
    except Exception:
        logger.exception("csat capture falhou agent=%s — segue fluxo normal", agent.id)
    _cron.marca("csat")

    # Q2.4 Budget guard — bloqueia tenant suspenso
    try:
        from services import budget_guard

        budget_state = await budget_guard.check_and_enforce(db, agent.tenant_id)
        if budget_state.get("status") == "paused":
            logger.warning(
                "budget guard: tenant=%s pausado (uso %.0f%%)",
                agent.tenant_id, (budget_state.get("pct") or 0) * 100,
            )
            return {"status": "tenant_suspended", "agent_id": agent.id, **budget_state}
    except Exception:
        logger.exception("budget_guard falhou — continua processando")
    _cron.marca("budget")

    # Q3.1 Guardrails Lakera — bloqueia prompt injection / jailbreak
    # Q2.6 Azure Content Safety — bloqueia hate/violence/sexual/self-harm
    try:
        from services import content_moderation, guardrails

        blocked_by: list[str] = []
        blocked_categories: list[str] = []

        lakera_on = await guardrails.is_enabled_for_tenant(db, agent.tenant_id)
        azure_on = await content_moderation.is_enabled_for_tenant(db, agent.tenant_id)

        if modo_voz and (lakera_on or azure_on):
            # 🚨 VOZ: as duas guardas rodavam em SÉRIE com timeout 10s+8s antes
            # do primeiro token — 18s de teto pra quem está esperando OUVIR.
            # Aqui rodam JUNTAS com teto curto e fail-open: guarda que não
            # respondeu em 1,5s não segura a resposta (as duas já são fail-open
            # em erro; isto só encurta o pior caso). WhatsApp/demais canais
            # seguem no caminho de baixo, intocado.
            import asyncio as _aio_guard

            async def _com_teto(coro, nome: str):
                try:
                    return await _aio_guard.wait_for(coro, timeout=1.5)
                except Exception:
                    logger.warning("guarda %s estourou 1.5s no modo voz — fail-open", nome)
                    return None

            checagens: list[tuple[str, object]] = []
            if lakera_on:
                checagens.append(("lakera", guardrails.check_lakera(text_content)))
            if azure_on:
                checagens.append(("azure_content_safety", content_moderation.check_text(text_content)))
            resultados = await _aio_guard.gather(
                *(_com_teto(coro, nome) for nome, coro in checagens)
            )
            for (nome, _), res in zip(checagens, resultados, strict=False):
                if res is not None and not res.ok:
                    blocked_by.append(nome)
                    blocked_categories.extend(res.blocked_categories)
        else:
            if lakera_on:
                gr = await guardrails.check_lakera(text_content)
                if not gr.ok:
                    blocked_by.append("lakera")
                    blocked_categories.extend(gr.blocked_categories)

            if not blocked_by and azure_on:
                mr = await content_moderation.check_text(text_content)
                if not mr.ok:
                    blocked_by.append("azure_content_safety")
                    blocked_categories.extend(mr.blocked_categories)

        if blocked_by:
            logger.warning(
                "moderation BLOCKED agent=%s contact=%s by=%s categories=%s",
                agent.id, external_chat_id, blocked_by, blocked_categories,
            )
            safe_reply = (
                "Desculpe, não posso processar essa mensagem. Se for dúvida legítima, "
                "reformule por favor ou peça pra falar com um humano."
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=safe_reply)
                )
            except Exception:
                logger.exception("envio safe_reply moderation falhou")
            _cron.marca("guardas")
            logger.info(
                "timing turno agent=%s canal=%s voz=%s bloqueado=%s %s",
                agent.id, connector_kind, modo_voz, blocked_by, _cron.resumo(),
            )
            return {
                "status": "blocked_moderation",
                "agent_id": agent.id,
                "blocked_by": blocked_by,
                "categories": blocked_categories,
            }
    except Exception:
        logger.exception("moderation check falhou — continua processando")
    _cron.marca("guardas")

    conv = await ensure_conversation(
        db,
        agent_id=agent.id,
        connector_kind=connector_kind,
        external_id=external_chat_id,
        contact_name=sender_name,
        connector_id=connector.id,
    )

    # A equipe já tinha escrito para esta pessoa pelo celular? Antes do log, que consome a chave do WhatsApp.
    from services import wa_chave as _wa_chave_in

    _equipe_falou_antes = await absorver_fala_pendente(
        db, connector, conv, connector_kind=connector_kind,
        jids=[external_chat_id, _wa_chave_in.remote_jid_atual()],
    )

    # Log mensagem do user (com mídia, se houver — pra aparecer em Anexos/inline)
    _att = anexos_para_log(attachments)
    _minha_msg_id = await log_message(
        db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="user", tokens_in=0,
        content=text_content, attachments_json=_att or None,
    )
    _cron.marca("conversa")

    # ─── Conversa já assumida por humano? Bot fica em silêncio ───
    # Quando alguém da equipe assumiu (status handed_off), o bot NÃO responde mais
    # automaticamente — só registra a mensagem do cliente (visível na inbox) pra o
    # humano conduzir. "Devolver para a IA" (resume) volta o status pra active.
    if conv.status == "handed_off":
        logger.info("conv=%s handed_off — bot em silêncio (humano no controle)", conv.id)
        if _equipe_falou_antes:
            # A conversa acabou de nascer pausada: sem isto o card do cliente não nasceria.
            await _espelhar_no_crm(
                db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
                external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
                origem_canal=origem_canal, agente_respondeu=False,
            )
        return {"status": "handed_off_paused", "agent_id": agent.id, "conversation_id": conv.id}

    _phone_for_summary = _re.sub(r"\D", "", (external_chat_id or "").split("@")[0])
    # Telefone real do contato, injetado nas tools de cadastro/busca. Só canal
    # telefônico tem telefone no chat_id — em webchat/Slack/Discord o id é sessão
    # ou usuário, e extrair dígitos dali inventaria um número que não existe.
    _phone = _phone_for_summary if connector_kind in ("whatsapp", "whatsapp_cloud") else ""

    # ─── Handoff explícito + escalonamento por frustração ───
    # Pedido explícito de humano → handoff + PAUSA o bot + confirma ao cliente.
    # Frustração detectada → ALERTA o time (warm handoff), mas o bot CONTINUA
    # tentando ajudar (ref: Fin tenta resolver antes; sentimento não pausa sozinho).
    try:
        from services import escalation, handoff

        if handoff.wants_human(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_EXPLICIT,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_EXPLICIT,
                summary=summary,
                pause=True,
            )
            # Fora do expediente → mensagem de fora-de-horário no lugar da padrão
            from services import business_hours

            try:
                aberto = await business_hours.is_open(db, agent.tenant_id)
            except Exception:
                aberto = True
            handoff_reply = (
                handoff.HANDOFF_REPLY
                if aberto
                else await business_hours.offhours_message(db, agent.tenant_id)
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg,
                    OutboundMessage(external_chat_id=external_chat_id, content=handoff_reply),
                )
            except Exception:
                logger.exception("envio handoff reply falhou agent=%s", agent.id)
            await log_message(
                db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="assistant",
                content=handoff_reply,
            )
            await _espelhar_no_crm(
                db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
                external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
                origem_canal=origem_canal, agente_respondeu=True,
            )
            return {"status": "handoff", "agent_id": agent.id, "conversation_id": conv.id}

        if escalation.is_frustrated(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_FRUSTRATION,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            # pause=False: alerta o time, mas o bot segue respondendo abaixo.
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_FRUSTRATION,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("handoff/escalation check falhou agent=%s — segue fluxo normal", agent.id)
    _cron.marca("handoff")

    # ─── Rajada (16/11/2026): o cliente mandou outra logo em seguida? A mais nova responde ───
    # Duas mensagens seguidas («Bom dia» + «Reunião») rodavam a IA duas vezes em paralelo e o cliente
    # recebia a saudação repetida. Fica DEPOIS do pedido de humano (que vale por mensagem) e ANTES do
    # modelo. A mensagem que cede ainda vai para o CRM — é ela que traz a origem do anúncio.
    from services import rajada

    if await rajada.ceder_antes_do_modelo(db, agent.id, conv.id, _minha_msg_id):
        logger.info("conv=%s msg=%s cedeu a vez para a mensagem seguinte do cliente", conv.id, _minha_msg_id)
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "agrupada", "agent_id": agent.id, "conversation_id": conv.id}
    _cron.marca("rajada")

    # ─── Playbook router (Sprint 1) ───
    # Intercepta antes do Engine. Se nenhuma trigger matchou, cai pro fluxo padrão.
    try:
        match = await playbook_router.match_inbound_message(
            db, agent_id=agent.id, text=text_content
        )
    except Exception:
        logger.exception("playbook_router falhou agent=%s — fallback pro Engine", agent.id)
        match = None
    _cron.marca("playbook")

    if match:
        logger.info(
            "agent_runtime: matched playbook_id=%s trigger=%s agent=%s",
            match.playbook_id, match.trigger_type, agent.id,
        )
        try:
            result = await playbook_executor.run_playbook(
                db,
                playbook_id=match.playbook_id,
                trigger_node_id=match.trigger_node_id,
                trigger_type=match.trigger_type,
                agent_id=agent.id,
                conversation_id=conv.id,
                inbound_text=text_content,
                inbound_sender=sender_name,
                connector_kind=connector_kind,
                external_chat_id=external_chat_id,
            )
            return {
                "status": "ok",
                "via": "playbook",
                "playbook_id": match.playbook_id,
                "agent_id": agent.id,
                "conversation_id": conv.id,
                **result,
            }
        except Exception as e:
            logger.exception(
                "playbook_executor falhou playbook=%s agent=%s — fallback pro Engine",
                match.playbook_id, agent.id,
            )
            # cai pro Engine free como fallback

    # Memory cross-session: busca fatos relevantes do contato + injeta no system
    from services import memory_service

    memory_block = ""
    try:
        mem_hits = await memory_service.search(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            external_chat_id=external_chat_id,
            query=text_content,
            top_k=5,
        )
        if mem_hits:
            memory_block = memory_service.format_for_prompt(mem_hits)
    except Exception:
        logger.exception("memory.search falhou agent=%s — segue sem memory", agent.id)
    _cron.marca("memoria")

    system_prompt = persona_efetiva(agent)  # 09/11/2026: blocos por horário (persona_do_horario)
    if memory_block:
        system_prompt = f"{system_prompt}\n\n{memory_block}".strip()

    # RAG: busca conhecimento relevante na Base e injeta no system.
    rag_block, _rag_fontes = await build_rag_block(db, agent.id, text_content)
    if rag_block:
        system_prompt = f"{system_prompt}\n\n{rag_block}"
    _cron.marca("rag")

    # Contexto do contato + diretrizes base: montados em PONTO ÚNICO
    # (build_contact_block / build_base_directives), pra o playground do painel
    # produzir exatamente o mesmo prompt. Testar com prompt diferente do de
    # produção não é testar — foi o que fez o teste do painel divergir do WhatsApp.
    system_prompt = f"{system_prompt}\n\n" + build_contact_block(
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
    )

    # DevOps: injeta os últimos alertas/incidentes REAIS no contexto, pra responder
    # "qual o último alerta?" direto — sem mandar o usuário rodar comando no servidor.
    # Fica aqui (e não no builder) porque precisa de `db` e é async.
    _extra_blk = ""
    if (agent.template_kind or "") == "devsecops":
        try:
            from services import ops_commands as _ops

            _extra_blk = await _ops.recent_alerts_block(db, agent.tenant_id, 6) or ""
        except Exception:
            logger.exception("inject alerts block falhou agent=%s", agent.id)

    system_prompt = f"{system_prompt}\n\n" + build_base_directives(
        agent, connector_kind=connector_kind, extra_block=_extra_blk
    )

    if modo_voz:
        # 🚨 O que mais custa latência é a QUANTIDADE de token gerado — o tempo
        # cresce junto. Cortar a resposta pela metade corta a espera pela metade,
        # e em voz isso melhora a experiência em vez de piorar.
        system_prompt += (
            "\n\n## Você está falando por VOZ\n"
            "A pessoa está OUVINDO, não lendo. Responda em NO MÁXIMO 2 frases curtas.\n"
            "Direto ao ponto: sem listar, sem enumerar, sem markdown, sem emoji.\n"
            "Se o assunto for longo, dê o essencial e ofereça detalhar em seguida.\n"
            "Fale como quem conversa, não como quem escreve documento."
        )

    # Histórico da conversa → memória do modelo (senão "esquece" o cliente)
    history: list[dict] = []
    try:
        history = await load_history(db, conv.id)
    except Exception:
        logger.exception("load_history falhou agent=%s — segue sem histórico", agent.id)
    _cron.marca("historico")

    # Engine responde (com vision se attachment image presente)
    try:
        reply = await tier_engine.send_message(
            tenant_id=agent.tenant_id,
            user_content=text_content,
            db=db,
            session_id=f"conv-{conv.id}",
            system_override=system_prompt,
            attachments=attachments or [],
            agent_id=agent.id,
            history=history,
            use_cache=not (memory_block or rag_block),  # contextual → sem cache
            customer_phone=_phone or None,  # telefone real do contato → injetado nas tools de cadastro/busca
        )
    except tier_engine.ProvidersAllDisabled:
        # Tenant desligou todas as LLMs de propósito → agente fica em silêncio (sem
        # cair no modelo global da plataforma). NÃO manda nada pro cliente.
        logger.info(
            "LLM do tenant desativada (todas off) — agente em silêncio tenant=%s agent=%s",
            agent.tenant_id, agent.id,
        )
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "llm_disabled"}
    except Exception as e:
        logger.exception("Engine falhou tenant=%s agent=%s", agent.tenant_id, agent.id)
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "engine_error", "error": str(e)}
    _cron.marca("llm")

    # Rajada, porta 2: o cliente escreveu de novo ENQUANTO o modelo gerava → esta resposta já nasceu velha;
    # a mais nova responde tudo. Se o modelo agiu (ferramenta), a resposta que explica a ação sai assim mesmo.
    if await rajada.descartar_depois_do_modelo(db, conv.id, _minha_msg_id, bool(reply.tool_calls_made)):
        logger.info("conv=%s msg=%s resposta descartada: o cliente escreveu de novo durante a geração",
                    conv.id, _minha_msg_id)
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "substituida", "agent_id": agent.id, "conversation_id": conv.id}

    # Silêncio de propósito (15/11/2026, M7): a persona mandou não responder. Nada vai ao
    # cliente; a mensagem dele segue para o CRM como sem resposta do agente, para a equipe
    # assumir. Sem log de resposta do assistente — não houve resposta.
    if tier_engine.eh_silencio(reply.text):
        logger.info(
            "agente em silêncio por regra da persona tenant=%s agent=%s conv=%s",
            agent.tenant_id, agent.id, conv.id,
        )
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "silencio", "agent_id": agent.id}

    # 15/11/2026 (CCDA): fecho genérico de ajuda sai do fim da resposta, no envio E no registro — senão o
    # painel mostraria a frase que a família não recebeu. Só com o parâmetro do agente; sem ele, igual a antes.
    from services import fecho_de_ajuda

    _texto_resposta = reply.text
    if await fecho_de_ajuda.ligado(db, agent.id):
        # Resposta que é SÓ a oferta: cortar deixaria vazio. Regra 39 do CCDA = incentivar a conversa → o modelo
        # reescreve UMA vez, sem ferramentas (nada de agendar/consultar duas vezes).
        async def _gerar_sem_ferramentas(conteudo, hist):
            return await tier_engine.send_message(
                tenant_id=agent.tenant_id,
                user_content=conteudo,
                db=db,
                session_id=f"conv-{conv.id}",
                system_override=system_prompt,
                agent_id=agent.id,
                history=hist,
                use_cache=False,
                customer_phone=_phone or None,
                tools=[],
            )

        _texto_resposta, _extra = await fecho_de_ajuda.aplicar(
            reply.text,
            ferramentas_usadas=reply.tool_calls_made,
            mensagem_do_cliente=text_content,
            history=history,
            gerar=_gerar_sem_ferramentas,
        )
        if _extra is not None:  # a reescrita também custa: soma no custo do turno
            reply.tokens_in = (reply.tokens_in or 0) + (_extra.tokens_in or 0)
            reply.tokens_out = (reply.tokens_out or 0) + (_extra.tokens_out or 0)

    # Calcula custo real via TaLlmProvider lookup
    from services import cost_calculator

    cost_cents = await cost_calculator.calculate_cost_cents(
        db,
        agent.tenant_id,
        model_used=reply.model_used,
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
    )

    # Observabilidade/eval: tool calls (args truncados) + freios disparados no turno.
    _tool_calls_log = [
        {"name": c.get("name"), "args": json.dumps(c.get("args"), ensure_ascii=False)[:300]}
        for c in (reply.tool_calls_made or [])
    ] or None

    # Log resposta do assistant
    await log_message(
        db,
        conversation_id=conv.id,
        tenant_id=agent.tenant_id,
        role="assistant",
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
        cost_cents=cost_cents,
        latency_ms=reply.latency_ms,
        model_used=reply.model_used,
        content=_texto_resposta,
        tool_calls_json=_tool_calls_log,
        brakes_fired=(reply.brakes_fired or None),
        system_prompt_sent=(system_prompt if _LOG_PROMPTS else None),
        memory_block=(memory_block if _LOG_PROMPTS else None),
        rag_block=(rag_block if _LOG_PROMPTS else None),
    )
    _cron.marca("registro")

    # Envia resposta de volta no canal
    try:
        connector_impl = registry.get(connector_kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
        _clean = _sem_travessao(_sanitize_reply(_texto_resposta))
        if connector_kind in ("whatsapp", "whatsapp_cloud"):
            _clean = _format_for_whatsapp(_clean)
        _bubbles = _baloes_do_canal(_clean, connector_kind)
        # Sem delay aditivo aqui: o timing humano (pausa de leitura + '…digitando'
        # enquanto o LLM gera) é feito no handler do webhook, antes desta etapa.
        # Exceção (13/11/2026, CCDA): agente com «digitando» mínimo configurado completa o
        # que faltar dele antes do 1º balão — só o que FALTA, nunca por cima de um modelo
        # lento. Sem `digitando_desde` ou sem o param, não espera. Nunca levanta.
        if digitando_desde is not None:
            from services import digitando

            await digitando.aguardar(agent.id, digitando_desde, _bubbles[0] if _bubbles else _clean)
            _cron.marca("digitando")
        if connector_kind == "webchat" or len(_bubbles) <= 1:
            # Webchat: a fila do Redis é drenada numa resposta HTTP só — split
            # com pausa aqui não simula digitação, só ATRASA a resposta (até
            # 3,6s a mais) e abre corrida com o drain antecipado da rota. Vai
            # inteiro, de uma vez.
            await connector_impl.send(
                cfg, OutboundMessage(external_chat_id=external_chat_id, content=_clean)
            )
        else:
            import asyncio as _asyncio

            for _i, _b in enumerate(_bubbles):
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=_b)
                )
                if _i < len(_bubbles) - 1:
                    await _asyncio.sleep(1.2)  # pausa natural entre balões
    except Exception as e:
        logger.exception("Falha enviando resposta agent=%s channel=%s", agent.id, connector_kind)
        await _espelhar_no_crm(
            db, agent=agent, conv=conv, connector=connector, connector_kind=connector_kind,
            external_chat_id=external_chat_id, sender_name=sender_name, text_content=text_content,
            origem_canal=origem_canal, agente_respondeu=False,
        )
        return {"status": "send_error", "agent_id": agent.id, "error": str(e)}
    _cron.marca("envio")

    # Espelho em TEMPO REAL pro Hovio Pet (se o agente estiver conectado a um petshop).
    # Fire-and-forget — não bloqueia. O job periódico (60s) fica só como backstop.
    try:
        import asyncio as _aio_mirror

        from services import pet_mirror

        _aio_mirror.create_task(pet_mirror.mirror_recent_to_pet(agent.id, conv.id))
    except Exception:
        logger.exception("agendar mirror realtime falhou agent=%s", agent.id)

    # Captura de lead — se o cliente demonstrou intenção de compra ou informou
    # telefone, registra um lead pra equipe (não perder oportunidades). Não bloqueia.
    try:
        from services import lead_capture

        await lead_capture.maybe_capture_lead(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            external_chat_id=external_chat_id,
            sender_name=sender_name,
            user_text=text_content,
            origem_canal=origem_canal,
        )
    except Exception:
        logger.exception("lead_capture falhou agent=%s — ignorando", agent.id)

    await _espelhar_no_crm(
        db,
        agent=agent,
        conv=conv,
        connector=connector,
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
        text_content=text_content,
        origem_canal=origem_canal,
        agente_respondeu=True,
    )

    # Qualificação automática: a mensagem do cliente preenche os campos do card.
    #
    # Roda DEPOIS do bloco acima porque depende do card já existir — na 1ª
    # mensagem o card acabou de nascer, e a resposta da pergunta ("qual série?")
    # chega nas mensagens seguintes, quando o auto-CRM já é só dedup.
    #
    # É chamada por mensagem, mas de propósito não custa modelo: o ERP casa o
    # texto contra a lista de opções do campo. Quem sabe quais campos existem é
    # o ERP — o agente não conhece "série" nem precisa. É isso que faz valer pra
    # qualquer cliente sem tocar no prompt.
    try:
        from core.config import get_settings

        if get_settings().tier_erp_auto_crm and (text_content or "").strip():
            from services import erp_crm_client

            if erp_crm_client.integracao_ativa():
                # A ULTIMA fala do agente vai junto. E o que transforma
                # casamento de texto em leitura de conversa: sabendo que a
                # pergunta foi "qual ano escolar?", a resposta "meu filho tem 8
                # anos" e a serie — sem isso e so um numero solto numa frase.
                _pergunta = None
                try:
                    _res = await db.execute(
                        select(TaMessageLog.content)
                        .where(
                            TaMessageLog.conversation_id == conv.id,
                            TaMessageLog.role == "assistant",
                        )
                        # `offset(1)`: a resposta DESTE turno já foi gravada
                        # lá em cima, então a mais nova é ela — a pergunta que
                        # o cliente respondeu é a anterior.
                        .order_by(TaMessageLog.id.desc())
                        .offset(1)
                        .limit(1)
                    )
                    _pergunta = _res.scalar_one_or_none()
                except Exception:  # noqa: BLE001
                    _pergunta = None

                _ext = await erp_crm_client.extrair_campos_da_conversa(
                    agent_tenant_id=agent.tenant_id,
                    conversa_externa_id=str(conv.id),
                    texto=text_content,
                    pergunta_anterior=_pergunta,
                )
                if isinstance(_ext, dict) and _ext.get("gravados"):
                    logger.info(
                        "auto-qualificação conv=%s gravou=%s etapa=%s",
                        conv.id, _ext.get("gravados"), _ext.get("moveu_para"),
                    )
    except Exception:
        logger.exception("auto-qualificação falhou agent=%s — ignorando", agent.id)

    # Loop sem resolução — bot respondeu "não sei" repetidas vezes. Alerta o time
    # (warm handoff) sem pausar o bot. Dedup evita spam (1 não-lida por conversa).
    try:
        from services import escalation, handoff

        if await escalation.detect_loop(db, conv.id, reply.text):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_LOOP,
                contact_name=sender_name,
                phone=_re.sub(r"\D", "", (external_chat_id or "").split("@")[0]),
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_LOOP,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("loop detection falhou agent=%s — ignorando", agent.id)

    # Memory.add em background (sessão isolada — não bloqueia resposta)
    try:
        import asyncio

        from core.db import db_context

        async def _async_add_memory():
            try:
                async with db_context() as mdb:
                    await memory_service.add(
                        mdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        user_text=text_content,
                        assistant_text=reply.text,
                        contact_name=sender_name,
                    )
                # Q2.6 Style adapter — primeiras 3 mensagens classifica tom + salva como preference
                from services import style_adapter

                async with db_context() as sdb:
                    await style_adapter.maybe_extract_style(
                        sdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        text=text_content,
                        msg_count=conv.msg_count,
                    )
            except Exception:
                logger.exception("memory.add background falhou")

        asyncio.create_task(_async_add_memory())
    except Exception:
        logger.exception("agendar memory.add falhou")

    # Langfuse trace (fire-and-forget) — observability cliente
    try:
        from services import langfuse_client

        await langfuse_client.trace_event(
            name="agent_message",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            input={"text": text_content[:500], "attachments": len(attachments or [])},
            output={"text": (reply.text or "")[:500]},
            metadata={
                "channel": connector_kind,
                "external_chat_id": external_chat_id,
                "tokens_in": reply.tokens_in,
                "tokens_out": reply.tokens_out,
                "cost_cents": cost_cents,
                "model": reply.model_used,
                "memory_used": bool(memory_block),
                "tool_calls": [c.get("name") for c in (reply.tool_calls_made or [])],
                "brakes_fired": reply.brakes_fired or [],
            },
            # turnos onde o modelo precisou de correção (freio) sobem como WARNING — métrica de saúde
            level="WARNING" if reply.brakes_fired else "DEFAULT",
            latency_ms=reply.latency_ms,
        )
    except Exception:
        pass
    _cron.marca("hooks")

    # A linha que tira a latência da adivinhação: uma por turno, com o tempo de
    # cada etapa. `hooks` é tudo que roda DEPOIS de a resposta já ter saído
    # (auto-CRM, qualificação, lead, loop) — no webchat a rota drena a fila
    # antes disso terminar, então `hooks` alto NÃO segura mais o visitante.
    logger.info(
        "timing turno agent=%s canal=%s voz=%s %s",
        agent.id, connector_kind, modo_voz, _cron.resumo(),
    )

    return {
        "status": "ok",
        "agent_id": agent.id,
        "conversation_id": conv.id,
        "tokens_in": reply.tokens_in,
        "tokens_out": reply.tokens_out,
        "latency_ms": reply.latency_ms,
        "memory_used": bool(memory_block),
    }

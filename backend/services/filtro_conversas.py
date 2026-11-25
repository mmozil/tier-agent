"""Filtros da lista de conversas: período de criação e responsável (09/11/2026, pedido da M7).

O administrador vê as conversas de todos e filtra por pessoa e por data; o atendente segue vendo
só as dele — essa trava é a de `visao_conversas`, que roda antes e não muda aqui.

- **Período** é sobre o dia em que a conversa foi CRIADA (`started_at`), no fuso do Brasil.
  O banco guarda `started_at` em UTC sem fuso (`now()` num Postgres em UTC), então o dia
  09/11 do Brasil vai de 09/11 03:00 a 10/11 03:00 em UTC.
- **Responsável** de uma conversa é quem está atribuído a ela; sem atribuição, a pessoa
  responsável pelo número por onde ela entrou (`ta_connector.member_id`). É o mesmo nome que a
  linha da lista mostra, para o filtro e a linha nunca discordarem.

25/11/2026 (CCDA, «a Karolaine só tem 3 conversas») — as filas da lateral e a página seguinte. A tela
carregava as 200 conversas mais recentes da CONTA e filtrava número, canal e filas em cima delas: num
dia de disparo, 182 das 200 eram do número oficial, o número da consultora mostrava 3 de 69, e 187
famílias aguardando resposta não apareciam em lista nenhuma. Todo filtro passa a ser do SERVIDOR.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import aliased

from models import TaConnector, TaConversation, TaMessageLog

FUSO = ZoneInfo("America/Sao_Paulo")
MAIOR_PERIODO_DIAS = 366
SEM_RESPONSAVEL = 0  # valor do filtro para «sem responsável»


def _inicio_do_dia_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, FUSO).astimezone(timezone.utc).replace(tzinfo=None)


def janela_utc(de: date | None, ate: date | None) -> tuple[datetime | None, datetime | None]:
    """Dias do Brasil → limites em UTC sem fuso: `ini` inclusivo, `fim` exclusivo (o dia seguinte a `ate`).

    Levanta `ValueError` com a frase para a tela quando o período não faz sentido."""
    if de and ate:
        if de > ate:
            raise ValueError("O início do período é depois do fim.")
        if (ate - de).days > MAIOR_PERIODO_DIAS:
            raise ValueError("Escolha um período de até um ano.")
    ini = _inicio_do_dia_utc(de) if de else None
    fim = _inicio_do_dia_utc(ate + timedelta(days=1)) if ate else None
    return ini, fim


def responsavel_da_conversa(assigned_member_id: int | None, dono_do_numero: int | None) -> tuple[int | None, str | None]:
    """Quem responde pela conversa, e por quê: atribuída a alguém, ou do número de alguém."""
    if assigned_member_id:
        return assigned_member_id, "atribuida"
    if dono_do_numero:
        return dono_do_numero, "numero"
    return None, None


def condicao_responsavel(responsavel: int, agent_ids: list[int]):
    """Cláusula SQL do filtro por responsável, com a mesma regra de `responsavel_da_conversa`."""
    numeros_com_dono = select(TaConnector.id).where(
        TaConnector.agent_id.in_(agent_ids), TaConnector.member_id.isnot(None)
    )
    if responsavel == SEM_RESPONSAVEL:
        # `NOT IN` com connector_id nulo dá NULL e esconderia a conversa sem número: por isso o `or_`.
        return and_(
            TaConversation.assigned_member_id.is_(None),
            or_(TaConversation.connector_id.is_(None), TaConversation.connector_id.not_in(numeros_com_dono)),
        )
    numeros_dele = select(TaConnector.id).where(
        TaConnector.agent_id.in_(agent_ids), TaConnector.member_id == responsavel
    )
    return or_(
        TaConversation.assigned_member_id == responsavel,
        and_(TaConversation.assigned_member_id.is_(None), TaConversation.connector_id.in_(numeros_dele)),
    )


# Quem «responde» à família: a IA (`assistant`) e a equipe (`agent`, inclusive modelo e disparo).
# Nota interna (`note`) não é resposta — a família não vê.
PAPEIS_QUE_RESPONDEM = ("assistant", "agent")
FILAS = ("nao_lidas", "aguardando", "nao_atendidas")


def nao_encerrada():
    return or_(TaConversation.status.is_(None), TaConversation.status != "closed")


def condicao_fila(fila: str):
    """As filas da lateral, com a mesma régua dos campos `nao_lidas` e `aguardando_desde` da linha."""
    if fila == "nao_lidas":
        m = aliased(TaMessageLog)
        return exists().where(
            m.conversation_id == TaConversation.id,
            m.role == "user",
            or_(TaConversation.visto_equipe_em.is_(None), m.created_at > TaConversation.visto_equipe_em),
        )
    if fila == "nao_atendidas":
        return and_(nao_encerrada(), TaConversation.assigned_member_id.is_(None))
    if fila == "aguardando":
        deles, nossa = aliased(TaMessageLog), aliased(TaMessageLog)
        ult_dele = (
            select(func.max(deles.created_at))
            .where(deles.conversation_id == TaConversation.id, deles.role == "user")
            .correlate(TaConversation)
            .scalar_subquery()
        )
        ult_nossa = (
            select(func.max(nossa.created_at))
            .where(nossa.conversation_id == TaConversation.id, nossa.role.in_(PAPEIS_QUE_RESPONDEM))
            .correlate(TaConversation)
            .scalar_subquery()
        )
        return and_(nao_encerrada(), ult_dele.isnot(None), or_(ult_nossa.is_(None), ult_dele > ult_nossa))
    raise ValueError(f"fila desconhecida: {fila}")


def condicao_pagina(antes_de: datetime | None, antes_id: int | None):
    """A página seguinte da lista (última mensagem mais nova primeiro, sem data por último).

    `antes_de`/`antes_id` são da ÚLTIMA conversa já mostrada. Pelo par, e não por «pular N»: entre uma
    página e outra chega mensagem nova, e pular N repetiria uma conversa e perderia outra."""
    if antes_id is None:
        return None
    ultima = TaConversation.last_message_at
    if antes_de is None:
        return and_(ultima.is_(None), TaConversation.id < antes_id)
    return or_(ultima < antes_de, and_(ultima == antes_de, TaConversation.id < antes_id), ultima.is_(None))


def agrupar_resumo(linhas, rotulo_do_conector: dict[int, tuple[str | None, str]], nome_do_agente: dict[int, str]) -> dict:
    """Os números da lateral a partir de TODAS as conversas que a pessoa enxerga, e não das carregadas.

    `linhas`: (agent_id, connector_id, connector_kind, team_id, tags, status, assigned_member_id,
    visto_equipe_em, última do contato, última nossa)."""
    total = nao_lidas = aguardando = nao_atendidas = 0
    canais: dict[str, list[int]] = {}
    numeros: dict[str, dict] = {}
    agentes: dict[int, list[int]] = {}
    etiquetas: dict[str, list[int]] = {}
    times: dict[int, list[int]] = {}

    def soma(grupo: dict, chave, nova: bool) -> None:
        g = grupo.setdefault(chave, [0, 0])
        g[0] += 1
        g[1] += 1 if nova else 0

    for agent_id, connector_id, kind, team_id, tags, status, atribuida, visto, dele, nossa in linhas:
        aberta = status != "closed"
        nova = dele is not None and (visto is None or dele > visto)
        total += 1
        nao_lidas += 1 if nova else 0
        aguardando += 1 if aberta and dele is not None and (nossa is None or dele > nossa) else 0
        nao_atendidas += 1 if aberta and not atribuida else 0
        soma(canais, kind or "outro", nova)
        soma(agentes, agent_id, nova)
        if team_id:
            soma(times, team_id, nova)
        for t in {str(x) for x in (tags or []) if str(x).strip()}:
            soma(etiquetas, t, nova)
        rotulo, modo = rotulo_do_conector.get(connector_id or -1) or (None, "agente")
        if rotulo:
            g = numeros.setdefault(
                rotulo, {"rotulo": rotulo, "connector_ids": [], "modo": modo, "total": 0, "nao_lidas": 0}
            )
            if connector_id not in g["connector_ids"]:
                g["connector_ids"].append(connector_id)
            g["total"] += 1
            g["nao_lidas"] += 1 if nova else 0

    def lista(grupo: dict, nome: str) -> list[dict]:
        return [
            {nome: k, "total": v[0], "nao_lidas": v[1]} for k, v in sorted(grupo.items(), key=lambda kv: str(kv[0]))
        ]

    return {
        "total": total,
        "nao_lidas": nao_lidas,
        "aguardando": aguardando,
        "nao_atendidas": nao_atendidas,
        "canais": lista(canais, "canal"),
        "numeros": sorted(numeros.values(), key=lambda n: n["rotulo"]),
        "agentes": [{**a, "nome": nome_do_agente.get(a["id"])} for a in lista(agentes, "id")],
        "etiquetas": lista(etiquetas, "nome"),
        "times": lista(times, "id"),
    }

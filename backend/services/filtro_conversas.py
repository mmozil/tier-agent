"""Filtros da lista de conversas: período de criação e responsável (09/11/2026, pedido da M7).

O administrador vê as conversas de todos e filtra por pessoa e por data; o atendente segue vendo
só as dele — essa trava é a de `visao_conversas`, que roda antes e não muda aqui.

- **Período** é sobre o dia em que a conversa foi CRIADA (`started_at`), no fuso do Brasil.
  O banco guarda `started_at` em UTC sem fuso (`now()` num Postgres em UTC), então o dia
  09/11 do Brasil vai de 09/11 03:00 a 10/11 03:00 em UTC.
- **Responsável** de uma conversa é quem está atribuído a ela; sem atribuição, a pessoa
  responsável pelo número por onde ela entrou (`ta_connector.member_id`). É o mesmo nome que a
  linha da lista mostra, para o filtro e a linha nunca discordarem.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select

from models import TaConnector, TaConversation

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

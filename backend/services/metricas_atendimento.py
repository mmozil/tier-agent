"""Métricas de atendimento por PESSOA e por NÚMERO — Etapa 4 do caminho A (09/09/2026).

As definições valem no Agent e no Dashboard do ERP (que lê daqui), num lugar só:

- **Conversa**: thread por (nosso número = `connector_id`, contato = `external_id`); entra na
  janela pelo início (`started_at`).
- **Atendimento**: conversa com ≥ 1 mensagem enviada por HUMANO (`role="agent"` — painel ou o
  celular da consultora, via fromMe). Nota interna não conta; resposta da IA não conta.
- **Abordagem**: conversa cuja PRIMEIRA mensagem é nossa e humana (a consultora puxou assunto).
- **1ª resposta**: da 1ª mensagem do contato até a PRIMEIRA mensagem humana depois dela.
  Mediana e média em segundos. `1ª resposta da IA` é o mesmo até o `assistant`.
- **Por pessoa**: pelo `member_id` (nunca pelo nome). A conversa conta para quem RESPONDEU
  nela (atendimentos) e para a DONA (`assigned_member_id` → conversas).
- **Por número**: pelo `connector_id`.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import mean, median
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaAgent, TaConversation, TaMember, TaMessageLog

FUSO = ZoneInfo("America/Sao_Paulo")
HUMANO, CONTATO, IA = "agent", "user", "assistant"


@dataclass
class Msg:
    role: str
    member_id: int | None
    em: datetime


@dataclass
class Resumo:
    conversation_id: int
    connector_id: int | None
    assigned_member_id: int | None
    started_at: datetime | None
    primeira_role: str | None = None
    primeira_member: int | None = None
    atendimento: bool = False
    abordagem: bool = False
    msgs_por_membro: Counter = field(default_factory=Counter)
    primeira_resposta_s: float | None = None
    primeira_resposta_por: int | None = None
    primeira_resposta_ia_s: float | None = None
    duracao_s: float | None = None


def resumir(
    conversation_id: int,
    connector_id: int | None,
    assigned_member_id: int | None,
    started_at: datetime | None,
    msgs: list[Msg],
) -> Resumo:
    """Lê uma conversa (mensagens em ordem) e tira dela os fatos que as métricas usam. Puro."""
    r = Resumo(conversation_id, connector_id, assigned_member_id, started_at)
    if not msgs:
        return r
    r.primeira_role, r.primeira_member = msgs[0].role, msgs[0].member_id
    r.abordagem = msgs[0].role == HUMANO
    t_contato: datetime | None = None
    for m in msgs:
        if m.role == HUMANO:
            r.atendimento = True
            r.msgs_por_membro[m.member_id or 0] += 1
            if t_contato is not None and r.primeira_resposta_s is None:
                r.primeira_resposta_s = max(0.0, (m.em - t_contato).total_seconds())
                r.primeira_resposta_por = m.member_id
        elif m.role == IA:
            if t_contato is not None and r.primeira_resposta_ia_s is None:
                r.primeira_resposta_ia_s = max(0.0, (m.em - t_contato).total_seconds())
        elif m.role == CONTATO and t_contato is None:
            t_contato = m.em
    r.duracao_s = max(0.0, (msgs[-1].em - msgs[0].em).total_seconds())
    return r


def _estat(valores: list[float]) -> dict:
    if not valores:
        return {"mediana_s": None, "media_s": None, "n": 0}
    return {"mediana_s": round(median(valores), 1), "media_s": round(mean(valores), 1), "n": len(valores)}


def _dia_local(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(FUSO).date().isoformat()


def agregar(
    resumos: list[Resumo],
    *,
    membros: dict[int, dict],
    numeros: dict[int, dict],
    desde: datetime,
    hoje_inicio_utc: datetime,
    days: int,
) -> dict:
    """Soma os resumos nos três cortes (totais · por pessoa · por número) e na série diária. Puro."""
    total = len(resumos)
    atend = sum(1 for r in resumos if r.atendimento)
    abord = sum(1 for r in resumos if r.abordagem)
    hoje = sum(1 for r in resumos if r.started_at and r.started_at >= hoje_inicio_utc)

    pp: dict[int, dict] = defaultdict(lambda: {"conversas": 0, "atendimentos": 0, "abordagens": 0, "mensagens": 0, "tempos": []})
    pn: dict[int, dict] = defaultdict(lambda: {"conversas": 0, "atendimentos": 0, "abordagens": 0, "tempos": []})
    por_dia: dict[str, dict] = {}
    for i in range(days):
        d = (desde + timedelta(days=i + 1))
        por_dia[_dia_local(d) or ""] = {"conversas": 0, "atendimentos": 0, "abordagens": 0}
    for r in resumos:
        if r.assigned_member_id:
            pp[r.assigned_member_id]["conversas"] += 1
        for mid, n in r.msgs_por_membro.items():
            if mid:
                pp[mid]["atendimentos"] += 1
                pp[mid]["mensagens"] += n
        if r.abordagem and r.primeira_member:
            pp[r.primeira_member]["abordagens"] += 1
        if r.primeira_resposta_s is not None and r.primeira_resposta_por:
            pp[r.primeira_resposta_por]["tempos"].append(r.primeira_resposta_s)
        if r.connector_id:
            n_ = pn[r.connector_id]
            n_["conversas"] += 1
            n_["atendimentos"] += int(r.atendimento)
            n_["abordagens"] += int(r.abordagem)
            if r.primeira_resposta_s is not None:
                n_["tempos"].append(r.primeira_resposta_s)
        dia = _dia_local(r.started_at)
        if dia in por_dia:
            por_dia[dia]["conversas"] += 1
            por_dia[dia]["atendimentos"] += int(r.atendimento)
            por_dia[dia]["abordagens"] += int(r.abordagem)

    por_pessoa = []
    for mid, v in pp.items():
        m = membros.get(mid) or {}
        por_pessoa.append(
            {
                "member_id": mid,
                "nome": m.get("nome") or f"#{mid}",
                "papel": m.get("papel"),
                "origem": m.get("origem"),
                "conversas": v["conversas"],
                "atendimentos": v["atendimentos"],
                "abordagens": v["abordagens"],
                "mensagens": v["mensagens"],
                "primeira_resposta": _estat(v["tempos"]),
            }
        )
    por_pessoa.sort(key=lambda x: (-x["atendimentos"], -x["conversas"], x["nome"]))

    por_numero = []
    for cid, v in pn.items():
        n = numeros.get(cid) or {}
        dona = membros.get(n.get("member_id") or -1) or {}
        por_numero.append(
            {
                "connector_id": cid,
                "rotulo": n.get("rotulo") or f"#{cid}",
                "modo": n.get("modo"),
                "member_id": n.get("member_id"),
                "dona": dona.get("nome"),
                "conversas": v["conversas"],
                "atendimentos": v["atendimentos"],
                "abordagens": v["abordagens"],
                "primeira_resposta": _estat(v["tempos"]),
            }
        )
    por_numero.sort(key=lambda x: (-x["conversas"], x["rotulo"]))

    return {
        "days": days,
        "desde": desde.isoformat(),
        "totais": {
            "conversas": total,
            "conversas_hoje": hoje,
            "atendimentos": atend,
            "abordagens": abord,
            "respondidas_por_humano": sum(1 for r in resumos if r.primeira_resposta_s is not None),
            "respondidas_pela_ia": sum(1 for r in resumos if r.primeira_resposta_ia_s is not None),
        },
        "tempos": {
            "primeira_resposta": _estat([r.primeira_resposta_s for r in resumos if r.primeira_resposta_s is not None]),
            "primeira_resposta_ia": _estat([r.primeira_resposta_ia_s for r in resumos if r.primeira_resposta_ia_s is not None]),
            "duracao": _estat([r.duracao_s for r in resumos if r.duracao_s is not None]),
        },
        "por_pessoa": por_pessoa,
        "por_numero": por_numero,
        "por_dia": [{"dia": d, **v} for d, v in sorted(por_dia.items())],
        "definicoes": {
            "atendimento": "conversa com ao menos uma mensagem enviada por uma pessoa (painel ou celular)",
            "abordagem": "conversa cuja primeira mensagem foi nossa, enviada por uma pessoa",
            "primeira_resposta": "da primeira mensagem do contato até a primeira resposta de uma pessoa",
            "por_pessoa": "pela identidade (member_id), nunca pelo nome",
        },
    }


async def calcular(db: AsyncSession, tenant_id: int, days: int = 30) -> dict:
    """Lê o tenant e devolve o bloco de métricas (ver o topo do módulo)."""
    days = max(1, min(int(days or 30), 365))
    agora = datetime.utcnow()
    desde = agora - timedelta(days=days)
    hoje_local = datetime.now(FUSO).replace(hour=0, minute=0, second=0, microsecond=0)
    hoje_inicio_utc = hoje_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

    agent_ids = [r[0] for r in (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))).all()]
    convs = []
    if agent_ids:
        convs = (
            await db.execute(
                select(
                    TaConversation.id, TaConversation.connector_id, TaConversation.assigned_member_id,
                    TaConversation.started_at,
                ).where(TaConversation.agent_id.in_(agent_ids), TaConversation.started_at >= desde)
            )
        ).all()
    por_conv: dict[int, list[Msg]] = defaultdict(list)
    ids = [c[0] for c in convs]
    for i in range(0, len(ids), 2000):
        lote = ids[i : i + 2000]
        rows = (
            await db.execute(
                select(TaMessageLog.conversation_id, TaMessageLog.role, TaMessageLog.member_id, TaMessageLog.created_at)
                .where(TaMessageLog.conversation_id.in_(lote), TaMessageLog.role.in_((HUMANO, CONTATO, IA)))
                .order_by(TaMessageLog.id.asc())
            )
        ).all()
        for cid, role, mid, em in rows:
            if em is not None:
                por_conv[cid].append(Msg(role, mid, em))
    resumos = [resumir(c[0], c[1], c[2], c[3], por_conv.get(c[0], [])) for c in convs]

    membros = {
        m.id: {"nome": m.nome, "papel": m.role, "origem": ("erp" if m.erp_owner_id else "agent")}
        for m in (await db.execute(select(TaMember).where(TaMember.tenant_id == tenant_id))).scalars().all()
    }
    from services import numeros as numeros_svc

    numeros = {n["id"]: n for n in await numeros_svc.numeros_do_tenant(db, tenant_id)}
    return agregar(resumos, membros=membros, numeros=numeros, desde=desde, hoje_inicio_utc=hoje_inicio_utc, days=days)

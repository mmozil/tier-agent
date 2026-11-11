"""Relatório do WhatsApp OFICIAL (Cloud API) — volume, entrega, cobrança da Meta (12/11/2026).

Pedido do dono: «em relatórios criar uma parte para termos as infos de tudo… até das mensagens que
temos, contando as gratuitas». Junta, por número oficial e no total do tenant:

- **Enviadas por nós** e **recebidas dos contatos** — o registro das conversas (`ta_message_log`,
  conversas `whatsapp_cloud`). Vale para todo o histórico.
- **Funil de entrega** (enviada → entregue → lida; falhas e os motivos) — `ta_wa_envio_status`, que o
  webhook de status preenche desde 11/11/2026 (885e46b). Antes disso não há linha.
- **Cobrança da Meta** — o objeto `pricing` de cada status, gravado desde este módulo (colunas
  `cobravel`/`tipo_preco`/`categoria_preco`…). Mensagem sem `pricing` aparece como «sem dado de
  cobrança», nunca como grátis nem como paga.
- **Anúncio** — mensagem que CHEGA de anúncio Click-to-WhatsApp traz `referral` (o payload cru fica
  em `ta_webhook_event`); e a resposta nossa dentro da janela grátis do anúncio vem com
  `pricing.type = free_entry_point`.
- **Custo estimado** em R$ — só das PAGAS (`pricing.type = regular`) para número brasileiro, pela
  tabela BRL da Meta (`TARIFA_BRL_BR`). É estimativa: a fatura da Meta é a verdade.

O que a Meta diz (doc oficial, lida em 11/11/2026):
- Cobrança por mensagem ENTREGUE desde 01/07/2025; desde 01/10/2026 a mensagem de serviço e a de
  utilidade dentro da janela de 24 h são cobradas. Grátis hoje: (1) as primeiras 1.000 mensagens de
  serviço por número por mês (`free_customer_service`); (2) tudo na janela de anúncio, que fica aberta
  «até 7 dias» (`free_entry_point`). https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- `pricing` aparece uma vez por mensagem — no `sent` OU num `delivered`/`read` —; nunca no `failed`.
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
"""

from __future__ import annotations

import json
import logging
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaWaEnvioStatus, TaWebhookEvent

logger = logging.getLogger(__name__)

FUSO = ZoneInfo("America/Sao_Paulo")
UTC = ZoneInfo("UTC")

# ───────────────────────── tabela de preço (Brasil, BRL) ─────────────────────────

# R$ por mensagem ENTREGUE a número +55, vigente desde 01/10/2026 (o Brasil não está entre os
# mercados que mudaram nessa data). Linha do rate card BRL da Meta: marketing 0,3217 · utilidade
# 0,0350 · autenticação 0,0350. Serviço = «a mesma tarifa de utilidade e autenticação do mercado»
# (página «non-template messages»), sem desconto por volume. Desconto por volume de utilidade e
# autenticação (a partir de 250 mil / 500 mil por mês) NÃO é aplicado aqui — fica fora da escala.
TARIFA_BRL_BR: dict[str, Decimal] = {
    "marketing": Decimal("0.3217"),
    "utility": Decimal("0.0350"),
    "authentication": Decimal("0.0350"),
    "service": Decimal("0.0350"),
}
FONTE_TARIFA = {
    "moeda": "BRL",
    "mercado": "Brasil (+55)",
    "vigencia": "2026-10-01",
    "conferido_em": "2026-11-11",
    "url": "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rate-cards-and-volume-tiers",
    "url_servico": "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages",
    "observacao": (
        "Estimativa pela tabela pública, sem desconto por volume. A fatura da Meta é a verdade; "
        "marketing pela Marketing Messages API (preço por lance) não entra."
    ),
}
FRANQUIA_SERVICO_MES = 1000  # mensagens de serviço grátis por número por mês (desde 01/10/2026)

# ───────────────────────── rótulos ─────────────────────────

CATEGORIAS_PT = {
    "marketing": "Marketing",
    "utility": "Utilidade",
    "authentication": "Autenticação",
    "authentication-international": "Autenticação internacional",
    "authentication_international": "Autenticação internacional",
    "service": "Serviço",
    "marketing_lite": "Marketing (API de marketing)",
    "referral_conversion": "Janela de anúncio",
    "group_marketing": "Grupo · marketing",
    "group_utility": "Grupo · utilidade",
    "group_service": "Grupo · serviço",
}
TIPOS_PT = {
    "regular": "Paga",
    "free_customer_service": "Grátis · franquia de serviço",
    "free_entry_point": "Grátis · janela de anúncio",
    "free_group_customer_service": "Grátis · grupo",
}
# Motivos de falha do CONTATO (os do número/conta estão em disparo_oficial.CODIGOS_CONTA).
# Tabela oficial: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
MOTIVOS_PT = {
    130472: "não enviada por experimento de marketing da Meta",
    131000: "erro desconhecido na Meta",
    131021: "remetente e destinatário são o mesmo número",
    131026: "não entregável (sem WhatsApp, app antigo ou termos não aceitos)",
    131047: "passou de 24 h desde a última mensagem do contato",
    131049: "segurada pela Meta para preservar o engajamento (limite de marketing)",
    131050: "o contato parou de receber marketing desta empresa",
    131051: "tipo de mensagem não suportado",
    131053: "falha ao enviar a mídia",
    131056: "mensagens demais para o mesmo contato em pouco tempo",
}


def rotulo_categoria(c: str | None) -> str:
    return CATEGORIAS_PT.get(c or "", c or "sem dado")


def rotulo_tipo(t: str | None) -> str:
    return TIPOS_PT.get(t or "", t or "sem dado")


def motivo_falha(codigo: int | None, texto: str | None) -> str:
    from services.disparo_oficial import CODIGOS_CONTA

    if codigo is not None and codigo in MOTIVOS_PT:
        return MOTIVOS_PT[codigo]
    if codigo is not None and codigo in CODIGOS_CONTA:
        return CODIGOS_CONTA[codigo]
    return (texto or "").strip() or "sem motivo informado"


# ───────────────────────── regras puras (testadas sem banco) ─────────────────────────


def e_paga(tipo: str | None, cobravel: bool | None) -> bool | None:
    """Paga? `pricing.type` decide (a Meta avisa que `billable` vai sair); sem tipo, `billable`.
    None = sem dado de cobrança."""
    if tipo:
        return tipo == "regular"
    if cobravel is not None:
        return bool(cobravel)
    return None


def custo_estimado(categoria: str | None, destino_br: bool) -> Decimal | None:
    """R$ de UMA mensagem paga, ou None quando não dá para estimar (fora do Brasil, categoria sem
    tarifa fixa — ex.: marketing pela API de marketing)."""
    if not destino_br:
        return None
    return TARIFA_BRL_BR.get(categoria or "")


def periodo(dias: int, agora_utc: datetime | None = None) -> tuple[datetime, datetime, str, str]:
    """(desde_utc, ate_utc, de_local, ate_local): os `dias` de calendário em Brasília que terminam
    hoje. «30 dias» = de 00:00 de 29 dias atrás até agora. UTC sem fuso, como o banco."""
    dias = max(1, min(int(dias or 30), 365))
    agora_utc = agora_utc or datetime.utcnow()
    agora_local = agora_utc.replace(tzinfo=UTC).astimezone(FUSO)
    inicio_local = (agora_local - timedelta(days=dias - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    desde = inicio_local.astimezone(UTC).replace(tzinfo=None)
    return desde, agora_utc, inicio_local.date().isoformat(), agora_local.date().isoformat()


def _bloco_vazio() -> dict:
    return {
        "enviadas_registro": 0,
        "recebidas": 0,
        "com_status_meta": 0,
        "funil": {"aguardando": 0, "enviadas": 0, "entregues": 0, "lidas": 0, "falhas": 0},
        "cobranca": {
            "com_dado": 0,
            "pagas": 0,
            "gratis": 0,
            "por_tipo": Counter(),
            "por_categoria": defaultdict(lambda: {"total": 0, "pagas": 0, "gratis": 0, "custo": Decimal("0")}),
            "custo": Decimal("0"),
            "pagas_sem_estimativa": 0,
        },
        "falhas": Counter(),
        "anuncio": {"contatos": set(), "mensagens": 0, "na_janela_gratis": 0, "contatos_na_janela_gratis": set()},
        "servico_mes": {"gratis": 0, "pagas": 0},
    }


def somar_status(bloco: dict, linha: dict) -> None:
    """Soma UMA linha de `ta_wa_envio_status` (já agregada: `n` = quantas iguais) no bloco. Puro.
    `destino_br` = contato +55 (tem tarifa na tabela); `no_mes` = enviada no mês corrente (franquia)."""
    n = int(linha.get("n") or 1)
    st = (linha.get("status") or "").lower()
    bloco["com_status_meta"] += n
    f = bloco["funil"]
    if st == "accepted":
        f["aguardando"] += n
    elif st == "failed":
        f["falhas"] += n
        bloco["falhas"][(linha.get("erro_codigo"), (linha.get("erro") or "")[:200])] += n
    elif st in ("sent", "delivered", "read"):
        f["enviadas"] += n
        if st in ("delivered", "read"):
            f["entregues"] += n
        if st == "read":
            f["lidas"] += n
    tipo, cat = linha.get("tipo_preco"), linha.get("categoria_preco")
    paga = e_paga(tipo, linha.get("cobravel"))
    if paga is None:
        return
    c = bloco["cobranca"]
    c["com_dado"] += n
    c["por_tipo"][tipo or ("regular" if paga else "gratis_sem_tipo")] += n
    pc = c["por_categoria"][cat or "sem_categoria"]
    pc["total"] += n
    if paga:
        c["pagas"] += n
        pc["pagas"] += n
        unit = custo_estimado(cat, bool(linha.get("destino_br")))
        if unit is None:
            c["pagas_sem_estimativa"] += n
        else:
            c["custo"] += unit * n
            pc["custo"] += unit * n
    else:
        c["gratis"] += n
        pc["gratis"] += n
    if tipo == "free_entry_point":
        bloco["anuncio"]["na_janela_gratis"] += n
    if cat == "service" and linha.get("no_mes"):
        bloco["servico_mes"]["pagas" if paga else "gratis"] += n


def _pct(a: int, b: int) -> float | None:
    return round(a / b, 4) if b else None


def fechar_bloco(bloco: dict, *, cobranca_desde: str | None) -> dict:
    """Transforma o acumulador em JSON (Counter/Decimal/set → listas e números). Puro."""
    f = bloco["funil"]
    base_entrega = f["enviadas"] + f["falhas"]
    c = bloco["cobranca"]
    com_dado = c["com_dado"]
    # «Sem dado de cobrança»: o que saiu mas não trouxe `pricing` — antes de gravarmos, ainda sem
    # retorno, ou falha (a Meta não cobra falha e não manda `pricing` nela).
    saidas = max(bloco["enviadas_registro"], bloco["com_status_meta"])
    falhas = sorted(bloco["falhas"].items(), key=lambda kv: -kv[1])[:8]
    cats = []
    for k, v in c["por_categoria"].items():
        cats.append(
            {
                "categoria": k,
                "rotulo": rotulo_categoria(None if k == "sem_categoria" else k),
                "total": v["total"],
                "pagas": v["pagas"],
                "gratis": v["gratis"],
                "custo_estimado": float(round(v["custo"], 2)),
            }
        )
    cats.sort(key=lambda x: (-x["total"], x["rotulo"]))
    tipos = [
        {"tipo": k, "rotulo": "Grátis (sem tipo)" if k == "gratis_sem_tipo" else rotulo_tipo(k), "n": v}
        for k, v in sorted(c["por_tipo"].items(), key=lambda kv: -kv[1])
    ]
    an = bloco["anuncio"]
    return {
        "enviadas_registro": bloco["enviadas_registro"],
        "recebidas": bloco["recebidas"],
        "com_status_meta": bloco["com_status_meta"],
        "funil": {
            **f,
            "taxa_entrega": _pct(f["entregues"], base_entrega),
            "taxa_leitura": _pct(f["lidas"], f["entregues"]),
        },
        "falhas_motivos": [
            {"codigo": cod, "motivo": motivo_falha(cod, txt), "texto_meta": txt or None, "n": n}
            for (cod, txt), n in falhas
        ],
        "cobranca": {
            "com_dado": com_dado,
            "sem_dado": max(0, saidas - com_dado),
            "cobranca_desde": cobranca_desde,
            "pagas": c["pagas"],
            "gratis": c["gratis"],
            "por_tipo": tipos,
            "por_categoria": cats,
            "custo_estimado": float(round(c["custo"], 2)),
            "pagas_sem_estimativa": c["pagas_sem_estimativa"],
        },
        "anuncio": {
            "contatos": len(an["contatos"]),
            "mensagens": an["mensagens"],
            "respostas_na_janela_gratis": an["na_janela_gratis"],
            "contatos_na_janela_gratis": len(an["contatos_na_janela_gratis"]),
        },
        "franquia_servico_mes": {
            "limite": FRANQUIA_SERVICO_MES,
            "gratis": bloco["servico_mes"]["gratis"],
            "pagas": bloco["servico_mes"]["pagas"],
        },
    }


def referral_da_mensagem(payload) -> tuple[str | None, dict | None]:
    """(wa_id do contato, referral) de uma mensagem crua do webhook da Cloud, ou (None, None).
    `referral` só vem em mensagem originada de anúncio Click-to-WhatsApp (doc «text messages»)."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return None, None
    if not isinstance(payload, dict):
        return None, None
    ref = payload.get("referral")
    if not isinstance(ref, dict):
        return None, None
    return (str(payload.get("from") or "") or None), ref


# ───────────────────────── leitura do banco ─────────────────────────


async def numeros_oficiais(db: AsyncSession, tenant_id: int) -> list[dict]:
    """[{id, rotulo, agente}] dos números oficiais (Cloud) do tenant — o filtro da tela."""
    from services import numeros as numeros_svc

    agentes = dict((await db.execute(select(TaAgent.id, TaAgent.nome).where(TaAgent.tenant_id == tenant_id))).all())
    out = []
    for n in await numeros_svc.numeros_do_tenant(db, tenant_id):
        if n["kind"] == "whatsapp_cloud":
            out.append({"id": n["id"], "rotulo": n["rotulo"], "agente": agentes.get(n["agent_id"])})
    return out


async def calcular(db: AsyncSession, tenant_id: int, dias: int = 30, connector_id: int | None = None) -> dict:
    desde, ate, de_local, ate_local = periodo(dias)
    agora_local = ate.replace(tzinfo=UTC).astimezone(FUSO)
    inicio_mes_utc = (
        agora_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(UTC).replace(tzinfo=None)
    )
    numeros = await numeros_oficiais(db, tenant_id)
    ids = [n["id"] for n in numeros]
    if connector_id is not None:
        if connector_id not in ids:
            return {"erro": "numero_nao_encontrado"}
        ids = [connector_id]
    rotulos = {n["id"]: n["rotulo"] for n in numeros}
    blocos: dict[int | None, dict] = defaultdict(_bloco_vazio)
    for cid in ids:  # número sem movimento aparece com zero, não some
        blocos[cid]
    agent_ids = [r[0] for r in (await db.execute(select(TaAgent.id).where(TaAgent.tenant_id == tenant_id))).all()]

    # 1. Registro das conversas: enviadas (IA + equipe + disparo) e recebidas, por número.
    if agent_ids:
        conds = [
            TaConversation.agent_id.in_(agent_ids),
            TaConversation.connector_kind == "whatsapp_cloud",
            TaMessageLog.created_at >= desde,
            TaMessageLog.role.in_(("user", "assistant", "agent")),
        ]
        if connector_id is not None:
            conds.append(TaConversation.connector_id == connector_id)
        rows = (
            await db.execute(
                select(TaConversation.connector_id, TaMessageLog.role, func.count(TaMessageLog.id))
                .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
                .where(*conds)
                .group_by(TaConversation.connector_id, TaMessageLog.role)
            )
        ).all()
        for cid, role, n in rows:
            b = blocos[cid]
            if role == "user":
                b["recebidas"] += int(n)
            else:
                b["enviadas_registro"] += int(n)

    # 2. Retorno da Meta: status + cobrança, agregado no banco.
    T = TaWaEnvioStatus
    cobranca_desde = None
    if ids:
        # O CASE com parâmetro fica numa subconsulta e o GROUP BY é pelas colunas dela: não depende
        # de o Postgres reconhecer duas cópias da mesma expressão com parâmetro. (Conferido em
        # Postgres 18 + asyncpg, 11/11/2026 — esta forma e a repetida funcionam; o teste usa SQLite.)
        base = (
            select(
                T.id,
                T.connector_id,
                T.status,
                T.tipo_preco,
                T.categoria_preco,
                T.cobravel,
                case((T.destino.like("55%"), True), else_=False).label("destino_br"),
                case((T.criado_em >= inicio_mes_utc, True), else_=False).label("no_mes"),
                T.erro_codigo,
                T.erro,
            )
            .where(T.connector_id.in_(ids), T.criado_em >= desde)
            .subquery()
        )
        grupo = [
            base.c.connector_id,
            base.c.status,
            base.c.tipo_preco,
            base.c.categoria_preco,
            base.c.cobravel,
            base.c.destino_br,
            base.c.no_mes,
            base.c.erro_codigo,
            base.c.erro,
        ]
        rows = (await db.execute(select(*grupo, func.count(base.c.id)).group_by(*grupo))).all()
        for cid, st, tipo, cat, cob, br, mes, cod, err, n in rows:
            somar_status(
                blocos[cid],
                {
                    "status": st,
                    "tipo_preco": tipo,
                    "categoria_preco": cat,
                    "cobravel": cob,
                    "destino_br": bool(br),
                    "no_mes": bool(mes),
                    "erro_codigo": cod,
                    "erro": err,
                    "n": n,
                },
            )
        # Contatos distintos respondidos dentro da janela grátis de anúncio.
        for cid, dest in (
            await db.execute(
                select(T.connector_id, T.destino)
                .where(T.connector_id.in_(ids), T.criado_em >= desde, T.tipo_preco == "free_entry_point")
                .distinct()
            )
        ).all():
            if dest:
                blocos[cid]["anuncio"]["contatos_na_janela_gratis"].add(dest)
        primeiro = (
            await db.execute(
                select(func.min(T.criado_em)).where(
                    T.connector_id.in_(ids), (T.tipo_preco.isnot(None)) | (T.cobravel.isnot(None))
                )
            )
        ).scalar()
        if primeiro:
            cobranca_desde = primeiro.replace(tzinfo=UTC).astimezone(FUSO).date().isoformat()

    # 3. Chegaram por anúncio (`referral`). O payload cru da mensagem não diz o número: casa o
    #    contato com a conversa dele num número oficial DESTE tenant (sem conversa aqui, não conta).
    anuncios: Counter = Counter()
    if agent_ids:
        refs = (
            (
                await db.execute(
                    select(TaWebhookEvent.payload_json).where(
                        TaWebhookEvent.source == "whatsapp-cloud",
                        TaWebhookEvent.processed_at >= desde,
                        cast(TaWebhookEvent.payload_json, String).like('%"referral"%'),
                    )
                )
            )
            .scalars()
            .all()
        )
        por_contato: dict[str, list[dict]] = defaultdict(list)
        for p in refs:
            wa, ref = referral_da_mensagem(p)
            if wa and ref:
                por_contato[wa].append(ref)
        if por_contato:
            conds = [
                TaConversation.agent_id.in_(agent_ids),
                TaConversation.connector_kind == "whatsapp_cloud",
                TaConversation.external_id.in_(list(por_contato)),
            ]
            if connector_id is not None:
                conds.append(TaConversation.connector_id == connector_id)
            dono: dict[str, int | None] = {}
            for ext, cid in (
                await db.execute(
                    select(TaConversation.external_id, TaConversation.connector_id)
                    .where(*conds)
                    .order_by(TaConversation.last_message_at.asc())
                )
            ).all():
                dono[ext] = cid  # a mais recente vence
            for wa, lista in por_contato.items():
                if wa not in dono:
                    continue
                b = blocos[dono[wa]]
                b["anuncio"]["contatos"].add(wa)
                b["anuncio"]["mensagens"] += len(lista)
                for ref in lista:
                    chave = (str(ref.get("source_id") or ""), (ref.get("headline") or ref.get("body") or "")[:80])
                    anuncios[chave] += 1

    # 4. Total + por número.
    total = _bloco_vazio()
    for b in blocos.values():
        _juntar(total, b)
    por_numero = []
    for cid, b in blocos.items():
        por_numero.append(
            {
                "connector_id": cid,
                "rotulo": rotulos.get(cid) or ("número não identificado" if cid is None else f"#{cid}"),
                **fechar_bloco(b, cobranca_desde=cobranca_desde),
            }
        )
    por_numero.sort(key=lambda x: (x["connector_id"] is None, -x["enviadas_registro"] - x["recebidas"]))
    return {
        "periodo": {
            "dias": max(1, min(int(dias or 30), 365)),
            "de": de_local,
            "ate": ate_local,
            "fuso": "America/Sao_Paulo",
        },
        "numeros": numeros,
        "connector_id": connector_id,
        "total": fechar_bloco(total, cobranca_desde=cobranca_desde),
        "por_numero": por_numero,
        "anuncios": [
            {"anuncio_id": k[0] or None, "titulo": k[1] or None, "mensagens": n} for k, n in anuncios.most_common(5)
        ],
        "tarifa": {**FONTE_TARIFA, "por_categoria": {k: float(v) for k, v in TARIFA_BRL_BR.items()}},
        "definicoes": DEFINICOES,
    }


def _juntar(dst: dict, src: dict) -> None:
    dst["enviadas_registro"] += src["enviadas_registro"]
    dst["recebidas"] += src["recebidas"]
    dst["com_status_meta"] += src["com_status_meta"]
    for k, v in src["funil"].items():
        dst["funil"][k] += v
    dst["falhas"].update(src["falhas"])
    cs, cd = src["cobranca"], dst["cobranca"]
    for k in ("com_dado", "pagas", "gratis", "pagas_sem_estimativa"):
        cd[k] += cs[k]
    cd["custo"] += cs["custo"]
    cd["por_tipo"].update(cs["por_tipo"])
    for k, v in cs["por_categoria"].items():
        alvo = cd["por_categoria"][k]
        for kk in ("total", "pagas", "gratis", "custo"):
            alvo[kk] += v[kk]
    dst["anuncio"]["contatos"] |= src["anuncio"]["contatos"]
    dst["anuncio"]["contatos_na_janela_gratis"] |= src["anuncio"]["contatos_na_janela_gratis"]
    dst["anuncio"]["mensagens"] += src["anuncio"]["mensagens"]
    dst["anuncio"]["na_janela_gratis"] += src["anuncio"]["na_janela_gratis"]
    for k in ("gratis", "pagas"):
        dst["servico_mes"][k] += src["servico_mes"][k]


DEFINICOES = {
    "enviadas_registro": "mensagens nossas (IA, equipe e disparo) gravadas nas conversas do número oficial",
    "com_status_meta": "mensagens com retorno de entrega da Meta (gravamos desde 11/11/2026)",
    "entregue": "a Meta confirmou a entrega no aparelho; «lida» depende da confirmação de leitura ligada no contato",
    "paga": "pricing.type = regular no webhook da Meta (desde 01/10/2026 inclui serviço após a franquia e utilidade na janela de 24 h)",
    "gratis_franquia": "pricing.type = free_customer_service — dentro das 1.000 mensagens de serviço grátis do mês, por número",
    "gratis_anuncio": "pricing.type = free_entry_point — dentro da janela grátis aberta por anúncio Click-to-WhatsApp (até 7 dias)",
    "sem_dado": "a Meta não mandou cobrança: mensagem de antes de gravarmos, ainda sem retorno, ou falha (falha não é cobrada)",
    "chegou_por_anuncio": "mensagem do contato com `referral` (anúncio Click-to-WhatsApp)",
    "custo_estimado": "pagas × tabela BRL da Meta para +55; sem desconto por volume; a fatura da Meta é a verdade",
}


# ───────────────────────── número OFICIAL da Meta (pricing_analytics) ─────────────────────────

TTL_META_S = 900  # 15 min — a Meta diz que o dado é aproximado; não precisa bater a cada clique
_cache_meta: dict[tuple, tuple[float, dict]] = {}
URL_ANALYTICS = "https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#pricing-analytics"


def somar_pricing_analytics(resposta: dict, telefone: str | None) -> dict:
    """Soma os `data_points` de `pricing_analytics` por tipo e categoria. Com `telefone`, só os
    pontos daquele número (a chamada pede a dimensão PHONE). Se nenhum ponto casar com o telefone
    (formato diferente), soma a conta inteira e diz isso em `so_deste_numero=False`. Puro."""
    alvo = "".join(ch for ch in (telefone or "") if ch.isdigit())
    pontos = [
        p
        for bloco in ((resposta or {}).get("pricing_analytics") or {}).get("data") or []
        for p in (bloco.get("data_points") or [])
        if isinstance(p, dict)
    ]
    deste = [
        p for p in pontos if alvo and "".join(ch for ch in str(p.get("phone_number") or "") if ch.isdigit()) == alvo
    ]
    if deste:
        pontos = deste
    por_tipo: Counter = Counter()
    por_cat: Counter = Counter()
    custo_tipo: defaultdict = defaultdict(float)
    custo = 0.0
    tem_custo = False
    for p in pontos:
        v = int(p.get("volume") or 0)
        t = str(p.get("pricing_type") or "").lower() or "sem_tipo"
        por_tipo[t] += v
        por_cat[str(p.get("pricing_category") or "").lower() or "sem_categoria"] += v
        if p.get("cost") is not None:
            tem_custo = True
            custo += float(p["cost"])
            custo_tipo[t] += float(p["cost"])
    return {
        "volume": sum(por_tipo.values()),
        "custo": round(custo, 2) if tem_custo else None,
        "so_deste_numero": bool(deste),
        "por_tipo": [
            {"tipo": k, "rotulo": rotulo_tipo(k), "n": n, "custo": round(custo_tipo[k], 2) if tem_custo else None}
            for k, n in por_tipo.most_common()
        ],
        "por_categoria": [{"categoria": k, "rotulo": rotulo_categoria(k), "n": n} for k, n in por_cat.most_common()],
    }


async def _pedir_pricing_analytics(cfg: dict, inicio: int, fim: int) -> dict:
    """GET só de leitura em `/{waba_id}?fields=pricing_analytics…` (permissão
    `whatsapp_business_management`, a mesma que já lista os modelos). Ponto único para o teste trocar."""
    import httpx

    from services.connectors.adapters.whatsapp_cloud import GRAPH_BASE

    campo = (
        f"pricing_analytics.start({inicio}).end({fim}).granularity(DAILY)"
        ".dimensions(PHONE,PRICING_CATEGORY,PRICING_TYPE)"
    )
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.get(
            f"{GRAPH_BASE}/{cfg['waba_id']}",
            params={"fields": campo},
            headers={"Authorization": f"Bearer {cfg['token']}"},
        )
    if r.status_code >= 400:
        from services.connectors.adapters.whatsapp_cloud import erro_da_meta

        codigo, texto = erro_da_meta(r)
        raise RuntimeError(f"{codigo or r.status_code}: {texto or r.text[:200]}")
    return r.json()


async def da_meta(db: AsyncSession, tenant_id: int, connector_id: int, dias: int = 30) -> dict:
    """O número da PRÓPRIA Meta para o período (volume e custo por tipo/categoria), com cache.
    Nunca levanta: sem permissão, sem conta ou Meta fora → `disponivel=False` com o motivo."""
    from core.encryption import decrypt

    conn = await db.get(TaConnector, connector_id)
    agente = await db.get(TaAgent, conn.agent_id) if conn else None
    if not conn or not agente or agente.tenant_id != tenant_id or conn.kind != "whatsapp_cloud":
        return {"disponivel": False, "motivo": "numero_nao_encontrado"}
    try:
        cfg = json.loads(decrypt(conn.config_json_enc))
    except Exception:  # noqa: BLE001
        cfg = {}
    if not cfg.get("waba_id") or not cfg.get("token"):
        return {"disponivel": False, "motivo": "Número oficial sem conta ou chave da Meta"}
    desde, ate, de_local, ate_local = periodo(dias)
    inicio, fim = int(desde.replace(tzinfo=UTC).timestamp()), int(ate.replace(tzinfo=UTC).timestamp())
    chave = (connector_id, de_local, ate_local)
    agora = time.monotonic()
    hit = _cache_meta.get(chave)
    if hit and hit[0] > agora:
        return hit[1]
    telefone = cfg.get("display_phone") or cfg.get("phone")
    base = {"periodo": {"de": de_local, "ate": ate_local}, "fonte": URL_ANALYTICS}
    try:
        resposta = await _pedir_pricing_analytics(cfg, inicio, fim)
    except Exception as e:  # noqa: BLE001 — o relatório nosso segue sem o da Meta
        logger.warning("pricing_analytics indisponível connector=%s: %s", connector_id, e)
        out = {**base, "disponivel": False, "motivo": f"A Meta não devolveu: {str(e)[:200]}"}
        _cache_meta[chave] = (agora + 60, out)
        return out
    out = {
        **base,
        "disponivel": True,
        **somar_pricing_analytics(resposta, telefone),
        "moeda": "na moeda da conta da Meta (a API não diz qual)",
        "aviso": "A Meta diz que é aproximado e pode diferir da fatura; conta só mensagens ENTREGUES.",
    }
    _cache_meta[chave] = (agora + TTL_META_S, out)
    return out

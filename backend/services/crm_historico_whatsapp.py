"""Mensagens AUTOMÁTICAS do WhatsApp oficial → histórico do card no CRM (12/11/2026, CCDA).

Pedido do dono: «na automação do No-show ou de mensagens, está no histórico do card? Se leu ou não
leu?» — não estava. Este ciclo leva ao ERP, para cada mensagem automática que saiu pelo número
oficial, o ENVIO e o que a Meta disse depois:

  enviada (hora do envio) · entregue · lida · não entregue (com o código da Meta)

Quais mensagens (as automáticas, não a conversa do dia a dia):
- MODELO que nós enviamos — disparo da página «Disparos», «Nova conversa com modelo» e o envio do
  ERP. Todas passam por `disparo_oficial.enviar_modelo`, que grava o status `accepted` JÁ COM a
  conversa (`ta_wa_envio_status.conversation_id`). As respostas normais do agente nascem pelo
  webhook, sem conversa — por isso `conversation_id IS NOT NULL` separa uma da outra.
  🚨 A mensagem do modelo na conversa NÃO guarda o wamid (medido: 0 de 92) — o texto vem da
  mensagem «Disparo · …»/«Modelo · …» da mesma conversa, gravada no mesmo instante.
- RETORNO PROGRAMADO (callback): mensagem com `model_used` «Callback · …» e o wamid gravado nela.
A resposta do agente e a da atendente ficam fora: estão na aba Conversas do card.

Como não repete: `ta_wa_envio_status.crm_hist_ordem` guarda até onde já foi levado (-1 nada,
0 a «enviada», 2 entregue, 3 lida, 9 não entregue); o ERP também não grava duas vezes o mesmo
(card, mensagem, evento). Lida pula «entregue» (quem leu recebeu). Só os últimos 30 dias.
Falha de rede → próximo ciclo; tenant sem conta no ERP → marcado como levado.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update

from models import TaConversation, TaDisparoOficial, TaDisparoOficialEnvio, TaMessageLog, TaWaEnvioStatus
from services.callbacks import MARCA_CALLBACK
from services.disparo_oficial import MARCA_DISPARO, MARCA_MODELO

logger = logging.getLogger(__name__)

JANELA = timedelta(days=30)
LOTE = 300
FOLGA_TEXTO = timedelta(minutes=2)  # a mensagem do modelo é gravada um instante ANTES do status


def origem_da_mensagem(model_used: str | None, nome_disparo: str | None) -> str:
    """De onde veio a mensagem, como o card mostra. Puro."""
    m = (model_used or "").strip()
    resto = m.split("·", 1)[1].strip() if "·" in m else ""
    if nome_disparo:
        return f"Disparo «{nome_disparo}»"
    if m.startswith(MARCA_DISPARO):
        return f"Disparo · modelo {resto}" if resto else "Disparo"
    if m.startswith(MARCA_MODELO):
        return f"Modelo «{resto}»" if resto else "Modelo de mensagem"
    if m.startswith(MARCA_CALLBACK):
        return "Retorno programado (callback)"
    return "Mensagem automática"


def eventos_pendentes(*, ordem_atual: int, levado: int) -> list[str]:
    """Quais eventos ainda faltam levar ao card. Puro.

    ordem: 0 accepted · 1 sent · 2 delivered · 3 read · 9 failed. levado: -1 nada · 0 enviada · 2 · 3 · 9."""
    faltam: list[str] = []
    if levado < 0:
        faltam.append("enviada")
    if ordem_atual == 9 and levado < 9:
        faltam.append("falhou")
    elif ordem_atual == 3 and levado < 3:
        faltam.append("lida")
    elif ordem_atual == 2 and levado < 2:
        faltam.append("entregue")
    return faltam


def novo_levado(ordem_atual: int, levado: int) -> int:
    return max(levado, ordem_atual if ordem_atual in (2, 3, 9) else 0)


def _telefone(*brutos: str | None) -> str:
    for b in brutos:
        d = re.sub(r"\D", "", (b or "").split("@")[0])
        if len(d) >= 10:
            return d
    return ""


def _iso(dt: datetime | None) -> str | None:
    return dt.replace(microsecond=0).isoformat() + "Z" if dt else None


def _pendente(S):
    return or_(S.crm_hist_ordem < 0, and_(S.ordem.in_((2, 3, 9)), S.ordem > S.crm_hist_ordem))


async def _modelos_pendentes(db) -> list[dict]:
    """Modelos enviados por nós (status nasceu com a conversa), com o texto da conversa."""
    S, E, D = TaWaEnvioStatus, TaDisparoOficialEnvio, TaDisparoOficial
    rows = (
        await db.execute(
            select(S.id, S.wamid, S.ordem, S.status_em, S.criado_em, S.erro_codigo, S.erro, S.destino,
                   S.crm_hist_ordem, S.tenant_id, S.conversation_id, TaConversation.external_id, D.nome)
            .join(TaConversation, TaConversation.id == S.conversation_id)
            .outerjoin(E, E.wamid == S.wamid)
            .outerjoin(D, D.id == E.disparo_id)
            .where(S.conversation_id.isnot(None), S.tenant_id.isnot(None),
                   S.criado_em >= datetime.utcnow() - JANELA, _pendente(S))
            .order_by(S.criado_em)
            .limit(LOTE)
        )
    ).all()
    if not rows:
        return []
    M = TaMessageLog
    msgs = (
        await db.execute(
            select(M.conversation_id, M.model_used, M.content, M.created_at)
            .where(M.conversation_id.in_({r.conversation_id for r in rows}), M.role == "agent",
                   or_(M.model_used.like(f"{MARCA_DISPARO} ·%"), M.model_used.like(f"{MARCA_MODELO} ·%")))
        )
    ).all()
    por_conv: dict[int, list] = defaultdict(list)
    for m in msgs:
        por_conv[m.conversation_id].append(m)
    saida = []
    for r in rows:
        # a mensagem do modelo mais recente gravada até o status nascer (+ folga)
        candidatas = [m for m in por_conv.get(r.conversation_id, []) if m.created_at and m.created_at <= r.criado_em + FOLGA_TEXTO]
        m = max(candidatas, key=lambda x: x.created_at) if candidatas else None
        saida.append({
            "id": r.id, "wamid": r.wamid, "ordem": int(r.ordem), "levado": int(r.crm_hist_ordem),
            "tenant_id": int(r.tenant_id), "telefone": _telefone(r.destino, r.external_id),
            "origem": origem_da_mensagem(m.model_used if m else None, r.nome),
            "texto": (m.content if m else None), "enviada_em": (m.created_at if m else r.criado_em),
            "status_em": r.status_em, "erro_codigo": r.erro_codigo, "erro": r.erro,
        })
    return saida


async def _callbacks_pendentes(db) -> list[dict]:
    S, M = TaWaEnvioStatus, TaMessageLog
    rows = (
        await db.execute(
            select(S.id, S.wamid, S.ordem, S.status_em, S.erro_codigo, S.erro, S.destino, S.crm_hist_ordem,
                   S.tenant_id, M.model_used, M.content, M.created_at, TaConversation.external_id)
            .join(M, M.wa_message_id == S.wamid)
            .join(TaConversation, TaConversation.id == M.conversation_id)
            .where(M.model_used.like(f"{MARCA_CALLBACK}%"), S.tenant_id.isnot(None),
                   M.created_at >= datetime.utcnow() - JANELA, _pendente(S))
            .limit(LOTE)
        )
    ).all()
    return [{
        "id": r.id, "wamid": r.wamid, "ordem": int(r.ordem), "levado": int(r.crm_hist_ordem),
        "tenant_id": int(r.tenant_id), "telefone": _telefone(r.destino, r.external_id),
        "origem": origem_da_mensagem(r.model_used, None), "texto": r.content, "enviada_em": r.created_at,
        "status_em": r.status_em, "erro_codigo": r.erro_codigo, "erro": r.erro,
    } for r in rows]


async def rodar_ciclo(db) -> dict:
    from services import erp_crm_client

    if not erp_crm_client.integracao_ativa():
        return {"levados": 0}
    itens = await _modelos_pendentes(db) + await _callbacks_pendentes(db)
    if not itens:
        return {"levados": 0}
    por_tenant: dict[int, list[dict]] = defaultdict(list)
    for it in itens:
        por_tenant[it["tenant_id"]].append(it)

    S = TaWaEnvioStatus
    levados = 0
    for tenant_id, lista in por_tenant.items():
        eventos: list[dict] = []
        for it in lista:
            if not it["telefone"]:
                continue
            for ev in eventos_pendentes(ordem_atual=it["ordem"], levado=it["levado"]):
                eventos.append({
                    "wamid": it["wamid"], "telefone": it["telefone"], "evento": ev, "origem": it["origem"],
                    "em": _iso(it["enviada_em"] if ev == "enviada" else (it["status_em"] or it["enviada_em"])),
                    "texto": (it["texto"] or "")[:4000] if ev == "enviada" else None,
                    "erro_codigo": it["erro_codigo"] if ev == "falhou" else None,
                    "erro": it["erro"] if ev == "falhou" else None,
                })
        try:
            if eventos:
                resp = await erp_crm_client.enviar_historico_whatsapp(agent_tenant_id=tenant_id, eventos=eventos)
                logger.info("historico whatsapp → CRM tenant=%s eventos=%s resp=%s", tenant_id, len(eventos), resp)
        except erp_crm_client.ErpCrmError:
            logger.warning("historico whatsapp → CRM falhou (tenant %s) — tenta no próximo ciclo", tenant_id, exc_info=True)
            continue
        for it in lista:
            await db.execute(
                update(S)
                .where(S.id == it["id"])
                .values(crm_hist_ordem=func.greatest(S.crm_hist_ordem, novo_levado(it["ordem"], it["levado"])))
                .execution_options(synchronize_session=False)
            )
            levados += 1
        await db.commit()
    return {"levados": levados}

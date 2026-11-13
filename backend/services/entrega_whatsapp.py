"""Tiques de entrega nos balões do número oficial — enviada · entregue · lida · não entregue (13/11/2026).

Pedido do CCDA (o Marcos): ver no balão, como no WhatsApp, se a mensagem chegou e se foi lida. A Meta já
manda isso por mensagem (`ta_wa_envio_status`, uma linha por wamid com o estado mais avançado).

🚨 A mensagem NOSSA no número oficial não guarda o wamid (medido 13/11: 0 de 409 em 2 dias — IA, painel e
modelo). O elo é a conversa + a hora: o status nasce segundos depois do envio (a resposta da IA é gravada
um instante ANTES de sair; o modelo também). Exato pelo wamid quando existir; senão, a mensagem nossa
mais próxima no tempo, até 2 min. Resposta em vários balões = vários status na mesma mensagem: falha
manda; senão vale o MENOS avançado (só é «lida» se todos foram lidos).

O motivo da falha sai em português: o caso que abriu isto foi o de 12/11 — 22 mensagens do painel não
chegaram (janela de 24 h fechada) e a tela dizia que tinham ido.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from sqlalchemy import or_, select

FOLGA = timedelta(minutes=2)
ROTULO = {0: "enviada", 1: "enviada", 2: "entregue", 3: "lida", 9: "falhou"}

MOTIVOS = {
    131047: "passaram 24 h desde a última mensagem da pessoa — agora só vai modelo aprovado",
    131049: "a Meta segurou a mensagem de marketing para não cansar a pessoa",
    130472: "o número está num teste da Meta que não recebe marketing",
    131026: "o número não recebe mensagens (sem WhatsApp, app antigo ou nos bloqueou)",
    131050: "a pessoa pediu para não receber marketing",
    131051: "tipo de mensagem não aceito",
    131053: "o arquivo não pôde ser enviado",
    131056: "muitas mensagens seguidas para o mesmo número — espere um pouco",
    132000: "as variáveis do modelo não batem com o modelo aprovado",
    132001: "o modelo não existe ou não está aprovado neste idioma",
}


def motivo(codigo: int | None, erro: str | None) -> str:
    if codigo in MOTIVOS:
        return MOTIVOS[codigo]
    texto = (erro or "").strip()
    return f"erro {codigo}: {texto}"[:160] if codigo else (texto[:160] or "a Meta não entregou")


def casar(
    mensagens: list[tuple[int, datetime | None, str | None]],
    statuses: list[tuple[str, datetime | None, int, int | None, str | None]],
) -> dict[int, dict]:
    """Regra pura. `mensagens` = só as NOSSAS: (id, criada_em, wamid). `statuses` = (wamid, criado_em,
    ordem, erro_codigo, erro). Devolve {id_da_mensagem: {"entrega": …, "entrega_erro": …}}."""
    por_wamid = {w: mid for mid, _, w in mensagens if w}
    sem_wamid = [(mid, t) for mid, t, w in mensagens if not w and t]
    juntos: dict[int, list[tuple[int, int | None, str | None]]] = {}
    for wamid, quando, ordem, codigo, erro in statuses:
        mid = por_wamid.get(wamid)
        if mid is None and quando and sem_wamid:
            perto_id, perto_t = min(sem_wamid, key=lambda x: abs((x[1] - quando).total_seconds()))
            if abs((perto_t - quando).total_seconds()) <= FOLGA.total_seconds():
                mid = perto_id
        if mid is not None:
            juntos.setdefault(mid, []).append((int(ordem), codigo, erro))
    saida: dict[int, dict] = {}
    for mid, lista in juntos.items():
        falha = next((x for x in lista if x[0] == 9), None)
        if falha:
            saida[mid] = {"entrega": "falhou", "entrega_erro": motivo(falha[1], falha[2])}
        else:
            saida[mid] = {"entrega": ROTULO.get(min(x[0] for x in lista), "enviada"), "entrega_erro": None}
    return saida


def _final(telefone: str | None) -> str | None:
    digitos = re.sub(r"\D", "", telefone or "")
    return digitos[-8:] if len(digitos) >= 8 else None


async def da_conversa(db, conv, msgs) -> dict[int, dict]:
    """Os tiques das mensagens nossas desta conversa. Só no número oficial; nunca derruba a tela."""
    from models import TaWaEnvioStatus as S

    if getattr(conv, "connector_kind", None) != "whatsapp_cloud":
        return {}
    nossas = [(m.id, m.created_at, m.wa_message_id) for m in msgs if m.role in ("agent", "assistant")]
    if not nossas:
        return {}
    horas = [t for _, t, _ in nossas if t]
    if not horas:
        return {}
    de, ate = min(horas) - FOLGA, max(horas) + FOLGA
    quem = [S.conversation_id == conv.id]
    final = _final(conv.external_id)
    if final and getattr(conv, "connector_id", None):
        quem.append((S.connector_id == conv.connector_id) & S.destino.like(f"%{final}"))
    wamids = [w for _, _, w in nossas if w]
    if wamids:
        quem.append(S.wamid.in_(wamids))
    rows = (
        await db.execute(
            select(S.wamid, S.criado_em, S.ordem, S.erro_codigo, S.erro)
            .where(or_(*quem), S.criado_em >= de, S.criado_em <= ate)
            .order_by(S.criado_em)
        )
    ).all()
    return casar(nossas, [(r[0], r[1], r[2], r[3], r[4]) for r in rows])

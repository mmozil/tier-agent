"""Quem está online agora — pessoa e número (27/11/2026, pedido do dono).

O `ta_member.online` NÃO serve para isso: é o botão manual do rodízio, e quase ninguém
mexe nele (medido 27/11: CCDA 1 de 17, M7 2 de 18). Mostrar ele como «online» diria que a
equipe inteira está fora.

Uma pessoa está ONLINE quando há sinal recente de qualquer um destes dois:

- **painel**: o Agent aberto, em uso (o navegador manda um sinal por minuto enquanto a aba
  está visível e a pessoa mexeu nos últimos 10 min — `visto_painel_em`);
- **resposta**: mandou mensagem a um contato (pelo painel ou pelo celular do número dela —
  as duas gravam `ta_message_log.member_id` com `role='agent'`).

Os dois sinais são necessários. Medido 27/11: na M7 o Vagner nunca abriu o Agent e
respondeu clientes pelo celular no mesmo dia; só pelo painel ele apareceria «offline».

Número: o estado da conexão vem do motor (ver `routes.connectors.status_ao_vivo_recente`),
não do gravado — o gravado só mudava quando alguém abria a página de números.
"""

from __future__ import annotations

import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Sinal do painel a cada 60 s; 150 s tolera um sinal perdido sem piscar.
PAINEL_ONLINE_S = 150
# Respondeu um contato há até 10 min = está trabalhando agora.
RESPOSTA_ONLINE_S = 600
# Para «visto por último» olhamos uma semana; mais que isso vira «sem atividade em 7 dias».
JANELA_VISTO_DIAS = 7
# Não regrava o sinal do painel se o último tem menos que isto (duas abas abertas).
PAINEL_REGRAVAR_S = 30
# Cada aba de Conversas lê a cada minuto; o resultado da conta vale 20 s para todas (28/11/2026).
CACHE_S = 20
_CACHE: dict[tuple, tuple[float, object]] = {}


def _guardado(chave: tuple):
    hit = _CACHE.get(chave)
    if hit and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    return None


def _guardar(chave: tuple, valor):
    if len(_CACHE) > 2000:  # nunca cresce sem limite
        _CACHE.clear()
    _CACHE[chave] = (time.monotonic(), valor)
    return valor


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def estado_da_pessoa(painel_s: int | None, resposta_s: int | None) -> dict:
    """Decisão pura (testável sem banco). Recebe há quantos segundos foi cada sinal
    (None = sem sinal na janela) e devolve `online`, `por` e `visto_s`."""
    if painel_s is not None and painel_s <= PAINEL_ONLINE_S:
        return {"online": True, "por": "painel", "visto_s": painel_s}
    if resposta_s is not None and resposta_s <= RESPOSTA_ONLINE_S:
        return {"online": True, "por": "resposta", "visto_s": resposta_s}
    sinais = [s for s in (painel_s, resposta_s) if s is not None]
    return {"online": False, "por": None, "visto_s": min(sinais) if sinais else None}


async def registrar_painel(db: AsyncSession, member_id: int) -> None:
    """Sinal do painel. SQL cru para não mexer em `updated_at` (o ORM atualiza no onupdate)."""
    await db.execute(
        text(
            "UPDATE ta_member SET visto_painel_em = now() WHERE id = :m"
            f" AND (visto_painel_em IS NULL OR visto_painel_em < now() - interval '{PAINEL_REGRAVAR_S} seconds')"
        ),
        {"m": member_id},
    )
    await db.commit()


async def pessoas_do_tenant(db: AsyncSession, tenant_id: int) -> list[dict]:
    chave = ("pessoas", tenant_id)
    if (hit := _guardado(chave)) is not None:
        return hit
    rows = (
        await db.execute(
            text(
                """
                SELECT m.id,
                       m.visto_painel_em,
                       EXTRACT(EPOCH FROM (now() - m.visto_painel_em))::int AS painel_s,
                       r.ult AS respondeu_em,
                       EXTRACT(EPOCH FROM (now() - r.ult))::int AS resposta_s
                  FROM ta_member m
                  LEFT JOIN (
                        SELECT l.member_id, max(l.created_at) AS ult
                          FROM ta_message_log l
                         WHERE l.role = 'agent'
                           AND l.created_at > now() - interval '{dias} days'
                           AND l.member_id IN (SELECT id FROM ta_member WHERE tenant_id = :t)
                         GROUP BY l.member_id
                  ) r ON r.member_id = m.id
                 WHERE m.tenant_id = :t AND m.status = 'active'
                """.replace("{dias}", str(JANELA_VISTO_DIAS))
            ),
            {"t": tenant_id},
        )
    ).all()
    janela = JANELA_VISTO_DIAS * 86400
    saida = []
    for r in rows:
        painel_s = r.painel_s if r.painel_s is not None and r.painel_s <= janela else None
        estado = estado_da_pessoa(painel_s, r.resposta_s)
        saida.append(
            {
                "member_id": r.id,
                **estado,
                "painel_em": _iso(r.visto_painel_em) if painel_s is not None else None,
                "respondeu_em": _iso(r.respondeu_em),
            }
        )
    return _guardar(chave, saida)


async def ultima_mensagem_por_numero(db: AsyncSession, connector_ids: list[int]) -> dict[int, str]:
    """Quando passou a última mensagem (de qualquer lado) por cada número, nos últimos 30 dias.
    Número caído não recebe nem manda — a data diz desde quando ele está parado."""
    if not connector_ids:
        return {}
    chave = ("ultima", tuple(sorted(connector_ids)))
    if (hit := _guardado(chave)) is not None:
        return hit
    rows = (
        await db.execute(
            text(
                "SELECT cv.connector_id, max(l.created_at) AS ult FROM ta_message_log l"
                " JOIN ta_conversation cv ON cv.id = l.conversation_id"
                " WHERE cv.connector_id = ANY(:ids) AND l.created_at > now() - interval '30 days'"
                " GROUP BY cv.connector_id"
            ),
            {"ids": list(connector_ids)},
        )
    ).all()
    return _guardar(chave, {r.connector_id: _iso(r.ult) for r in rows})

"""Registro de QUEM ABRIU cada conversa (31/10/2026).

Incidente da M7 (30/10/2026): consultores viram conversas uns dos outros e não havia como
responder «quem leu a conversa da Rebecca?». Zendesk e Intercom guardam esse registro; a
LGPD pede avaliar o alcance de um incidente — sem ele, não há o que avaliar.

Grava quem abriu (a tela da conversa, o card do CRM, a depuração) — no máximo UMA linha por
pessoa, conversa e via a cada 30 minutos: a tela aberta se atualiza sozinha a cada 10 s, e uma
linha por atualização encheria a tabela sem dizer nada a mais. Nunca derruba a tela: qualquer
erro vira log.

🚨 Usa a sessão de QUEM CHAMOU, dentro de um SAVEPOINT — não uma sessão própria. A 1ª versão abria
uma 2ª sessão com a do pedido ainda presa: numa rajada (simulação da conta fictícia), cada pedido
segurava uma conexão e esperava outra, e o pool esgotou. O SAVEPOINT garante que uma falha aqui
não estraga a transação do pedido.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)

VIAS = ("tela", "card_crm", "depuracao")
JANELA_MINUTOS = 30


async def registrar(
    db, *, tenant_id: int | None, conversation_ids, member_id: int | None, papel: str | None, via: str
) -> None:
    ids = sorted({int(c) for c in (conversation_ids or []) if c})
    if not tenant_id or not ids:
        return
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "INSERT INTO ta_acesso_conversa (tenant_id, conversation_id, member_id, papel, via)"
                    " SELECT CAST(:t AS INTEGER), c, CAST(:m AS INTEGER), CAST(:p AS VARCHAR), CAST(:v AS VARCHAR)"
                    " FROM unnest(CAST(:ids AS INTEGER[])) AS c"
                    " WHERE NOT EXISTS (SELECT 1 FROM ta_acesso_conversa a WHERE a.conversation_id = c"
                    " AND a.member_id IS NOT DISTINCT FROM CAST(:m AS INTEGER) AND a.via = CAST(:v AS VARCHAR)"
                    f" AND a.criado_em > now() - interval '{JANELA_MINUTOS} minutes')"
                ),
                {"t": tenant_id, "ids": ids, "m": member_id, "p": (papel or "owner")[:16], "v": via[:24]},
            )
        await db.commit()
    except Exception:  # noqa: BLE001 — registro de acesso nunca derruba a leitura
        logger.warning("registro de acesso falhou tenant=%s conversas=%s", tenant_id, ids[:5], exc_info=True)

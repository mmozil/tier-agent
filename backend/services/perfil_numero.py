"""De quem é o número? Confere o perfil do WhatsApp com a pessoa a quem ele foi atribuído (31/10/2026).

Incidente da M7: a regra de visão estava certa e o CADASTRO errado. O número 40 estava no nome
do Paulo, mas o WhatsApp era da Rebecca — 948 mensagens saíram com o perfil «Rebecca» — e a
regra entregava as 69 conversas dela a ele. Nada conferia o chip contra a pessoa.

Fonte: o `pushName` das mensagens que SAEM pelo número (fromMe) é o nome do perfil do próprio
WhatsApp. Avisa só quando o perfil tem o nome de OUTRA pessoa da equipe — perfil com o nome da
empresa («M7 Ambientes», «Colégio Carlos Drummond…») é número de equipe, não alarme. E só depois
de algumas mensagens seguidas com o mesmo perfil: um eco isolado com outro nome já apareceu
nos dados (4 de 235 no número da Marisa) e não pode virar acusação.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime

logger = logging.getLogger(__name__)

# Mensagens seguidas com o MESMO perfil antes de avisar.
VEZES_PARA_AVISAR = 5


def _palavras(texto: str | None) -> list[str]:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return [p for p in re.split(r"[^a-z]+", t) if len(p) >= 3]


def _primeiro_nome(nome: str | None) -> str | None:
    p = _palavras(nome)
    return p[0] if p else None


def conferir(perfil: str | None, dono_id: int | None, equipe: dict[int, str]) -> dict:
    """Decisão pura. `equipe` = {member_id: nome} das pessoas ATIVAS do tenant.

    confere: True (perfil tem o nome do dono) · False (tem o nome de OUTRA pessoa da equipe)
    · None (sem perfil visto, sem dono, ou perfil sem nome de ninguém — número da empresa).
    """
    if not perfil:
        return {"confere": None, "outra_pessoa": None, "motivo": "perfil do WhatsApp ainda não visto"}
    palavras = set(_palavras(perfil))
    dono = equipe.get(dono_id) if dono_id else None
    if dono and _primeiro_nome(dono) in palavras:
        return {"confere": True, "outra_pessoa": None, "motivo": None}
    outras = [nome for mid, nome in equipe.items() if mid != dono_id and _primeiro_nome(nome) in palavras]
    if outras and dono:
        return {
            "confere": False,
            "outra_pessoa": outras[0],
            "motivo": f"o WhatsApp deste número está no perfil «{perfil}», nome de {outras[0]}",
        }
    if outras:
        return {
            "confere": None,
            "outra_pessoa": outras[0],
            "motivo": f"número sem dono; o perfil «{perfil}» é de {outras[0]}",
        }
    return {"confere": None, "outra_pessoa": None, "motivo": "perfil sem nome de pessoa da equipe (número da empresa?)"}


async def equipe_do_tenant(db, tenant_id: int) -> dict[int, str]:
    from sqlalchemy import select

    from models import TaMember

    rows = (
        await db.execute(
            select(TaMember.id, TaMember.nome).where(TaMember.tenant_id == tenant_id, TaMember.status == "active")
        )
    ).all()
    return {r[0]: r[1] for r in rows}


async def observar(connector_id: int, perfil: str | None) -> None:
    """Chamado a cada mensagem que SAI pelo número. Guarda o perfil e, quando ele mostra outra
    pessoa da equipe por `VEZES_PARA_AVISAR` mensagens seguidas, avisa os gestores — uma vez
    por perfil. Sessão própria; erro vira log, nunca derruba o registro da mensagem."""
    perfil = (perfil or "").strip()[:200]
    if not perfil or not connector_id:
        return
    try:
        from core.db import db_context
        from models import TaAgent, TaConnector, TaMember, TaNotification

        async with db_context() as db:
            conn = await db.get(TaConnector, connector_id)
            if conn is None:
                return
            if conn.perfil_whatsapp == perfil:
                conn.perfil_vezes = (conn.perfil_vezes or 0) + 1
            else:
                conn.perfil_whatsapp, conn.perfil_vezes = perfil, 1
            conn.perfil_visto_em = datetime.utcnow()
            if conn.member_id and conn.perfil_vezes >= VEZES_PARA_AVISAR and conn.perfil_alertado != perfil:
                agent = await db.get(TaAgent, conn.agent_id)
                equipe = await equipe_do_tenant(db, agent.tenant_id) if agent else {}
                r = conferir(perfil, conn.member_id, equipe)
                if r["confere"] is False:
                    from sqlalchemy import select

                    dono = equipe.get(conn.member_id, "a pessoa cadastrada")
                    gestores = (
                        (
                            await db.execute(
                                select(TaMember.id).where(
                                    TaMember.tenant_id == agent.tenant_id,
                                    TaMember.role == "admin",
                                    TaMember.status == "active",
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )
                    titulo = f"Número de {dono} está com o WhatsApp de «{perfil}»"
                    corpo = (
                        f"As mensagens que saem por este número estão com o perfil «{perfil}», nome de "
                        f"{r['outra_pessoa']}. Enquanto o número estiver com {dono}, {dono} vê essas conversas. "
                        "O que fazer: confirme de quem é o chip e corrija o dono do número em Números."
                    )
                    # Só gestor: sem destinatário o aviso iria a toda a equipe. Sem gestor no tenant,
                    # destinatário 0 — nenhum membro tem id 0, então só o dono enxerga.
                    for alvo in list(gestores) or [0]:
                        db.add(
                            TaNotification(
                                tenant_id=agent.tenant_id,
                                agent_id=agent.id,
                                conversation_id=None,
                                category="error",
                                target_member_id=alvo,
                                title=titulo[:255],
                                body=corpo,
                                status="unread",
                                payload_json={
                                    "connector_id": conn.id,
                                    "perfil": perfil,
                                    "dono": dono,
                                    "outra_pessoa": r["outra_pessoa"],
                                    "tipo": "perfil_do_numero",
                                },
                            )
                        )
                    conn.perfil_alertado = perfil
                    logger.warning("perfil do número não bate: conector=%s dono=%s perfil=%s", conn.id, dono, perfil)
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("observar perfil do número falhou conector=%s", connector_id, exc_info=True)

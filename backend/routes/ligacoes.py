"""Ligações pelo WhatsApp oficial — atender pelo painel (14/11/2026). Regra e fluxo: services/ligacoes.py."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from services import ligacoes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ligacoes", tags=["ligacoes"])


class LigacaoOut(BaseModel):
    id: int
    conversation_id: int | None = None
    contato: str | None = None
    contato_nome: str | None = None
    estado: str
    direcao: str
    criada_em: datetime
    atendida_em: datetime | None = None
    atendida_por: str | None = None
    minha: bool = False
    # Só vai enquanto toca: é dela que o navegador monta a resposta.
    sdp_oferta: str | None = None


class AtivasOut(BaseModel):
    # O servidor dita a sondagem: conta com ligações ligadas = 3 s; sem = 60 s (não pesa no servidor).
    intervalo_s: int
    ligacoes: list[LigacaoOut]


class AtenderIn(BaseModel):
    sdp: str = Field(min_length=20, max_length=20000)


def _tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    return user.tenant_id


@router.get("/ativas", response_model=AtivasOut)
async def ligacoes_ativas(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Tocando agora + em andamento. Sondada pelo painel — consulta pelo índice."""
    tenant_id = _tenant(user)
    if not await ligacoes.ligado_na_conta(db, tenant_id):
        return AtivasOut(intervalo_s=60, ligacoes=[])
    agora = datetime.utcnow()
    rows = (
        await db.execute(
            sa_text(
                "SELECT id, conversation_id, contato, contato_nome, estado, direcao, criada_em, atendida_em,"
                " atendida_por, member_id, sdp_oferta FROM ta_ligacao"
                " WHERE tenant_id = :t AND estado IN ('tocando', 'atendendo', 'em_curso') AND criada_em >= :desde"
                " ORDER BY criada_em DESC LIMIT 10"
            ),
            {"t": tenant_id, "desde": agora - ligacoes.EM_CURSO_VALE},
        )
    ).all()
    saida = []
    for r in rows:
        if r.estado == "tocando" and (agora - r.criada_em).total_seconds() > ligacoes.TOCANDO_VALE_S:
            continue  # a Meta já desistiu; o aviso de fim é que se perdeu
        saida.append(
            LigacaoOut(
                id=r.id,
                conversation_id=r.conversation_id,
                contato=r.contato,
                contato_nome=r.contato_nome,
                estado=r.estado,
                direcao=r.direcao,
                criada_em=r.criada_em,
                atendida_em=r.atendida_em,
                atendida_por=r.atendida_por,
                minha=bool(r.member_id is not None and r.member_id == user.member_id)
                or (r.member_id is None and user.member_id is None and r.estado != "tocando"),
                sdp_oferta=r.sdp_oferta if r.estado == "tocando" else None,
            )
        )
    return AtivasOut(intervalo_s=3, ligacoes=saida)


async def _da_conta(db: AsyncSession, ligacao_id: int, tenant_id: int):
    r = (
        await db.execute(
            sa_text("SELECT id, call_id, connector_id, estado FROM ta_ligacao WHERE id = :i AND tenant_id = :t"),
            {"i": ligacao_id, "t": tenant_id},
        )
    ).first()
    if not r:
        raise HTTPException(404, "Ligação não encontrada")
    return r


@router.post("/{ligacao_id}/atender")
async def atender(
    ligacao_id: int,
    body: AtenderIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _tenant(user)
    lig = await _da_conta(db, ligacao_id, tenant_id)
    # Disputa: só um atendente vira «atendendo». Quem perde recebe 409.
    pegou = (
        await db.execute(
            sa_text(
                "UPDATE ta_ligacao SET estado = 'atendendo', member_id = :m, atendida_por = :quem, sdp_resposta = :sdp"
                " WHERE id = :i AND estado = 'tocando' RETURNING id"
            ),
            {"m": user.member_id, "quem": (user.member_name or user.email or "")[:120], "sdp": body.sdp, "i": lig.id},
        )
    ).first()
    await db.commit()
    if not pegou:
        raise HTTPException(409, "Essa ligação já foi atendida ou parou de tocar")
    sessao = {"sdp_type": "answer", "sdp": body.sdp}
    try:
        await ligacoes.acao_na_meta(
            db, lig.connector_id, {"call_id": lig.call_id, "action": "pre_accept", "session": sessao}
        )
        await ligacoes.acao_na_meta(
            db, lig.connector_id, {"call_id": lig.call_id, "action": "accept", "session": sessao}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("ligação %s: atender falhou: %s", lig.id, e)
        await db.execute(
            sa_text("UPDATE ta_ligacao SET estado = 'falhou', erro = :e, encerrada_em = now() WHERE id = :i"),
            {"e": str(e)[:500], "i": lig.id},
        )
        await db.commit()
        raise HTTPException(502, f"A Meta não completou o atendimento: {e}") from e
    await db.execute(
        sa_text(
            "UPDATE ta_ligacao SET estado = 'em_curso', atendida_em = now() WHERE id = :i AND estado = 'atendendo'"
        ),
        {"i": lig.id},
    )
    await db.commit()
    return {"ok": True}


@router.post("/{ligacao_id}/recusar")
async def recusar(ligacao_id: int, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    lig = await _da_conta(db, ligacao_id, _tenant(user))
    if lig.estado != "tocando":
        raise HTTPException(409, "Essa ligação não está mais tocando")
    try:
        await ligacoes.acao_na_meta(db, lig.connector_id, {"call_id": lig.call_id, "action": "reject"})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"A Meta não recusou: {e}") from e
    await db.execute(
        sa_text("UPDATE ta_ligacao SET estado = 'recusada', encerrada_em = now() WHERE id = :i"), {"i": lig.id}
    )
    await db.commit()
    return {"ok": True}


@router.post("/{ligacao_id}/encerrar")
async def encerrar(ligacao_id: int, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Desligar. Sempre avisa a Meta (é o que fecha a conta da ligação certo), mesmo que a mídia já tenha caído."""
    lig = await _da_conta(db, ligacao_id, _tenant(user))
    if lig.estado not in ligacoes.ESTADOS_ATIVOS:
        return {"ok": True, "ja_encerrada": True}
    try:
        await ligacoes.acao_na_meta(db, lig.connector_id, {"call_id": lig.call_id, "action": "terminate"})
    except Exception as e:  # noqa: BLE001
        logger.warning("ligação %s: encerrar na Meta falhou: %s", lig.id, e)
    await db.execute(
        sa_text(
            "UPDATE ta_ligacao SET estado = 'encerrada', encerrada_em = now(),"
            " duracao_s = COALESCE(duracao_s, CAST(EXTRACT(EPOCH FROM (now() - atendida_em)) AS INTEGER))"
            " WHERE id = :i AND estado IN ('atendendo', 'em_curso')"
        ),
        {"i": lig.id},
    )
    await db.commit()
    return {"ok": True}

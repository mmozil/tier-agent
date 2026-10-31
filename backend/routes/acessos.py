"""Quem abriu o quê — leitura do registro de acesso às conversas (31/10/2026). Só gestor.

Responde a pergunta que ficou sem resposta no incidente da M7: «quem leu a conversa da
Rebecca?». Gravado por `services/acesso_conversa` (tela, card do CRM, depuração).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from services import visao_conversas as visao

router = APIRouter(prefix="/acessos", tags=["acessos"])


def _linha(r) -> dict:
    return {
        "quando": r.criado_em.isoformat() if r.criado_em else None,
        "conversation_id": r.conversation_id,
        "contato": r.contato,
        "pessoa": r.pessoa or ("Dono da conta" if r.member_id is None else f"Pessoa #{r.member_id}"),
        "member_id": r.member_id,
        "papel": r.papel,
        "via": r.via,
    }


_SELECT = (
    "SELECT a.criado_em, a.conversation_id, a.member_id, a.papel, a.via, m.nome AS pessoa, c.contact_name AS contato"
    " FROM ta_acesso_conversa a"
    " LEFT JOIN ta_member m ON m.id = a.member_id"
    " LEFT JOIN ta_conversation c ON c.id = a.conversation_id"
)


@router.get("/conversas/{conversation_id}")
async def acessos_da_conversa(
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quem abriu esta conversa, do mais recente para o mais antigo."""
    visao.exigir_gestor(user, "ver quem abriu as conversas")
    rows = (
        await db.execute(
            text(_SELECT + " WHERE a.tenant_id = :t AND a.conversation_id = :c ORDER BY a.criado_em DESC LIMIT 500"),
            {"t": user.tenant_id, "c": conversation_id},
        )
    ).all()
    return {"conversation_id": conversation_id, "acessos": [_linha(r) for r in rows]}


@router.get("")
async def acessos_do_tenant(
    member_id: int | None = None,
    dias: int = Query(7, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aberturas no período — de uma pessoa (`member_id`) ou de todas. Para medir um incidente."""
    visao.exigir_gestor(user, "ver quem abriu as conversas")
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    filtro = " WHERE a.tenant_id = :t AND a.criado_em > now() - make_interval(days => :d)"
    params: dict = {"t": user.tenant_id, "d": dias}
    if member_id is not None:
        filtro += " AND a.member_id = :m"
        params["m"] = member_id
    rows = (await db.execute(text(_SELECT + filtro + " ORDER BY a.criado_em DESC LIMIT 1000"), params)).all()
    por_pessoa: dict = {}
    for r in rows:
        chave = r.member_id if r.member_id is not None else 0
        p = por_pessoa.setdefault(chave, {"pessoa": _linha(r)["pessoa"], "member_id": r.member_id, "conversas": set()})
        p["conversas"].add(r.conversation_id)
    resumo = sorted(
        ({**p, "conversas": len(p["conversas"])} for p in por_pessoa.values()), key=lambda x: -x["conversas"]
    )
    return {"dias": dias, "resumo": resumo, "acessos": [_linha(r) for r in rows]}

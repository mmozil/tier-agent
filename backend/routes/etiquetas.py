"""Etiquetas da conta — a lista fixa para a equipe ESCOLHER, no padrão do Chatwoot (12/11/2026).

Ler: qualquer pessoa da conta (a lista aparece no painel da conversa e na lateral).
Criar, mudar e apagar: só dono e administrador. Regras em `services/etiquetas.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from services import etiquetas as reg
from services import visao_conversas as visao

router = APIRouter(prefix="/etiquetas", tags=["etiquetas"])

_CAMPOS = "id, nome, descricao, cor, na_lateral"


class EtiquetaIn(BaseModel):
    nome: str = Field(..., min_length=1, max_length=60)
    descricao: str | None = Field(None, max_length=200)
    cor: str | None = None
    na_lateral: bool = True


class EtiquetaPatch(BaseModel):
    nome: str | None = Field(None, min_length=1, max_length=60)
    descricao: str | None = Field(None, max_length=200)
    cor: str | None = None
    na_lateral: bool | None = None


def _tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    return int(user.tenant_id)


def _nome_ok(bruto: str) -> str:
    nome = reg.normalizar_nome(bruto)
    if not nome:
        raise HTTPException(422, "Dê um nome à etiqueta")
    return nome


def _cor_ok(bruto: str | None) -> str:
    if bruto in (None, ""):
        return reg.COR_PADRAO
    cor = reg.cor_valida(bruto)
    if not cor:
        raise HTTPException(422, "Cor inválida: use o formato #RRGGBB")
    return cor


async def lista_da_conta(db: AsyncSession, tenant_id: int) -> list[dict]:
    rows = (
        (
            await db.execute(
                text(f"SELECT {_CAMPOS} FROM ta_etiqueta WHERE tenant_id = :t ORDER BY nome"), {"t": tenant_id}
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


async def nomes_da_conta(db: AsyncSession, tenant_id: int) -> set[str]:
    rows = (await db.execute(text("SELECT nome FROM ta_etiqueta WHERE tenant_id = :t"), {"t": tenant_id})).all()
    return {r[0] for r in rows}


@router.get("")
async def listar(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await lista_da_conta(db, _tenant(user))


@router.post("", status_code=201)
async def criar(body: EtiquetaIn, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = _tenant(user)
    visao.exigir_gestor(user, "criar etiqueta")
    nome = _nome_ok(body.nome)
    if nome in await nomes_da_conta(db, t):
        raise HTTPException(409, f"Já existe a etiqueta «{nome}»")
    row = (
        (
            await db.execute(
                text(
                    "INSERT INTO ta_etiqueta (tenant_id, nome, descricao, cor, na_lateral) "
                    f"VALUES (:t, :n, :d, :c, :l) RETURNING {_CAMPOS}"
                ),
                {
                    "t": t,
                    "n": nome,
                    "d": (body.descricao or "").strip() or None,
                    "c": _cor_ok(body.cor),
                    "l": body.na_lateral,
                },
            )
        )
        .mappings()
        .one()
    )
    await db.commit()
    return dict(row)


@router.patch("/{etiqueta_id}")
async def alterar(
    etiqueta_id: int,
    body: EtiquetaPatch,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    t = _tenant(user)
    visao.exigir_gestor(user, "mudar etiqueta")
    atual = (
        (
            await db.execute(
                text(f"SELECT {_CAMPOS} FROM ta_etiqueta WHERE id = :i AND tenant_id = :t"), {"i": etiqueta_id, "t": t}
            )
        )
        .mappings()
        .first()
    )
    if not atual:
        raise HTTPException(404, "Etiqueta não encontrada")
    dados = body.model_dump(exclude_unset=True)
    novo_nome = _nome_ok(dados["nome"]) if dados.get("nome") is not None else atual["nome"]
    if novo_nome != atual["nome"] and novo_nome in await nomes_da_conta(db, t):
        raise HTTPException(409, f"Já existe a etiqueta «{novo_nome}»")
    row = (
        (
            await db.execute(
                text(
                    "UPDATE ta_etiqueta SET nome = :n, descricao = :d, cor = :c, na_lateral = :l "
                    f"WHERE id = :i AND tenant_id = :t RETURNING {_CAMPOS}"
                ),
                {
                    "i": etiqueta_id,
                    "t": t,
                    "n": novo_nome,
                    "d": ((dados.get("descricao") or "").strip() or None)
                    if "descricao" in dados
                    else atual["descricao"],
                    "c": _cor_ok(dados["cor"]) if "cor" in dados else atual["cor"],
                    "l": dados["na_lateral"] if dados.get("na_lateral") is not None else atual["na_lateral"],
                },
            )
        )
        .mappings()
        .one()
    )
    renomeadas = 0
    if novo_nome != atual["nome"]:
        # O nome novo vai para todas as conversas da conta que tinham a etiqueta — mantendo a
        # ordem e sem repetir, caso a conversa já tivesse as duas.
        res = await db.execute(
            text(
                "UPDATE ta_conversation SET tags = ("
                "  SELECT COALESCE(jsonb_agg(v ORDER BY i), '[]'::jsonb) FROM ("
                "    SELECT DISTINCT ON (v) v, i FROM ("
                "      SELECT CASE WHEN e = :velho THEN :novo ELSE e END AS v, i"
                "      FROM jsonb_array_elements_text(tags) WITH ORDINALITY AS x(e, i)"
                "    ) s ORDER BY v, i"
                "  ) d"
                ") "
                "WHERE agent_id IN (SELECT id FROM ta_agent WHERE tenant_id = :t) "
                "AND tags @> jsonb_build_array(CAST(:velho AS text))"
            ),
            {"t": t, "velho": atual["nome"], "novo": novo_nome},
        )
        renomeadas = res.rowcount or 0
    await db.commit()
    return {**dict(row), "conversas_renomeadas": renomeadas}


@router.delete("/{etiqueta_id}")
async def apagar(etiqueta_id: int, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Tira da lista. As conversas que já tinham a etiqueta continuam com ela (histórico)."""
    t = _tenant(user)
    visao.exigir_gestor(user, "apagar etiqueta")
    res = await db.execute(text("DELETE FROM ta_etiqueta WHERE id = :i AND tenant_id = :t"), {"i": etiqueta_id, "t": t})
    if not res.rowcount:
        raise HTTPException(404, "Etiqueta não encontrada")
    await db.commit()
    return {"id": etiqueta_id, "apagada": True}

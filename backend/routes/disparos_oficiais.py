"""Página «Disparos» — modelo aprovado, pelo WhatsApp OFICIAL, para uma lista (11/11/2026).

Até aqui o disparo em lote pela API oficial só existia no ERP (que chama o send-template do Agent
contato a contato). Esta é a mesma coisa pela tela do próprio Agent; o envio de cada contato é o
mesmo código (`disparo_oficial.enviar_modelo`) e a fila mora em `services/disparo_lote.py`.

- `GET    /disparos-oficiais`                 lista (atendente: só os dos números dele)
- `GET    /disparos-oficiais/modelos`         modelos APROVADOS do número e por que algum não serve
- `POST   /disparos-oficiais/ler-lista`       prévia da lista colada — não grava nada
- `POST   /disparos-oficiais`                 cria em rascunho (dono/admin)
- `GET    /disparos-oficiais/{id}`            um disparo com os números
- `GET    /disparos-oficiais/{id}/envios`     contato a contato
- `POST   /disparos-oficiais/{id}/iniciar | pausar | retomar | cancelar`  (dono/admin)
- `DELETE /disparos-oficiais/{id}`            apaga rascunho (dono/admin)

Quem vê: dono e admin, todos os disparos do tenant; atendente, os disparos dos números DELE
(`visao_conversas.conectores_do_membro`), só para acompanhar. Criar e mexer no ciclo é de gestor.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt
from models import TaAgent, TaConnector, TaDisparoOficial, TaDisparoOficialEnvio, TaWaEnvioStatus
from routes.whatsapp_oficial import _modelos_da_meta, _numero, resumo_do_modelo
from services import disparo_lote
from services import visao_conversas as visao

router = APIRouter(prefix="/disparos-oficiais", tags=["disparos-oficiais"])

Usuario = Annotated[CurrentUser, Depends(get_current_user)]
Banco = Annotated[AsyncSession, Depends(get_db)]

D = TaDisparoOficial
E = TaDisparoOficialEnvio
LISTA_MAX_CARACTERES = 600_000  # ~5.000 linhas de planilha com folga


def _iso(dt: datetime | None) -> str | None:
    return dt.replace(microsecond=0).isoformat() + "Z" if dt else None


def _agora() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _disparo(db: AsyncSession, did: int, user: CurrentUser, *, gestor: bool = False) -> TaDisparoOficial:
    """O disparo, se a pessoa pode vê-lo. Atendente fora do número recebe 404 (nem sabe que existe)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    d = await db.get(D, did, populate_existing=True)
    if not d or (d.tenant_id != user.tenant_id and not user.is_admin):
        raise HTTPException(404, "Disparo não encontrado")
    if gestor:
        visao.exigir_gestor(user, "criar ou mexer em disparos")
    elif not visao.ve_tudo(user.role) and d.connector_id not in await visao.conectores_do_membro(
        db, user.tenant_id, user.member_id
    ):
        raise HTTPException(404, "Disparo não encontrado")
    return d


async def _numeros(db: AsyncSession, ids: set[int]) -> dict[int, dict]:
    """Telefone e agente de cada número oficial (um decrypt por número, não por disparo)."""
    if not ids:
        return {}
    out = {}
    rows = (
        await db.execute(
            select(TaConnector, TaAgent)
            .join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaConnector.id.in_(ids))
        )
    ).all()
    for conn, agente in rows:
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:  # noqa: BLE001
            cfg = {}
        out[conn.id] = {"telefone": cfg.get("phone"), "agente": agente.nome, "ativo": bool(conn.enabled)}
    return out


def _saida(d: TaDisparoOficial, c: dict, info: dict, agora: datetime) -> dict:
    agendado = d.status == disparo_lote.EM_ANDAMENTO and d.agendado_para and d.agendado_para > agora
    return {
        "id": d.id,
        "nome": d.nome,
        "status": d.status,
        "motivo_pausa": d.motivo_pausa,
        "modelo": d.modelo,
        "idioma": d.idioma,
        "categoria": d.categoria,
        "connector_id": d.connector_id,
        "telefone": info.get("telefone"),
        "agente": info.get("agente"),
        "numero_ativo": info.get("ativo"),
        "total": d.total,
        "contagens": c,
        "intervalo_s": round((d.intervalo_ms or 0) / 1000),
        "variacao_s": round((d.variacao_ms or 0) / 1000, 1),
        "agendado_para": _iso(d.agendado_para),
        "comeca_em": _iso(d.agendado_para) if agendado else None,
        "criado_por": d.criado_por,
        "criado_em": _iso(d.criado_em),
        "iniciado_em": _iso(d.iniciado_em),
        "pausado_em": _iso(d.pausado_em),
        "concluido_em": _iso(d.concluido_em),
        "cancelado_em": _iso(d.cancelado_em),
    }


async def _detalhe(db: AsyncSession, did: int) -> dict:
    d = await db.get(D, did, populate_existing=True)
    if not d:
        raise HTTPException(404, "Disparo não encontrado")
    c = (await disparo_lote.contagens(db, [did]))[did]
    info = (await _numeros(db, {d.connector_id})).get(d.connector_id, {})
    return {**_saida(d, c, info, _agora()), "modelo_resumo": d.modelo_json, "variaveis": d.variaveis_json or []}


def _erro(e: disparo_lote.ErroDoDisparo) -> HTTPException:
    return HTTPException(e.http, str(e))


# ───────────────────────── leitura ─────────────────────────


@router.get("")
async def listar(user: Usuario, db: Banco, limite: int = Query(100, ge=1, le=200)):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    q = select(D).where(D.tenant_id == user.tenant_id)
    if not visao.ve_tudo(user.role):
        meus = await visao.conectores_do_membro(db, user.tenant_id, user.member_id)
        if not meus:
            return {"disparos": [], "pode_criar": False}
        q = q.where(D.connector_id.in_(meus))
    disparos = (await db.execute(q.order_by(D.id.desc()).limit(limite))).scalars().all()
    cont = await disparo_lote.contagens(db, [d.id for d in disparos])
    info = await _numeros(db, {d.connector_id for d in disparos})
    agora = _agora()
    return {
        "disparos": [
            _saida(d, cont.get(d.id) or disparo_lote.contar([]), info.get(d.connector_id, {}), agora) for d in disparos
        ],
        "pode_criar": visao.ve_tudo(user.role),
    }


@router.get("/modelos")
async def modelos(user: Usuario, db: Banco, connector_id: int = Query(...)):
    """Os modelos APROVADOS do número, com `bloqueio` = por que algum não pode ir num disparo
    daqui (mídia no topo, link variável…). Os aprovados que servem vêm primeiro."""
    _, _, cfg = await _numero(db, connector_id, user, gestor=True)
    out = []
    for t in await _modelos_da_meta(cfg):
        if str(t.get("status") or "").upper() != "APPROVED":
            continue
        out.append({**resumo_do_modelo(t), "bloqueio": disparo_lote.bloqueio_do_modelo(t)})
    out.sort(key=lambda m: (m["bloqueio"] is not None, m["nome"] or ""))
    return {"modelos": out}


class LerListaIn(BaseModel):
    texto: str = Field("", max_length=LISTA_MAX_CARACTERES)


@router.post("/ler-lista")
async def ler_lista(body: LerListaIn, user: Usuario, db: Banco):
    """Prévia da lista colada: quantos números valem, quais linhas não, duplicados, quem já pediu
    para não receber. Não grava nada (fica fora do registro de atividades — a tela chama a cada
    colagem)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    visao.exigir_gestor(user, "criar disparos")
    leitura = disparo_lote.ler_lista(body.texto)
    contatos = leitura.contatos
    desc = await disparo_lote.descadastrados_da_lista(
        db, user.tenant_id, [c.chave for c in contatos[: disparo_lote.LIMITE_CONTATOS]]
    )
    return {
        "validos": len(contatos),
        "duplicados": leitura.duplicados,
        "invalidas": leitura.invalidas[:20],
        "total_invalidas": len(leitura.invalidas),
        "com_nome": sum(1 for c in contatos if disparo_lote.primeiro_nome(c.nome)),
        "descadastrados": len(desc),
        # Para a tela não contar duas vezes quem está nas duas situações (fora da lista E sem nome).
        "descadastrados_sem_nome": sum(
            1 for c in contatos if c.chave in desc and not disparo_lote.primeiro_nome(c.nome)
        ),
        "limite": disparo_lote.LIMITE_CONTATOS,
        "acima_do_limite": len(contatos) > disparo_lote.LIMITE_CONTATOS,
        "amostra": [
            {
                "numero": c.numero,
                "nome": c.nome,
                "primeiro_nome": disparo_lote.primeiro_nome(c.nome),
                "descadastrado": c.chave in desc,
            }
            for c in contatos[:6]
        ],
    }


# ───────────────────────── criar ─────────────────────────


class VariavelIn(BaseModel):
    fonte: str
    valor: str | None = None


class CriarIn(BaseModel):
    connector_id: int
    modelo: str = Field(..., min_length=1, max_length=512)
    idioma: str = "pt_BR"
    nome: str | None = Field(None, max_length=120)
    variaveis: list[VariavelIn] = []
    lista: str = Field(..., max_length=LISTA_MAX_CARACTERES)
    intervalo_s: int = disparo_lote.INTERVALO_PADRAO_S
    agendar_para: datetime | None = None


@router.post("")
async def criar(body: CriarIn, request: Request, user: Usuario, db: Banco):
    """Cria em RASCUNHO (nada sai até `iniciar`). O modelo é conferido na Meta agora."""
    conn, agente, cfg = await _numero(db, body.connector_id, user, gestor=True)
    if not conn.enabled:
        raise HTTPException(409, "Este número está desconectado")
    modelo = next(
        (
            t
            for t in await _modelos_da_meta(cfg)
            if t.get("name") == body.modelo and (t.get("language") or "") == body.idioma
        ),
        None,
    )
    if not modelo:
        raise HTTPException(404, "Modelo não encontrado neste número")
    try:
        d = await disparo_lote.criar(
            db,
            tenant_id=agente.tenant_id,
            connector_id=conn.id,
            modelo_meta=modelo,
            variaveis=[v.model_dump() for v in body.variaveis],
            lista=body.lista,
            nome=body.nome,
            intervalo_s=body.intervalo_s,
            agendar_para=body.agendar_para,
            criado_por_member_id=user.member_id,
            criado_por=user.member_name or user.email,
        )
    except disparo_lote.ErroDoDisparo as e:
        raise _erro(e) from e
    request.state.atividade = {"alvo": f"disparo #{d.id} · modelo {d.modelo} · {d.total} contatos"[:255]}
    return await _detalhe(db, d.id)


# ───────────────────────── um disparo ─────────────────────────


@router.get("/{did}")
async def detalhe(did: int, user: Usuario, db: Banco):
    await _disparo(db, did, user)
    return await _detalhe(db, did)


# Filtro da lista contato a contato (o mesmo vocabulário de `disparo_lote.situacao`).
def _filtro_situacao(situacao: str):
    S = TaWaEnvioStatus
    enviado = E.status == disparo_lote.ENVIADO
    return {
        "pendente": E.status.in_((disparo_lote.PENDENTE, disparo_lote.ENVIANDO)),
        "enviado": enviado & or_(S.status.is_(None), S.status.notin_(("delivered", "read", "failed"))),
        "entregue": enviado & (S.status == "delivered"),
        "lido": enviado & (S.status == "read"),
        "falhou": (E.status == disparo_lote.FALHOU) | (enviado & (S.status == "failed")),
        "descadastrado": E.status == disparo_lote.DESCADASTRADO,
        "sem_nome": E.status == disparo_lote.SEM_NOME,
        "cancelado": E.status == disparo_lote.ENVIO_CANCELADO,
    }.get(situacao)


@router.get("/{did}/envios")
async def envios(
    did: int,
    user: Usuario,
    db: Banco,
    situacao: str | None = None,
    busca: str | None = None,
    offset: int = Query(0, ge=0),
    limite: int = Query(100, ge=1, le=500),
):
    await _disparo(db, did, user)
    S = TaWaEnvioStatus
    conds = [E.disparo_id == did]
    if situacao:
        f = _filtro_situacao(situacao)
        if f is None:
            raise HTTPException(422, "Situação desconhecida")
        conds.append(f)
    termo = (busca or "").strip()
    if termo:
        digitos = re.sub(r"\D", "", termo)
        conds.append(E.numero.like(f"%{digitos}%") if digitos else E.nome.ilike(f"%{termo}%"))
    base = select(E.id).outerjoin(S, S.wamid == E.wamid).where(*conds)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            select(E, S.status, S.erro, S.erro_codigo, S.status_em)
            .outerjoin(S, S.wamid == E.wamid)
            .where(*conds)
            .order_by(E.id)
            .offset(offset)
            .limit(limite)
        )
    ).all()
    out = []
    for e, meta, meta_erro, meta_codigo, meta_em in rows:
        sit = disparo_lote.situacao(e.status, meta)
        motivo = e.erro
        if e.status == disparo_lote.ENVIADO and sit == "falhou":
            sufixo = f" (código {meta_codigo})" if meta_codigo else ""
            motivo = f"{meta_erro or 'A Meta não entregou a mensagem'}{sufixo}"
        elif sit not in ("falhou", "descadastrado", "sem_nome", "cancelado"):
            motivo = None
        out.append(
            {
                "id": e.id,
                "numero": e.numero,
                "nome": e.nome,
                "situacao": sit,
                "motivo": motivo,
                "enviado_em": _iso(e.enviado_em),
                "status_em": _iso(meta_em) if e.status == disparo_lote.ENVIADO else None,
                "conversation_id": e.conversation_id,
            }
        )
    return {"envios": out, "total": total, "offset": offset, "limite": limite}


async def _numero_ligado(db: AsyncSession, d: TaDisparoOficial, user: CurrentUser) -> None:
    conn, _, _ = await _numero(db, d.connector_id, user, gestor=True)
    if not conn.enabled:
        raise HTTPException(409, "O número deste disparo está desconectado — reconecte em Canais")


@router.post("/{did}/iniciar")
async def iniciar(did: int, request: Request, user: Usuario, db: Banco):
    d = await _disparo(db, did, user, gestor=True)
    await _numero_ligado(db, d, user)
    try:
        await disparo_lote.iniciar(db, did)
    except disparo_lote.ErroDoDisparo as e:
        raise _erro(e) from e
    request.state.atividade = {"alvo": f"disparo #{did} · {d.nome} · {d.total} contatos"[:255]}
    return await _detalhe(db, did)


@router.post("/{did}/pausar")
async def pausar(did: int, request: Request, user: Usuario, db: Banco):
    d = await _disparo(db, did, user, gestor=True)
    try:
        await disparo_lote.pausar(db, did, quem=user.member_name or user.email)
    except disparo_lote.ErroDoDisparo as e:
        raise _erro(e) from e
    request.state.atividade = {"alvo": f"disparo #{did} · {d.nome}"[:255]}
    return await _detalhe(db, did)


@router.post("/{did}/retomar")
async def retomar(did: int, request: Request, user: Usuario, db: Banco):
    d = await _disparo(db, did, user, gestor=True)
    await _numero_ligado(db, d, user)
    try:
        await disparo_lote.retomar(db, did)
    except disparo_lote.ErroDoDisparo as e:
        raise _erro(e) from e
    request.state.atividade = {"alvo": f"disparo #{did} · {d.nome}"[:255]}
    return await _detalhe(db, did)


@router.post("/{did}/cancelar")
async def cancelar(did: int, request: Request, user: Usuario, db: Banco):
    d = await _disparo(db, did, user, gestor=True)
    await disparo_lote.cancelar(db, did)
    request.state.atividade = {"alvo": f"disparo #{did} · {d.nome}"[:255]}
    return await _detalhe(db, did)


@router.delete("/{did}")
async def apagar(did: int, request: Request, user: Usuario, db: Banco):
    d = await _disparo(db, did, user, gestor=True)
    try:
        await disparo_lote.excluir_rascunho(db, did)
    except disparo_lote.ErroDoDisparo as e:
        raise _erro(e) from e
    request.state.atividade = {"alvo": f"disparo #{did} · {d.nome}"[:255]}
    return {"ok": True}

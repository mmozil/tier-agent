"""WhatsApp OFICIAL (Cloud API): modelos de mensagem e conversa iniciada pela equipe (11/11/2026).

Pedido do dono: «para eu iniciar uma conversa e o lead não me chamou, como faço pela nossa API
oficial?» — e depois «pode colocar para fazer isso também pelo agente».

A regra é da Meta: fora da janela de 24 h (o contato não escreveu, ou escreveu há mais de 24 h)
só sai MODELO APROVADO. Antes daqui o Agent só listava e enviava modelos para o disparo do ERP;
criar o modelo e mandar para aprovação era no Gerenciador do WhatsApp, fora do sistema, e
iniciar uma conversa individual pelo número oficial não existia.

- `GET  /whatsapp-oficial/numeros`           — números oficiais que a pessoa pode usar
- `GET  /whatsapp-oficial/modelos`           — todos os modelos do número (qualquer status)
- `POST /whatsapp-oficial/modelos`           — cria e manda para aprovação (dono/admin)
- `DELETE /whatsapp-oficial/modelos`         — apaga na Meta (dono/admin)
- `POST /whatsapp-oficial/iniciar-conversa`  — envia um modelo aprovado e abre a conversa

🚨 A conversa é a do contato NAQUELE número (`ensure_conversation`, por_numero): sem conversa em curso,
nasce ATIVA e a IA do número responde quando o lead responder. Se a equipe ASSUMIU a conversa nos
últimos 7 dias, o modelo entra nela e a IA segue calada — respeita o «Assumir» (corrigido em 11/11:
antes a assumida não era achada e a resposta do lead abria outra conversa, 26 → 28).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt
from models import TaAgent, TaConnector, TaMessageLog
from services import visao_conversas as visao
from services.connectors.adapters.whatsapp_cloud import GRAPH_BASE
from services.connectors.base import ConnectorConfig
from services.connectors.registry import registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp-oficial", tags=["whatsapp-oficial"])

STATUS_PT = {
    "APPROVED": "Aprovado",
    "PENDING": "Em análise",
    "REJECTED": "Recusado",
    "PAUSED": "Pausado",
    "DISABLED": "Desativado",
    "IN_APPEAL": "Em recurso",
    "PENDING_DELETION": "Sendo apagado",
    "DELETED": "Apagado",
    "LIMIT_EXCEEDED": "Limite excedido",
}
VAR = re.compile(r"\{\{\s*(\d+)\s*\}\}")


# ───────────────────────── regras puras (testadas sem rede) ─────────────────────────


def nome_tecnico(titulo: str) -> str:
    """O nome que a Meta aceita: minúsculas, números e `_` (até 512). «Boas-vindas do CCDA» →
    `boas_vindas_do_ccda`. Acento vira a letra sem acento."""
    import unicodedata

    s = unicodedata.normalize("NFKD", titulo or "").encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:512]


def variaveis_do_texto(texto: str) -> list[int]:
    return sorted({int(n) for n in VAR.findall(texto or "")})


def validar_modelo(
    titulo: str, corpo: str, exemplos: list[str], rodape: str | None, botoes: list[str]
) -> tuple[str, list[dict]]:
    """Confere o modelo ANTES de mandar para a Meta e monta os `components`. As regras abaixo
    são as que a Meta recusa na hora; a análise de conteúdo continua sendo dela."""
    nome = nome_tecnico(titulo)
    if not nome:
        raise ValueError("Dê um nome ao modelo (letras ou números)")
    corpo = VAR.sub(lambda m: "{{" + m.group(1) + "}}", (corpo or "").strip())
    if not corpo:
        raise ValueError("Escreva o texto da mensagem")
    if len(corpo) > 1024:
        raise ValueError("O texto passa de 1.024 caracteres (limite da Meta)")
    nums = variaveis_do_texto(corpo)
    if nums and nums != list(range(1, len(nums) + 1)):
        raise ValueError("As variáveis precisam seguir a ordem {{1}}, {{2}}, {{3}}… sem pular número")
    if nums and (VAR.match(corpo) or re.search(r"\{\{\d+\}\}[\s.!?]*$", corpo)):
        raise ValueError("A Meta não aceita variável no começo nem no fim do texto: escreva algo antes e depois")
    ex = [str(e or "").strip() for e in (exemplos or [])][: len(nums)]
    if len(ex) < len(nums) or any(not e for e in ex):
        raise ValueError("Preencha um exemplo para cada variável (a Meta usa para aprovar)")
    body: dict = {"type": "BODY", "text": corpo}
    if nums:
        body["example"] = {"body_text": [ex]}
    comps: list[dict] = [body]
    rodape = (rodape or "").strip()
    if rodape:
        if len(rodape) > 60:
            raise ValueError("O rodapé passa de 60 caracteres")
        if VAR.search(rodape):
            raise ValueError("O rodapé não aceita variável")
        comps.append({"type": "FOOTER", "text": rodape})
    bts = [b.strip() for b in (botoes or []) if (b or "").strip()]
    if len(bts) > 3:
        raise ValueError("No máximo 3 botões de resposta")
    if any(len(b) > 25 for b in bts):
        raise ValueError("Cada botão tem no máximo 25 caracteres")
    if bts:
        comps.append({"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": b} for b in bts]})
    return nome, comps


def resumo_do_modelo(t: dict) -> dict:
    comps = t.get("components") or []
    corpo = next((c.get("text") or "" for c in comps if c.get("type") == "BODY"), "")
    rodape = next((c.get("text") or "" for c in comps if c.get("type") == "FOOTER"), "")
    cab = next((c for c in comps if c.get("type") == "HEADER"), None)
    botoes = [b.get("text") for c in comps if c.get("type") == "BUTTONS" for b in (c.get("buttons") or [])]
    motivo = t.get("rejected_reason")
    status = str(t.get("status") or "").upper()
    return {
        "id": t.get("id"),
        "nome": t.get("name"),
        "status": status,
        "status_pt": STATUS_PT.get(status, status.title()),
        "categoria": t.get("category"),
        "idioma": t.get("language"),
        "corpo": corpo,
        "rodape": rodape,
        "cabecalho": (cab or {}).get("text") if (cab or {}).get("format") == "TEXT" else None,
        "cabecalho_midia": (cab or {}).get("format") if cab and cab.get("format") != "TEXT" else None,
        "botoes": [b for b in botoes if b],
        "variaveis": len(variaveis_do_texto(corpo)),
        "motivo_recusa": motivo if motivo and motivo != "NONE" else None,
        "qualidade": ((t.get("quality_score") or {}).get("score")) or None,
    }


def texto_enviado(corpo: str, valores: list[str], rodape: str | None = None) -> str:
    """O texto como o contato vê (vai para o histórico da conversa)."""
    def troca(m):
        i = int(m.group(1)) - 1
        return valores[i] if 0 <= i < len(valores) else m.group(0)

    t = VAR.sub(troca, corpo or "")
    return f"{t}\n\n{rodape}" if rodape else t


def numero_do_contato(telefone: str) -> str:
    d = re.sub(r"\D", "", telefone or "")
    if not d.startswith("55") and len(d) in (10, 11):
        d = "55" + d
    if not 12 <= len(d) <= 15:
        raise ValueError("Telefone inválido — use DDD + número")
    return d


# ───────────────────────── acesso ─────────────────────────


async def _numero(db: AsyncSession, connector_id: int, user: CurrentUser, *, gestor: bool = False):
    """O número oficial, se a pessoa pode usá-lo: dono/admin todos; atendente só os DELE."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    conn = await db.get(TaConnector, connector_id)
    agente = await db.get(TaAgent, conn.agent_id) if conn else None
    if not conn or not agente or (agente.tenant_id != user.tenant_id and not user.is_admin):
        raise HTTPException(404, "Número não encontrado")
    if conn.kind != "whatsapp_cloud":
        raise HTTPException(422, "Modelos de mensagem só existem no WhatsApp oficial (API da Meta)")
    if gestor:
        visao.exigir_gestor(user, "criar ou apagar modelos de mensagem")
    elif not visao.ve_tudo(user.role) and conn.id not in await visao.conectores_do_membro(
        db, user.tenant_id, user.member_id
    ):
        raise HTTPException(403, "Este número não é seu")
    cfg = json.loads(decrypt(conn.config_json_enc))
    if not cfg.get("waba_id") or not cfg.get("token"):
        raise HTTPException(409, "Número oficial sem conta ou chave da Meta — refaça o cadastro")
    return conn, agente, cfg


def _erro_meta(r: httpx.Response) -> str:
    try:
        e = r.json().get("error") or {}
        return e.get("error_user_msg") or e.get("message") or r.text[:300]
    except Exception:  # noqa: BLE001
        return r.text[:300]


async def _modelos_da_meta(cfg: dict) -> list[dict]:
    campos = "name,status,category,language,components,rejected_reason,quality_score"
    out, url, params = [], f"{GRAPH_BASE}/{cfg['waba_id']}/message_templates", {"fields": campos, "limit": "200"}
    async with httpx.AsyncClient(timeout=30) as cli:
        for _ in range(5):  # até 1.000 modelos
            r = await cli.get(url, params=params, headers={"Authorization": f"Bearer {cfg['token']}"})
            if r.status_code >= 400:
                raise HTTPException(502, f"A Meta não devolveu os modelos: {_erro_meta(r)}")
            d = r.json()
            out += d.get("data") or []
            nxt = ((d.get("paging") or {}).get("cursors") or {}).get("after")
            if not nxt or not (d.get("paging") or {}).get("next"):
                break
            params = {**params, "after": nxt}
    return out


# ───────────────────────── rotas ─────────────────────────


@router.get("/numeros")
async def numeros(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(
            select(TaConnector, TaAgent)
            .join(TaAgent, TaAgent.id == TaConnector.agent_id)
            .where(TaAgent.tenant_id == user.tenant_id, TaConnector.kind == "whatsapp_cloud")
            .order_by(TaConnector.id)
        )
    ).all()
    meus = None if visao.ve_tudo(user.role) else set(
        await visao.conectores_do_membro(db, user.tenant_id, user.member_id)
    )
    out = []
    for conn, agente in rows:
        if meus is not None and conn.id not in meus:
            continue
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:  # noqa: BLE001
            cfg = {}
        out.append({
            "id": conn.id,
            "agente": agente.nome,
            "telefone": cfg.get("phone"),
            "nome_verificado": cfg.get("verified_name"),
            "ativo": bool(conn.enabled),
        })
    return {"numeros": out, "pode_criar": visao.ve_tudo(user.role)}


@router.get("/modelos")
async def listar_modelos(
    connector_id: int = Query(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, cfg = await _numero(db, connector_id, user)
    modelos = [resumo_do_modelo(t) for t in await _modelos_da_meta(cfg)]
    ordem = {"APPROVED": 0, "PENDING": 1, "IN_APPEAL": 2, "REJECTED": 3}
    modelos.sort(key=lambda m: (ordem.get(m["status"], 9), m["nome"] or ""))
    return {"modelos": modelos}


class ModeloIn(BaseModel):
    connector_id: int
    titulo: str = Field(..., min_length=1, max_length=200)
    categoria: Literal["MARKETING", "UTILITY"]
    idioma: str = "pt_BR"
    corpo: str
    exemplos: list[str] = []
    rodape: str | None = None
    botoes: list[str] = []


@router.post("/modelos")
async def criar_modelo(
    body: ModeloIn,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, cfg = await _numero(db, body.connector_id, user, gestor=True)
    try:
        nome, comps = validar_modelo(body.titulo, body.corpo, body.exemplos, body.rodape, body.botoes)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    payload = {"name": nome, "language": body.idioma, "category": body.categoria, "components": comps}
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.post(
            f"{GRAPH_BASE}/{cfg['waba_id']}/message_templates",
            json=payload,
            headers={"Authorization": f"Bearer {cfg['token']}"},
        )
    request.state.atividade = {"alvo": f"modelo {nome}"[:255], "categoria": body.categoria}
    if r.status_code >= 400:
        raise HTTPException(422, f"A Meta recusou o modelo: {_erro_meta(r)}")
    d = r.json()
    status = str(d.get("status") or "PENDING").upper()
    return {"id": d.get("id"), "nome": nome, "status": status, "status_pt": STATUS_PT.get(status, status),
            "categoria": d.get("category") or body.categoria}


@router.delete("/modelos")
async def apagar_modelo(
    request: Request,
    connector_id: int = Query(...),
    nome: str = Query(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, cfg = await _numero(db, connector_id, user, gestor=True)
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.delete(
            f"{GRAPH_BASE}/{cfg['waba_id']}/message_templates",
            params={"name": nome},
            headers={"Authorization": f"Bearer {cfg['token']}"},
        )
    request.state.atividade = {"alvo": f"modelo {nome}"[:255]}
    if r.status_code >= 400:
        raise HTTPException(422, f"A Meta não apagou o modelo: {_erro_meta(r)}")
    return {"ok": True}


class IniciarIn(BaseModel):
    connector_id: int
    telefone: str
    modelo: str
    idioma: str = "pt_BR"
    variaveis: list[str] = []
    nome_contato: str | None = None


@router.post("/iniciar-conversa")
async def iniciar_conversa(
    body: IniciarIn,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from services import agent_runtime

    conn, agente, cfg = await _numero(db, body.connector_id, user)
    if not conn.enabled:
        raise HTTPException(409, "Este número está desconectado")
    try:
        numero = numero_do_contato(body.telefone)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    modelo = next(
        (m for m in (resumo_do_modelo(t) for t in await _modelos_da_meta(cfg))
         if m["nome"] == body.modelo and (m["idioma"] or "") == body.idioma),
        None,
    )
    if not modelo:
        raise HTTPException(404, "Modelo não encontrado neste número")
    if modelo["status"] != "APPROVED":
        raise HTTPException(422, f"O modelo está «{modelo['status_pt']}» — só modelo aprovado pode iniciar conversa")
    if modelo["cabecalho_midia"]:
        raise HTTPException(422, "Modelo com imagem, vídeo ou documento no topo ainda não é enviado por aqui")
    valores = [str(v or "").strip() for v in body.variaveis][: modelo["variaveis"]]
    if len(valores) < modelo["variaveis"] or any(not v for v in valores):
        raise HTTPException(422, f"Preencha as {modelo['variaveis']} variáveis do modelo")
    comps = [{"type": "body", "parameters": [{"type": "text", "text": v} for v in valores]}] if valores else None
    try:
        res = await registry.get("whatsapp_cloud").send_template(
            ConnectorConfig(data=cfg), numero, modelo["nome"], modelo["idioma"] or "pt_BR", comps
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("iniciar conversa oficial falhou connector=%s: %s", conn.id, e)
        raise HTTPException(502, f"A Meta não enviou: {e}") from e
    # O endereço que a Meta devolve é o que vem nas respostas do contato (com ou sem o 9).
    wa_id = ((res.get("contacts") or [{}])[0].get("wa_id")) or numero
    meta_id = ((res.get("messages") or [{}])[0].get("id"))
    conv = await agent_runtime.ensure_conversation(
        db,
        agent_id=conn.agent_id,
        connector_kind="whatsapp_cloud",
        external_id=wa_id,
        contact_name=(body.nome_contato or "").strip() or None,
        connector_id=conn.id,
        por_numero=True,
    )
    db.add(TaMessageLog(
        conversation_id=conv.id,
        role="agent",
        content=texto_enviado(modelo["corpo"], valores, modelo["rodape"])[:8000],
        member_id=user.member_id,
    ))
    if user.member_id and not conv.assigned_member_id:
        conv.assigned_member_id = user.member_id
        conv.assigned_to = user.member_name
    conv.last_message_at = datetime.utcnow()
    await db.commit()
    request.state.atividade = {
        "alvo": f"conversa #{conv.id} · modelo {modelo['nome']} · agente {agente.nome}"[:255],
        "conversation_id": conv.id,
    }
    return {"conversation_id": conv.id, "message_id": meta_id, "wa_id": wa_id}

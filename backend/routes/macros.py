"""Macros — atalho manual do atendente (paridade Chatwoot).

Uma macro é uma sequência de ações que o atendente aplica numa conversa com 1
clique: etiqueta + atribui + resposta pronta + muda status. Diferente do Playbook
(automático por gatilho), a macro é MANUAL — o humano dispara.

actions (lista ordenada):
  {"type":"tag","value":"reembolso"}        — adiciona etiqueta
  {"type":"assign","member_id":3}           — atribui a um atendente
  {"type":"reply","content":"texto"}        — envia mensagem ao cliente
  {"type":"status","value":"resolve"}       — resolve | handoff | resume
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt
from models import TaAgent, TaConnector, TaConversation, TaMacro
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/macros", tags=["macros"])


class MacroIn(BaseModel):
    name: str
    actions: list[dict] = []


class MacroOut(BaseModel):
    id: int
    name: str
    actions: list[dict]

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MacroOut])
async def list_macros(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    rows = (
        await db.execute(
            select(TaMacro).where(TaMacro.tenant_id == user.tenant_id).order_by(TaMacro.name.asc())
        )
    ).scalars().all()
    return rows


@router.post("", response_model=MacroOut, status_code=201)
async def create_macro(
    payload: MacroIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    if not payload.name.strip():
        raise HTTPException(400, "Nome obrigatório")
    item = TaMacro(tenant_id=user.tenant_id, name=payload.name.strip()[:120], actions=payload.actions or [])
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{macro_id}", response_model=MacroOut)
async def update_macro(
    macro_id: int,
    payload: MacroIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaMacro, macro_id)
    if not item or item.tenant_id != user.tenant_id:
        raise HTTPException(404, "Macro não encontrada")
    item.name = payload.name.strip()[:120]
    item.actions = payload.actions or []
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{macro_id}", status_code=204)
async def delete_macro(
    macro_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaMacro, macro_id)
    if not item or item.tenant_id != user.tenant_id:
        raise HTTPException(404, "Macro não encontrada")
    await db.delete(item)
    await db.commit()


@router.post("/{macro_id}/apply")
async def apply_macro(
    macro_id: int,
    conversation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aplica a macro numa conversa: executa as ações em ordem."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    macro = await db.get(TaMacro, macro_id)
    if not macro or macro.tenant_id != user.tenant_id:
        raise HTTPException(404, "Macro não encontrada")
    conv = await db.get(TaConversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    # garante que a conversa é de um agente do tenant
    agent = await db.get(TaAgent, conv.agent_id)
    if not agent or agent.tenant_id != user.tenant_id:
        raise HTTPException(403, "Conversa de outro tenant")

    executed: list[str] = []
    for act in macro.actions or []:
        t = (act or {}).get("type")
        try:
            if t == "tag":
                tag = str(act.get("value") or "").strip()
                if tag and tag not in (conv.tags or []):
                    conv.tags = [*(conv.tags or []), tag]
                    executed.append(f"etiqueta:{tag}")
            elif t == "assign":
                conv.assigned_member_id = act.get("member_id")
                executed.append("atribuído")
            elif t == "status":
                v = act.get("value")
                if v == "resolve":
                    conv.status = "closed"
                elif v == "handoff":
                    conv.status = "handed_off"
                elif v == "resume":
                    conv.status = "active"
                executed.append(f"status:{v}")
            elif t == "reply":
                content = str(act.get("content") or "").strip()
                if content:
                    conn = (
                        await db.execute(
                            select(TaConnector).where(
                                TaConnector.agent_id == conv.agent_id,
                                TaConnector.kind == conv.connector_kind,
                                TaConnector.enabled.is_(True),
                            )
                        )
                    ).scalars().first()
                    if conn:
                        impl = registry.get(conv.connector_kind)
                        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
                        await impl.send(
                            cfg, OutboundMessage(external_chat_id=conv.external_id, content=content)
                        )
                        executed.append("resposta enviada")
        except Exception:
            logger.exception("macro action falhou type=%s macro=%s conv=%s", t, macro_id, conversation_id)

    await db.commit()
    return {"applied": True, "macro": macro.name, "executed": executed}

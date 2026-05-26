"""Endpoints de templates de agente."""

from fastapi import APIRouter, Depends, HTTPException

from core.auth import CurrentUser, get_current_user
from services import templates as tpl

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("")
async def list_all(_: CurrentUser = Depends(get_current_user)):
    return {"templates": tpl.list_templates()}


@router.get("/{key}")
async def get_one(key: str, _: CurrentUser = Depends(get_current_user)):
    t = tpl.get_template(key)
    if not t:
        raise HTTPException(404, "Template não encontrado")
    return {
        "key": t.key,
        "label": t.label,
        "description": t.description,
        "icon": t.icon,
        "persona": t.persona,
        "system_prompt": t.system_prompt,
        "suggested_channels": t.suggested_channels,
        "skills_count": len(t.skills),
    }

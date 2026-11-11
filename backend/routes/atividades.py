"""Registro de atividades — leitura para o dono/administrador (11/11/2026).

Responde a pergunta que ficou sem resposta no CCDA: «qual usuário removeu o número?». Gravado
por `services/registro_atividade` (toda ação de todo usuário). Só gestor — o atendente não vê o
que os outros fizeram.
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from core.encryption import decrypt
from services import visao_conversas as visao

router = APIRouter(prefix="/atividades", tags=["atividades"])


def navegador_curto(ua: str | None) -> str | None:
    """«Chrome · Windows» a partir do user-agent — o suficiente para separar um aparelho de outro."""
    if not ua:
        return None
    nav = next(
        (
            n
            for p, n in (
                ("Edg/", "Edge"),
                ("OPR/", "Opera"),
                ("Firefox/", "Firefox"),
                ("Chrome/", "Chrome"),
                ("Safari/", "Safari"),
            )
            if p in ua
        ),
        None,
    )
    so = next(
        (
            n
            for p, n in (
                ("Windows", "Windows"),
                ("iPhone", "iPhone"),
                ("iPad", "iPad"),
                ("Android", "Android"),
                ("Mac OS", "Mac"),
                ("Linux", "Linux"),
            )
            if p in ua
        ),
        None,
    )
    if not nav and not so:
        return ua[:40]
    return " · ".join(x for x in (nav, so) if x)


async def _nomes(db: AsyncSession, tenant_id: int, linhas: list[dict]) -> dict[tuple[str, int], str]:
    """Nome atual de cada alvo (contato da conversa, telefone do número, agente, pessoa)."""
    ids: dict[str, set[int]] = {}
    for r in linhas:
        if r["recurso"] and r["recurso_id"] is not None:
            ids.setdefault(r["recurso"], set()).add(int(r["recurso_id"]))
    nomes: dict[tuple[str, int], str] = {}
    if ids.get("conversa"):
        for row in (
            await db.execute(
                text(
                    "SELECT c.id, c.contact_name FROM ta_conversation c JOIN ta_agent a ON a.id = c.agent_id"
                    " WHERE c.id = ANY(:i) AND a.tenant_id = :t"
                ),
                {"i": list(ids["conversa"]), "t": tenant_id},
            )
        ).all():
            if row.contact_name:
                nomes[("conversa", row.id)] = f"conversa com {row.contact_name}"
    if ids.get("agente"):
        for row in (
            await db.execute(
                text("SELECT id, nome FROM ta_agent WHERE id = ANY(:i) AND tenant_id = :t"),
                {"i": list(ids["agente"]), "t": tenant_id},
            )
        ).all():
            nomes[("agente", row.id)] = f"agente {row.nome}"
    if ids.get("pessoa"):
        for row in (
            await db.execute(
                text("SELECT id, nome FROM ta_member WHERE id = ANY(:i) AND tenant_id = :t"),
                {"i": list(ids["pessoa"]), "t": tenant_id},
            )
        ).all():
            nomes[("pessoa", row.id)] = f"pessoa {row.nome}"
    if ids.get("número"):
        for row in (
            await db.execute(
                text(
                    "SELECT n.id, n.config_json_enc FROM ta_connector n JOIN ta_agent a ON a.id = n.agent_id"
                    " WHERE n.id = ANY(:i) AND a.tenant_id = :t"
                ),
                {"i": list(ids["número"]), "t": tenant_id},
            )
        ).all():
            try:
                tel = json.loads(decrypt(row.config_json_enc)).get("phone")
            except Exception:  # noqa: BLE001
                tel = None
            if tel:
                nomes[("número", row.id)] = f"número {tel}"
    if ids.get("documento"):
        for row in (
            await db.execute(
                text(
                    "SELECT k.id, k.title FROM ta_knowledge k JOIN ta_agent a ON a.id = k.agent_id"
                    " WHERE k.id = ANY(:i) AND a.tenant_id = :t"
                ),
                {"i": list(ids["documento"]), "t": tenant_id},
            )
        ).all():
            nomes[("documento", row.id)] = f"documento {row.title}"
    return nomes


@router.get("")
async def listar(
    dias: int = Query(7, ge=1, le=365),
    member_id: int | None = None,
    quem: str | None = Query(None, max_length=120, description="Filtra pelo nome de quem fez (inclui o dono)"),
    busca: str | None = Query(None, max_length=120),
    so_recusadas: bool = False,
    limite: int = Query(200, ge=1, le=1000),
    pagina: int = Query(0, ge=0, le=1000),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ações do período, da mais recente para a mais antiga."""
    visao.exigir_gestor(user, "ver o registro de atividades")
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    filtro = " WHERE tenant_id = :t AND created_at > now() - make_interval(days => :d)"
    params: dict = {"t": user.tenant_id, "d": dias, "lim": limite, "off": pagina * limite}
    if member_id is not None:
        filtro += " AND (payload_json->>'member_id') = :m"
        params["m"] = str(member_id)
    if quem:
        filtro += " AND actor = :q"
        params["q"] = quem
    if busca:
        filtro += " AND (action ILIKE :b OR target ILIKE :b OR actor ILIKE :b)"
        params["b"] = f"%{busca.strip()}%"
    if so_recusadas:
        filtro += " AND COALESCE((payload_json->>'status')::int, 200) >= 400"
    rows = (
        await db.execute(
            text(
                "SELECT id, created_at, actor, action, target, payload_json FROM ta_audit_log"
                + filtro
                + " ORDER BY created_at DESC, id DESC LIMIT :lim OFFSET :off"
            ),
            params,
        )
    ).all()
    linhas = []
    for r in rows:
        d = r.payload_json if isinstance(r.payload_json, dict) else json.loads(r.payload_json or "{}")
        linhas.append(
            {
                "id": r.id,
                "quando": r.created_at.isoformat() + "Z" if r.created_at else None,
                "quem": r.actor,
                "member_id": d.get("member_id"),
                "papel": d.get("papel"),
                "acao": r.action,
                "alvo": r.target,
                "recurso": d.get("recurso"),
                "recurso_id": d.get("recurso_id"),
                "ok": int(d.get("status") or 200) < 400,
                "status": d.get("status"),
                "ip": d.get("ip"),
                "navegador": navegador_curto(d.get("navegador")),
            }
        )
    # O alvo gravado é «conversa #812»; na tela vale mais «conversa com Maria».
    nomes = await _nomes(db, user.tenant_id, linhas)
    for li in linhas:
        nome = nomes.get((li["recurso"], li["recurso_id"])) if li["recurso_id"] is not None else None
        if nome and (not li["alvo"] or re.fullmatch(r".+ #\d+", li["alvo"] or "")):
            li["alvo"] = nome
    pessoas = (
        await db.execute(
            text(
                "SELECT actor, COUNT(*) n FROM ta_audit_log WHERE tenant_id = :t"
                " AND created_at > now() - make_interval(days => :d) GROUP BY actor ORDER BY n DESC LIMIT 100"
            ),
            {"t": user.tenant_id, "d": dias},
        )
    ).all()
    return {
        "dias": dias,
        "atividades": linhas,
        "tem_mais": len(linhas) == limite,
        "pessoas": [{"quem": p.actor, "acoes": p.n} for p in pessoas],
    }

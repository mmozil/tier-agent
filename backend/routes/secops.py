"""SecOps / Observability — ingestão de alertas de infra e gestão de incidentes.

O servidor (scan-guard / C&C-guard / ingress-guard via tier-secops-alert.py) faz POST
em `/secops/alert` (HMAC-SHA256 do body, header X-Secops-Signature). Gravamos em
`ta_incident` (idempotente por fingerprint) e, se configurado, empurramos o alerta em
tempo real pro WhatsApp do agente DevOps. O agente lê os incidentes pelo comando
`incidentes`; o painel/admin gerencia por estes endpoints autenticados.
"""

import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.config import get_settings
from core.db import get_db
from core.encryption import decrypt

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/secops", tags=["secops"])

_VALID_SEV = {"info", "warning", "critical"}


def _verify_secops_signature(body: bytes, signature: str | None) -> bool:
    secret = settings.tier_secops_webhook_secret
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.replace("sha256=", ""))


def _fingerprint(payload: dict) -> str:
    """Fingerprint estável pra dedup do MESMO alerta aberto (source+kind+title)."""
    if payload.get("fingerprint"):
        return str(payload["fingerprint"])[:120]
    base = f"{payload.get('source', '')}|{payload.get('kind', '')}|{payload.get('title', '')}"
    return hashlib.sha256(base.encode()).hexdigest()[:120]


async def _push_whatsapp_alert(db: AsyncSession, title: str, severity: str, detail: str) -> None:
    """Empurra o alerta pro WhatsApp do agente DevOps, se TIER_SECOPS_ALERT_* configurado."""
    agent_id = settings.tier_secops_alert_agent_id
    chat = settings.tier_secops_alert_chat
    if not agent_id or not chat:
        return
    try:
        from services.connectors import registry
        from services.connectors.base import ConnectorConfig, OutboundMessage

        conn = (await db.execute(sql_text(
            "SELECT kind, config_json_enc FROM ta_connector WHERE agent_id = :a "
            "ORDER BY (kind='whatsapp') DESC, id ASC LIMIT 1"),
            {"a": agent_id})).mappings().first()
        if not conn:
            return
        icon = {"critical": "🔴", "warning": "🟠", "info": "🔵"}.get(severity, "⚪")
        msg = f"{icon} *Alerta de infra* — {title}"
        if detail:
            msg += f"\n{detail[:600]}"
        msg += "\n\n_Veja `incidentes` pra o histórico aberto._"
        impl = registry.get(conn["kind"])
        cfg = ConnectorConfig(data=json.loads(decrypt(conn["config_json_enc"])))
        await impl.send(cfg, OutboundMessage(external_chat_id=chat, content=msg))
    except Exception:
        logger.exception("push de alerta SecOps falhou (não-fatal)")


@router.post("/alert")
async def secops_alert(
    request: Request,
    x_secops_signature: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Ingestão de alerta dos guards do servidor. HMAC obrigatório.

    Body JSON: {source, severity, kind, title, detail?, fingerprint?, tenant_id?, push?}
    """
    body = await request.body()
    if not _verify_secops_signature(body, x_secops_signature):
        raise HTTPException(status_code=401, detail="assinatura inválida")
    try:
        payload = json.loads(body or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="body inválido")

    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title obrigatório")
    severity = (payload.get("severity") or "warning").lower()
    if severity not in _VALID_SEV:
        severity = "warning"
    source = (payload.get("source") or "manual")[:40]
    kind = (payload.get("kind") or None)
    detail = payload.get("detail") or None
    tenant_id = payload.get("tenant_id")
    fp = _fingerprint(payload)

    # Idempotente: o índice único parcial (fingerprint where status in open/ack) evita duplicar.
    row = (await db.execute(sql_text(
        """
        INSERT INTO ta_incident (tenant_id, source, severity, kind, title, detail, raw_json, fingerprint, status)
        VALUES (:tenant_id, :source, :severity, :kind, :title, :detail, CAST(:raw AS JSONB), :fp, 'open')
        ON CONFLICT (fingerprint) WHERE status IN ('open','ack') AND fingerprint IS NOT NULL
        DO UPDATE SET updated_at = now(), severity = EXCLUDED.severity, detail = EXCLUDED.detail
        RETURNING id, (xmax = 0) AS inserted
        """),
        {"tenant_id": tenant_id, "source": source, "severity": severity, "kind": kind,
         "title": title[:240], "detail": detail, "raw": json.dumps(payload), "fp": fp})).mappings().first()
    await db.commit()

    inserted = bool(row and row["inserted"])
    # push só pra alerta NOVO (não floodar em re-alertas do mesmo fingerprint)
    if inserted and (payload.get("push", True)):
        await _push_whatsapp_alert(db, title, severity, detail or "")
    return {"ok": True, "id": row["id"] if row else None, "created": inserted}


@router.get("/incidents")
async def list_incidents(
    status: str = "open",
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista incidentes do tenant do usuário + infra-global (tenant_id NULL)."""
    where_status = "status IN ('open','ack')" if status == "open" else "TRUE" if status == "all" else "status = :st"
    rows = (await db.execute(sql_text(
        f"SELECT id, tenant_id, source, severity, kind, title, detail, status, created_at, resolved_at "
        f"FROM ta_incident WHERE {where_status} AND (tenant_id IS NULL OR tenant_id = :t) "
        f"ORDER BY (severity='critical') DESC, created_at DESC LIMIT :lim"),
        {"t": user.tenant_id, "st": status, "lim": min(limit, 200)})).mappings().all()
    return {"incidents": [dict(r) for r in rows]}


@router.post("/incidents/{incident_id}/ack")
async def ack_incident(
    incident_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(sql_text(
        "UPDATE ta_incident SET status='ack', updated_at=now() "
        "WHERE id=:id AND (tenant_id IS NULL OR tenant_id=:t)"),
        {"id": incident_id, "t": user.tenant_id})
    await db.commit()
    return {"ok": True}


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(sql_text(
        "UPDATE ta_incident SET status='resolved', resolved_at=now(), updated_at=now() "
        "WHERE id=:id AND (tenant_id IS NULL OR tenant_id=:t)"),
        {"id": incident_id, "t": user.tenant_id})
    await db.commit()
    return {"ok": True}

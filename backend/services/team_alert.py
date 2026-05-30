"""Alerta externo pra equipe — "me chama quando precisar de mim".

Quando um evento relevante acontece (cliente pede humano, lead quente, cliente
irritado), além de criar a notificação no inbox (/admin/leads), avisamos a equipe
NO CANAL DELA: WhatsApp e/ou e-mail. É o que diferencia um inbox passivo de um
sistema que puxa o humano pra dentro na hora certa (ref: Chatwoot faz áudio/push/
e-mail/Slack; aqui WhatsApp é o canal natural no Brasil).

Configuração por tenant em TaRuntimeParam (escopo="tenant", escopo_id=tenant_id):
- `alert_whatsapp`  → número (só dígitos, com DDI) que recebe o aviso por WhatsApp
- `alert_email`     → e-mail que recebe o aviso
- `alert_enabled`   → "0" desliga tudo (default ligado se houver destino)

Sem destino configurado → no-op silencioso. Fire-and-forget: nunca quebra o fluxo
de atendimento (chamado em try/except).
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaConnector, TaRuntimeParam
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)

PANEL_URL = "https://agent.tier.finance/admin/leads"

CATEGORY_EMOJI = {
    "handoff": "🙋",
    "lead": "🔥",
    "frustration": "😠",
    "repeated_loop": "🔁",
    "sla": "⏰",
    "error": "⚠️",
}


async def _get_param(db: AsyncSession, tenant_id: int, key: str) -> str | None:
    row = (
        await db.execute(
            select(TaRuntimeParam.value).where(
                TaRuntimeParam.escopo == "tenant",
                TaRuntimeParam.escopo_id == tenant_id,
                TaRuntimeParam.key == key,
            )
        )
    ).first()
    val = (row[0] if row else None) or None
    return val.strip() if isinstance(val, str) else val


async def _find_connector(db: AsyncSession, agent_id: int | None, kinds: tuple[str, ...]) -> TaConnector | None:
    if agent_id is None:
        return None
    rows = (
        await db.execute(
            select(TaConnector).where(
                TaConnector.agent_id == agent_id,
                TaConnector.kind.in_(kinds),
                TaConnector.enabled.is_(True),
            )
        )
    ).scalars().all()
    return rows[0] if rows else None


def _format_message(*, category: str, title: str, summary: str | None) -> str:
    emoji = CATEGORY_EMOJI.get(category, "🔔")
    parts = [f"{emoji} *Tier Agent* — {title}"]
    if summary:
        parts.append("")
        parts.append(summary)
    parts.append("")
    parts.append(f"👉 Responder: {PANEL_URL}")
    return "\n".join(parts)


async def dispatch_team_alert(
    db: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int | None,
    category: str,
    title: str,
    summary: str | None = None,
) -> dict:
    """Envia o alerta nos canais configurados pra equipe. Nunca levanta exceção."""
    result = {"whatsapp": False, "email": False}
    try:
        if (await _get_param(db, tenant_id, "alert_enabled")) == "0":
            return result

        msg = _format_message(category=category, title=title, summary=summary)

        # ── WhatsApp: usa o próprio canal do agente pra mandar pro número do time ──
        wa_to = await _get_param(db, tenant_id, "alert_whatsapp")
        if wa_to:
            wa_digits = "".join(c for c in wa_to if c.isdigit())
            conn = await _find_connector(db, agent_id, ("whatsapp_cloud", "whatsapp"))
            if conn and wa_digits:
                try:
                    impl = registry.get(conn.kind)
                    cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
                    await impl.send(cfg, OutboundMessage(external_chat_id=wa_digits, content=msg))
                    result["whatsapp"] = True
                except Exception:
                    logger.exception("team_alert WhatsApp falhou tenant=%s", tenant_id)
            elif not conn:
                logger.info("team_alert: sem connector WhatsApp pro agent=%s", agent_id)

        # ── E-mail: usa um connector de e-mail do agente, se houver ──
        em_to = await _get_param(db, tenant_id, "alert_email")
        if em_to:
            conn = await _find_connector(db, agent_id, ("email",))
            if conn:
                try:
                    impl = registry.get("email")
                    cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
                    # O email adapter usa a 1ª linha como subject; prefixamos.
                    email_body = f"Subject: [Tier Agent] {title}\n\n{msg}"
                    await impl.send(
                        cfg,
                        OutboundMessage(external_chat_id=em_to, content=email_body),
                    )
                    result["email"] = True
                except Exception:
                    logger.exception("team_alert e-mail falhou tenant=%s", tenant_id)

        if result["whatsapp"] or result["email"]:
            logger.info("team_alert enviado tenant=%s cat=%s %s", tenant_id, category, result)
    except Exception:
        logger.exception("team_alert dispatch falhou tenant=%s — ignorando", tenant_id)
    return result

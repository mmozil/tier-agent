"""Horário de atendimento — define quando há gente pra atender.

A IA responde 24/7; o horário importa pro HANDOFF humano: fora do expediente, em
vez de "já chamei um atendente", respondemos a mensagem de fora-de-horário.

Config por tenant em TaRuntimeParam (escopo=tenant):
- `bh_enabled`  "1"/"0"
- `bh_days`     dias ISO separados por vírgula (1=seg … 7=dom), ex "1,2,3,4,5"
- `bh_start`    "HH:MM" (America/Sao_Paulo)
- `bh_end`      "HH:MM"
- `bh_message`  texto enviado fora do expediente

Timezone fixo America/Sao_Paulo (negócio BR).
"""

from __future__ import annotations

import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaRuntimeParam

logger = logging.getLogger(__name__)

TZ = ZoneInfo("America/Sao_Paulo")
_KEYS = ("bh_enabled", "bh_days", "bh_start", "bh_end", "bh_message")

DEFAULT_OFFHOURS_MSG = (
    "Recebi sua mensagem! Nosso atendimento humano está fora do horário agora, "
    "mas assim que abrirmos um de nossos atendentes te responde por aqui. 🙏"
)


def _parse_hhmm(s: str | None, fallback: time) -> time:
    try:
        h, m = (s or "").split(":")
        return time(int(h), int(m))
    except Exception:
        return fallback


async def _load(db: AsyncSession, tenant_id: int) -> dict[str, str]:
    rows = (
        await db.execute(
            select(TaRuntimeParam.key, TaRuntimeParam.value).where(
                TaRuntimeParam.escopo == "tenant",
                TaRuntimeParam.escopo_id == tenant_id,
                TaRuntimeParam.key.in_(_KEYS),
            )
        )
    ).all()
    return {k: v for k, v in rows}


async def is_open(db: AsyncSession, tenant_id: int) -> bool:
    """True se está dentro do expediente (ou se o recurso está desligado)."""
    cfg = await _load(db, tenant_id)
    if cfg.get("bh_enabled", "0") != "1":
        return True  # desligado → sempre "aberto"
    days_raw = cfg.get("bh_days") or "1,2,3,4,5"
    try:
        days = {int(d) for d in days_raw.split(",") if d.strip()}
    except Exception:
        days = {1, 2, 3, 4, 5}
    now = datetime.now(TZ)
    if now.isoweekday() not in days:
        return False
    start = _parse_hhmm(cfg.get("bh_start"), time(9, 0))
    end = _parse_hhmm(cfg.get("bh_end"), time(18, 0))
    return start <= now.time() <= end


async def offhours_message(db: AsyncSession, tenant_id: int) -> str:
    cfg = await _load(db, tenant_id)
    return (cfg.get("bh_message") or "").strip() or DEFAULT_OFFHOURS_MSG

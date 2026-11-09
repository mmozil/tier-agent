"""Nome salvo na agenda do celular do número, lido do motor (09/11/2026, M7).

Pedido do dono: «se ela salvou o contato, no celular e no WhatsApp Web aparece o nome
que ela salvou — aqui tinha de aparecer também». O WhatsApp manda a agenda do celular
aos aparelhos conectados; o motor passou a guardá-la (tabela `contacts`) e responde em
lote em `POST /v1/instances/{id}/contacts/lookup` com o nome salvo, o nome do perfil e
o TELEFONE de um código oculto (`@lid`) quando ele é conhecido.

O nome da tela fica: CRM → agenda do celular → perfil do WhatsApp → número.

Regras (as mesmas de `nome_crm`): nunca derruba a lista; guarda a resposta por 10 min
(achou ou não); número cujo motor falhou fica 1 min sem perguntar; motor antigo sem a
rota (404) fica 10 min sem perguntar.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt
from models import TaConnector

logger = logging.getLogger(__name__)

_TTL = 600.0
_TTL_FALHA = 60.0
_TTL_SEM_ROTA = 600.0
_MAX_CACHE = 30000

_cache: dict[tuple[int, str], tuple[float, dict | None]] = {}
_pausado: dict[int, float] = {}


def _e_pessoa(ext: str | None) -> bool:
    e = (ext or "").strip()
    return e.endswith("@s.whatsapp.net") or e.endswith("@lid")


async def _perguntar(instance_id: str, api_key: str, jids: list[str]) -> list[dict] | None:
    """Uma ida ao motor. None = falhou (quem chama pausa o número)."""
    url = f"{get_settings().tier_whatsapp_engine_url}/v1/instances/{instance_id}/contacts/lookup"
    async with httpx.AsyncClient(timeout=3.0) as cli:
        r = await cli.post(url, json={"jids": jids[:300]}, headers={"X-API-Key": api_key})
    if r.status_code == 404:
        raise LookupError("rota ausente")
    if r.status_code >= 400:
        return None
    return list((r.json() or {}).get("contatos") or [])


async def agenda_das_conversas(db: AsyncSession, conversas: Iterable[tuple[int | None, str | None]]) -> dict[str, dict]:
    """{external_id: {"nome", "telefone"}} — só as conversas com algo conhecido.

    `conversas` = pares (connector_id, external_id). Conversa sem número (antiga) fica de fora.
    """
    agora = time.monotonic()
    por_conector: dict[int, set[str]] = {}
    for cid, ext in conversas:
        if cid and _e_pessoa(ext):
            por_conector.setdefault(int(cid), set()).add(str(ext))
    if not por_conector:
        return {}

    faltam = {
        cid: [e for e in exts if _cache.get((cid, e), (0.0, None))[0] <= agora]
        for cid, exts in por_conector.items()
        if _pausado.get(cid, 0.0) <= agora
    }
    faltam = {cid: es for cid, es in faltam.items() if es}
    if faltam:
        try:
            rows = (
                await db.execute(
                    select(TaConnector).where(TaConnector.id.in_(list(faltam)), TaConnector.kind == "whatsapp")
                )
            ).scalars().all()
        except Exception:  # noqa: BLE001 — nome é luxo
            logger.warning("[nome_agenda] falha ao ler os números", exc_info=True)
            rows = []
        for conn in rows:
            try:
                cfg = json.loads(decrypt(conn.config_json_enc))
            except Exception:  # noqa: BLE001
                cfg = {}
            inst, chave = cfg.get("instance_id"), cfg.get("api_key")
            pedidos = faltam.get(conn.id) or []
            if not inst or not chave or not pedidos:
                continue
            try:
                achados = await _perguntar(str(inst), str(chave), pedidos)
            except LookupError:
                _pausado[conn.id] = agora + _TTL_SEM_ROTA
                continue
            except Exception as e:  # noqa: BLE001
                logger.info("[nome_agenda] motor não respondeu (número %s): %s", conn.id, e)
                achados = None
            if achados is None:
                _pausado[conn.id] = agora + _TTL_FALHA
                continue
            if len(_cache) > _MAX_CACHE:
                _cache.clear()
            por_jid = {str(a.get("jid")): a for a in achados if a.get("jid")}
            for e in pedidos:
                a = por_jid.get(e) or {}
                nome = (a.get("nome") or "").strip() or None
                tel = (a.get("telefone") or "").strip() or None
                _cache[(conn.id, e)] = (agora + _TTL, {"nome": nome, "telefone": tel} if (nome or tel) else None)

    saida: dict[str, dict] = {}
    for cid, exts in por_conector.items():
        for e in exts:
            v = _cache.get((cid, e), (0.0, None))[1]
            if v:
                saida[e] = v
    return saida

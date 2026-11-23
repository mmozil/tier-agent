"""O que a equipe escreveu pelo celular ANTES de existir conversa no Agent (23/11/2026, M7).

A Camilla abria a conversa pelo celular do número com IA («Aqui é Camilla da M7…»). Sem conversa no
Agent, a fala era descartada; o cliente respondia, a conversa nascia vazia e a IA se apresentava por
cima dela (conversas 2159 e 2161). Criar a conversa já na fala da equipe mostraria no Atendimento toda
pessoa a quem alguém escreveu pelo celular e que nunca respondeu. Então a fala fica guardada aqui e só
entra quando o outro lado responde (`agent_runtime.absorver_fala_pendente`).

O WhatsApp às vezes manda a fala só com o código oculto (`…@lid`), sem o telefone — 14 de 121 no 9150.
Por isso guarda sob o chat E sob o código, e quem lê procura pelos dois.

Nunca levanta. Redis fora: `guardar` e `ha` devolvem False — fica como era antes.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

import redis.asyncio as redis_async

from core.config import get_settings

logger = logging.getLogger(__name__)

# A mesma janela em que uma conversa assumida continua em curso (`JANELA_CONVERSA_ASSUMIDA`).
TTL_SEGUNDOS = 7 * 24 * 3600
MAXIMO = 50
PREFIXO = "tier_agent:fala_celular:"


@asynccontextmanager
async def _cliente():
    r = redis_async.from_url(get_settings().redis_url, decode_responses=True)
    try:
        yield r
    finally:
        await r.aclose()


def chaves(connector_id: int, jids: list[str | None]) -> list[str]:
    unicos = dict.fromkeys(j.strip().lower() for j in jids if j and j.strip())
    return [f"{PREFIXO}{connector_id}:{j}" for j in unicos]


async def guardar(connector_id: int, jids: list[str | None], item: dict) -> bool:
    ks = chaves(connector_id, jids)
    if not ks or not item.get("id"):
        return False
    try:
        async with _cliente() as r, r.pipeline(transaction=True) as p:
            for k in ks:
                p.rpush(k, json.dumps(item, ensure_ascii=False))
                p.ltrim(k, -MAXIMO, -1)
                p.expire(k, TTL_SEGUNDOS)
            await p.execute()
        return True
    except Exception:  # noqa: BLE001
        logger.warning("fala do celular nao guardada connector=%s", connector_id)
        return False


async def ha(connector_id: int, jids: list[str | None]) -> bool:
    ks = chaves(connector_id, jids)
    if not ks:
        return False
    try:
        async with _cliente() as r:
            return bool(await r.exists(*ks))
    except Exception:  # noqa: BLE001
        logger.warning("fala do celular nao consultada connector=%s", connector_id)
        return False


async def ler(connector_id: int, jids: list[str | None]) -> tuple[list[dict], dict[str, int]]:
    """(falas em ordem de envio, sem repetir · quantas linhas foram lidas em cada chave). NÃO apaga:
    quem lê grava no banco primeiro — se apagasse antes e a gravação falhasse, a fala sumiria."""
    falas: dict[str, dict] = {}
    lidas: dict[str, int] = {}
    try:
        async with _cliente() as r:
            for k in chaves(connector_id, jids):
                linhas = await r.lrange(k, 0, -1)
                lidas[k] = len(linhas)
                for linha in linhas:
                    it = json.loads(linha)
                    falas.setdefault(it["id"], it)
    except Exception:  # noqa: BLE001
        logger.warning("fala do celular nao lida connector=%s", connector_id)
        return [], {}
    return sorted(falas.values(), key=lambda it: it["em"]), lidas


async def apagar(lidas: dict[str, int]) -> None:
    """Tira só o que foi lido: uma fala que chegou no meio continua guardada."""
    try:
        async with _cliente() as r, r.pipeline(transaction=True) as p:
            for k, n in lidas.items():
                if n:
                    p.ltrim(k, n, -1)
            await p.execute()
    except Exception:  # noqa: BLE001 — sobra uma leitura repetida; a gravação não duplica (pelo id)
        logger.warning("fala do celular nao apagada")

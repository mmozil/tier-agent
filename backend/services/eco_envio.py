"""O que o SISTEMA mandou por um número — para o eco não passar por fala do celular (18/11/2026).

O Baileys devolve todo envio como `messages.upsert` com `fromMe`. No número em modo AGENTE o
webhook descartava todo `fromMe`, supondo que fosse sempre o eco da resposta da IA. Mas a equipe
também escreve pelo celular (ou WhatsApp Web) do número principal — na M7, a Isa — e essa fala
sumia do Agent: 47 mensagens em 7 dias, e a conversa mostrava só o lado do cliente (card 30963,
a Marisa respondendo a uma pergunta que no Agent não existia).

Para separar «o sistema mandou» de «alguém digitou no celular», o adaptador do WhatsApp ANOTA
cada envio antes de postar — o eco não tem como chegar antes da anotação — e o webhook CONSOME
uma anotação por eco. É uma fila por (instância, texto): a IA que manda «Olá, tudo bem?» duas
vezes deixa duas anotações; uma terceira igual, digitada à mão, não acha anotação e entra.

Nunca levanta. Redis fora: `anotar` não anota e `consumir` devolve `None` — quem chama cai na
trava por conteúdo (`agent_runtime.registrar_fala_do_celular`).
"""

from __future__ import annotations

import hashlib
import logging

import redis.asyncio as redis_async

from core.config import get_settings

logger = logging.getLogger(__name__)

# O eco chega em segundos; 3 min cobrem fila do Engine e reentrega sem segurar anotação velha.
TTL_SEGUNDOS = 180
PREFIXO = "tier_agent:eco_envio:"


def normalizar(texto: str | None) -> str:
    """O WhatsApp e o Engine podem aparar espaço e quebra de linha nas pontas — o resto é igual."""
    return " ".join((texto or "").split())


def chave(instance_id: str, texto: str | None) -> str:
    h = hashlib.sha1(normalizar(texto).encode("utf-8")).hexdigest()[:24]
    return f"{PREFIXO}{instance_id}:{h}"


async def _cliente():
    return await redis_async.from_url(get_settings().redis_url, decode_responses=True)


async def anotar(instance_id: str | None, texto: str | None) -> None:
    if not instance_id or not normalizar(texto):
        return
    try:
        r = await _cliente()
        k = chave(instance_id, texto)
        async with r.pipeline(transaction=True) as p:
            p.rpush(k, "1")
            p.expire(k, TTL_SEGUNDOS)
            await p.execute()
    except Exception:  # noqa: BLE001 — sem anotação, o eco cai na trava por conteúdo
        logger.warning("eco do envio nao anotado instance=%s", instance_id)


async def consumir(instance_id: str | None, texto: str | None) -> bool | None:
    """`True` = era eco de um envio nosso (anotação consumida) · `False` = ninguém do sistema
    mandou isto: foi digitado no celular · `None` = Redis fora, não dá para saber."""
    if not instance_id or not normalizar(texto):
        return False
    try:
        r = await _cliente()
        return (await r.lpop(chave(instance_id, texto))) is not None
    except Exception:  # noqa: BLE001
        logger.warning("eco do envio nao consultado instance=%s", instance_id)
        return None

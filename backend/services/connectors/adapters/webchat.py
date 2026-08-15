"""Adapter `webchat` — canal de demonstração / chat público por link.

Diferente dos outros canais, aqui NÃO existe um destino externo pra empurrar a
mensagem: quem está conversando é um navegador que fez um POST e está esperando
a resposta na mesma requisição.

Truque: o `send()` **enfileira** a resposta no Redis, numa lista por sessão, e o
endpoint público (`routes/public_chat.py`) drena essa fila logo depois de o
`agent_runtime.handle_inbound_message` retornar.

Por que assim e não mexendo no runtime: o `handle_inbound_message` tem ~10 pontos
de envio (ops command, guard, moderação, handoff, CSAT, resposta normal, split em
balões...). Fazendo o canal se comportar como qualquer outro, TODOS eles passam a
funcionar no chat público de graça — inclusive RAG, memória, freios, pausa por
handoff e o registro no inbox.

Redis (e não memória do processo) porque o backend roda com `--workers 2`: o POST
que enfileira pode cair num worker e o drain no outro.
"""

import logging

import redis.asyncio as redis_async

from core.config import get_settings
from services.connectors.base import ConnectorConfig, ConnectorError, OutboundMessage

logger = logging.getLogger(__name__)
settings = get_settings()

# Fila de saída por sessão. TTL curto: se o navegador sumiu, a resposta morre junto.
_FILA = "webchat:out:{sid}"
_FILA_TTL = 120  # segundos
_MAX_FILA = 12  # trava de segurança: split de balões nunca passa de 4


def _chave(session_id: str) -> str:
    return _FILA.format(sid=session_id)


async def _redis():
    return await redis_async.from_url(settings.redis_url, decode_responses=True)


class WebchatConnector:
    """Canal de chat público por link. Não fala com nenhuma API externa."""

    kind = "webchat"

    async def send(self, config: ConnectorConfig, msg: OutboundMessage) -> dict:
        """Enfileira a resposta pro navegador que está esperando."""
        if not msg.content or not msg.content.strip():
            return {"status": "skipped", "reason": "empty"}

        chave = _chave(msg.external_chat_id)
        try:
            r = await _redis()
            try:
                async with r.pipeline(transaction=True) as pipe:
                    pipe.rpush(chave, msg.content)
                    pipe.ltrim(chave, -_MAX_FILA, -1)
                    pipe.expire(chave, _FILA_TTL)
                    await pipe.execute()
            finally:
                await r.aclose()
        except Exception as e:
            # Sem Redis o chat público não funciona — é erro de verdade, não degrada.
            logger.exception("webchat: falha ao enfileirar resposta sid=%s", msg.external_chat_id)
            raise ConnectorError(f"webchat sem fila: {e}", kind=self.kind) from e

        return {"status": "queued", "session_id": msg.external_chat_id}

    async def validate_config(self, config: ConnectorConfig) -> bool:
        """Não há credencial externa. Só exige o slug que dá endereço ao link."""
        return bool((config.data or {}).get("slug"))


async def drenar(session_id: str) -> list[str]:
    """Tira da fila tudo que o agente respondeu nesta rodada (e limpa)."""
    chave = _chave(session_id)
    try:
        r = await _redis()
        try:
            async with r.pipeline(transaction=True) as pipe:
                pipe.lrange(chave, 0, -1)
                pipe.delete(chave)
                resultado = await pipe.execute()
            return [m for m in (resultado[0] or []) if m]
        finally:
            await r.aclose()
    except Exception:
        logger.exception("webchat: falha ao drenar sid=%s", session_id)
        return []

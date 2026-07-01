"""Gateway manager multi-bot pra Discord (INBOUND).

Discord exige conexão Gateway persistente (websocket) — diferente de Slack/Telegram
que usam webhook. Cada tenant traz o próprio bot token (TaConnector kind='discord').
Este manager roda como task de fundo no startup do backend.

Com `--workers 2`, só UM worker pode manter as conexões (senão o bot recebe cada
mensagem 2x e responde em dobro). Resolvido por **eleição de líder via Redis**: o
worker que segura o lock `tier-agent:discord:leader` mantém os Gateways; os outros
ficam parados. Se o líder morre, o lock expira (TTL) e outro assume no próximo tick.

Outbound das respostas NÃO passa por aqui — vai por REST via `DiscordConnector.send`,
chamado dentro de `handle_inbound_message`. Aqui só escutamos e encaminhamos.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid

from core.config import get_settings
from core.db import SessionLocal
from core.encryption import decrypt

logger = logging.getLogger("tier-agent.discord")

settings = get_settings()

_LEADER_KEY = "tier-agent:discord:leader"
_LEADER_TTL = 30          # validade do lock (s)
_LOOP_INTERVAL = 10       # renova lock + reconcilia a cada 10s

_manager: "DiscordGatewayManager | None" = None


class _BotRuntime:
    __slots__ = ("client", "task", "token")

    def __init__(self, client, task, token: str):
        self.client = client
        self.task = task
        self.token = token


class DiscordGatewayManager:
    def __init__(self):
        self._id = uuid.uuid4().hex               # identidade deste worker
        self._bots: dict[int, _BotRuntime] = {}   # conn_id -> runtime
        self._failed: dict[int, str] = {}         # conn_id -> token que falhou permanente
        self._is_leader = False
        self._discord = None                      # módulo discord.py (import lazy)
        self._redis_client = None

    # ── ciclo de vida ──────────────────────────────────────────────
    async def run_forever(self):
        try:
            import discord  # type: ignore

            self._discord = discord
        except Exception:
            logger.warning("discord.py não instalado — Gateway Discord desativado")
            return

        logger.info("discord gateway manager iniciado worker=%s", self._id[:8])
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                await self._stop_all()
                raise
            except Exception:
                logger.exception("discord gateway tick falhou (segue)")
            await asyncio.sleep(_LOOP_INTERVAL)

    async def _tick(self):
        leader = await self._renew_leadership()
        if leader and not self._is_leader:
            logger.info("discord gateway: virei LÍDER worker=%s", self._id[:8])
        elif not leader and self._is_leader:
            logger.info("discord gateway: PERDI liderança worker=%s", self._id[:8])
        self._is_leader = leader
        if leader:
            await self._reconcile()
        else:
            await self._stop_all()

    # ── eleição de líder (Redis) ───────────────────────────────────
    async def _get_redis(self):
        if self._redis_client is None:
            import redis.asyncio as redis_async

            self._redis_client = redis_async.from_url(settings.redis_url, decode_responses=True)
        return self._redis_client

    async def _renew_leadership(self) -> bool:
        """Fail-CLOSED: se o Redis estiver fora, NÃO assume liderança (evita 2 workers
        subindo o mesmo bot). Melhor Discord parado do que resposta duplicada."""
        try:
            r = await self._get_redis()
            cur = await r.get(_LEADER_KEY)
            if cur == self._id:
                await r.set(_LEADER_KEY, self._id, ex=_LEADER_TTL)
                return True
            if cur is None:
                ok = await r.set(_LEADER_KEY, self._id, nx=True, ex=_LEADER_TTL)
                return bool(ok)
            return False
        except Exception:
            logger.warning("discord gateway: Redis indisponível — não assumo liderança")
            return False

    # ── reconciliação de bots ──────────────────────────────────────
    async def _load_connectors(self) -> dict[int, str]:
        """{conn_id: bot_token} dos conectores discord habilitados."""
        from sqlalchemy import select

        from models import TaConnector

        out: dict[int, str] = {}
        async with SessionLocal() as db:
            res = await db.execute(
                select(TaConnector).where(
                    TaConnector.kind == "discord", TaConnector.enabled.is_(True)
                )
            )
            for c in res.scalars().all():
                try:
                    cfg = json.loads(decrypt(c.config_json_enc))
                except Exception:
                    continue
                tok = cfg.get("bot_token")
                if tok:
                    out[c.id] = tok
        return out

    async def _reconcile(self):
        desired = await self._load_connectors()

        # parar bots removidos ou com token trocado
        for conn_id in list(self._bots.keys()):
            rt = self._bots[conn_id]
            if conn_id not in desired or desired[conn_id] != rt.token:
                await self._stop_bot(conn_id)

        # subir bots novos / recriar os que caíram
        for conn_id, token in desired.items():
            # falhou permanente com esse token (token inválido / intent faltando): espera trocar
            if self._failed.get(conn_id) == token:
                continue
            rt = self._bots.get(conn_id)
            if rt is None:
                await self._start_bot(conn_id, token)
            elif rt.task.done():
                await self._stop_bot(conn_id)
                await self._start_bot(conn_id, token)

    async def _start_bot(self, conn_id: int, token: str):
        discord = self._discord
        intents = discord.Intents.default()
        intents.message_content = True  # privilegiado: cliente ativa no Developer Portal
        client = discord.Client(intents=intents)

        @client.event
        async def on_message(message):  # noqa: ANN001
            try:
                await self._on_message(conn_id, client, message)
            except Exception:
                logger.exception("discord on_message falhou conn=%s", conn_id)

        task = asyncio.create_task(self._run_client(conn_id, client, token))
        self._bots[conn_id] = _BotRuntime(client, task, token)
        logger.info("discord gateway: bot subindo conn=%s", conn_id)

    async def _run_client(self, conn_id: int, client, token: str):
        discord = self._discord
        try:
            await client.start(token)
        except discord.LoginFailure:
            logger.error("discord conn=%s: token inválido — não re-tenta", conn_id)
            self._failed[conn_id] = token
        except discord.PrivilegedIntentsRequired:
            logger.error(
                "discord conn=%s: ative 'Message Content Intent' no Developer Portal", conn_id
            )
            self._failed[conn_id] = token
        except Exception:
            logger.exception("discord client encerrou conn=%s (re-tenta no próximo tick)", conn_id)

    async def _stop_bot(self, conn_id: int):
        rt = self._bots.pop(conn_id, None)
        self._failed.pop(conn_id, None)
        if not rt:
            return
        with contextlib.suppress(Exception):
            await rt.client.close()
        if not rt.task.done():
            rt.task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await rt.task
        logger.info("discord gateway: bot parado conn=%s", conn_id)

    async def _stop_all(self):
        for conn_id in list(self._bots.keys()):
            await self._stop_bot(conn_id)

    # ── inbound ─────────────────────────────────────────────────────
    async def _on_message(self, conn_id: int, client, message):
        # ignora o próprio bot e outros bots (anti-loop)
        if getattr(message.author, "bot", False):
            return
        if client.user and message.author.id == client.user.id:
            return

        content = (message.content or "").strip()
        is_dm = message.guild is None
        if not is_dm:
            # em canal de servidor, só responde quando mencionado (evita ruído no server)
            if not client.user or client.user not in getattr(message, "mentions", []):
                return
            uid = client.user.id
            content = content.replace(f"<@{uid}>", "").replace(f"<@!{uid}>", "").strip()
        if not content:
            return

        sender = None
        with contextlib.suppress(Exception):
            sender = message.author.display_name or message.author.name

        from services.agent_runtime import handle_inbound_message

        async with SessionLocal() as db:
            await handle_inbound_message(
                db,
                connector_kind="discord",
                instance_id=str(conn_id),
                external_chat_id=str(message.channel.id),
                sender_name=sender,
                text_content=content,
                attachments=[],
            )


def start_discord_gateway():
    """Sobe o manager como task de fundo (chamado no startup). Idempotente."""
    global _manager
    if _manager is not None:
        return
    _manager = DiscordGatewayManager()
    asyncio.create_task(_manager.run_forever())

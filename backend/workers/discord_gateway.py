"""Gateway manager multi-bot pra Discord (INBOUND).

Discord exige conexão Gateway persistente (websocket) — diferente de Slack/Telegram
que usam webhook. Cada tenant traz o próprio bot token (TaConnector kind='discord').
Este manager roda como task de fundo no startup do backend.

Com `--workers 2`, só UM worker pode manter as conexões (senão o bot recebe cada
mensagem 2x e responde em dobro). Duas travas independentes garantem isso:
  1. **Eleição de líder** via lock Redis `tier-agent:discord:leader` (TTL 45s, renovado
     a cada 10s por um script Lua CAS ATÔMICO — sem get-then-set, sem stomp de dono).
  2. **Idempotência por message.id** (Redis SETNX): mesmo numa janela rara de 2 líderes,
     cada mensagem só é processada uma vez (o Gateway não tem dedup nativo como os webhooks).

Outbound das respostas NÃO passa por aqui — vai por REST via `DiscordConnector.send`,
chamado dentro de `handle_inbound_message`. Aqui só escutamos e encaminhamos.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid

from core.config import get_settings
from core.db import SessionLocal
from core.encryption import decrypt

logger = logging.getLogger("tier-agent.discord")

settings = get_settings()

_LEADER_KEY = "tier-agent:discord:leader"
_LEADER_TTL = 45          # validade do lock (s) — margem >4x o intervalo de renovação
_LOOP_INTERVAL = 10       # renova lock + reconcilia a cada 10s
_SEEN_TTL = 3600          # dedup de message.id por 1h

# Renovação/aquisição do lock em UM passo atômico (Redis roda Lua single-thread):
# - sou o dono? renovo o TTL.  - lock livre? adquiro com NX.  - de outro? não sou líder.
# Elimina o TOCTOU do get-then-set (2 workers viravam líder ao mesmo tempo).
_RENEW_LUA = """
local cur = redis.call('get', KEYS[1])
if cur == ARGV[1] then
  redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
elseif cur == false then
  if redis.call('set', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
    return 1
  else
    return 0
  end
else
  return 0
end
"""

_manager: "DiscordGatewayManager | None" = None
_task: "asyncio.Task | None" = None  # mantém referência forte (senão a task pode ser GC'd)


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
        # backoff exponencial por conector: conn_id -> (token, retry_after_monotonic).
        # NÃO é bloqueio permanente — o bot volta a tentar quando o tempo passa (ex: o
        # tenant ativou o Message Content Intent sem trocar o token).
        self._backoff: dict[int, tuple[str, float]] = {}
        self._attempts: dict[int, int] = {}
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
            res = await r.eval(_RENEW_LUA, 1, _LEADER_KEY, self._id, str(_LEADER_TTL))
            return res == 1 or res == "1"
        except Exception:
            logger.warning("discord gateway: Redis indisponível — não assumo liderança")
            return False

    async def _already_processed(self, message_id: str) -> bool:
        """True se este message.id já foi processado (dedup). SETNX no Redis: a 1ª
        entrega ganha, entregas repetidas (janela rara de 2 líderes) são puladas.
        Fail-OPEN: se o Redis oscilar, processa (não perde mensagem do cliente)."""
        try:
            r = await self._get_redis()
            ok = await r.set(f"tier-agent:discord:seen:{message_id}", "1", nx=True, ex=_SEEN_TTL)
            return not bool(ok)
        except Exception:
            return False

    # ── backoff ─────────────────────────────────────────────────────
    def _bump_backoff(self, conn_id: int, token: str):
        n = self._attempts.get(conn_id, 0) + 1
        self._attempts[conn_id] = n
        delay = min(30 * (2 ** min(n - 1, 6)), 1800)  # 30s,60,120,…,cap 30min
        self._backoff[conn_id] = (token, time.monotonic() + delay)
        logger.warning("discord conn=%s em backoff %.0fs (tentativa %d)", conn_id, delay, n)

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

        # parar bots removidos ou com token trocado (reset do backoff — é um bot "novo")
        for conn_id in list(self._bots.keys()):
            rt = self._bots[conn_id]
            if conn_id not in desired or desired[conn_id] != rt.token:
                await self._stop_bot(conn_id)
                self._backoff.pop(conn_id, None)
                self._attempts.pop(conn_id, None)

        # subir bots novos / recriar os que caíram (respeitando backoff)
        now = time.monotonic()
        for conn_id, token in desired.items():
            bo = self._backoff.get(conn_id)
            if bo and bo[0] == token and now < bo[1]:
                continue  # em backoff com o MESMO token — espera o tempo passar
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
        async def on_ready():
            # conectou com sucesso → zera backoff/tentativas desse conector
            self._backoff.pop(conn_id, None)
            self._attempts.pop(conn_id, None)
            logger.info(
                "discord gateway: bot ONLINE conn=%s user=%s",
                conn_id, getattr(client.user, "name", "?"),
            )

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
            logger.error("discord conn=%s: token inválido", conn_id)
            self._bump_backoff(conn_id, token)
        except discord.PrivilegedIntentsRequired:
            logger.error("discord conn=%s: ative 'Message Content Intent' no Developer Portal", conn_id)
            self._bump_backoff(conn_id, token)
        except Exception:
            logger.exception("discord client encerrou conn=%s", conn_id)
            self._bump_backoff(conn_id, token)

    async def _stop_bot(self, conn_id: int):
        # NÃO mexe em _backoff/_attempts aqui: o restart pós-backoff precisa preservar a
        # contagem (senão a tentativa nunca cresce). Reset é feito em on_ready (sucesso),
        # na troca/remoção do conector (_reconcile) e ao perder liderança (_stop_all).
        rt = self._bots.pop(conn_id, None)
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
        # ao deixar de ser líder, esquece o backoff (se voltar a liderar, tenta do zero)
        self._backoff.clear()
        self._attempts.clear()

    # ── inbound ─────────────────────────────────────────────────────
    async def _on_message(self, conn_id: int, client, message):
        # ignora o próprio bot e outros bots (anti-loop)
        if getattr(message.author, "bot", False):
            return
        if client.user and message.author.id == client.user.id:
            return

        # dedup por message.id (globalmente único) — trava definitiva contra resposta
        # dobrada, independente de qualquer corrida de liderança
        if await self._already_processed(str(message.id)):
            return

        content = (message.content or "").strip()
        is_dm = message.guild is None
        if not is_dm:
            # em canal de servidor, só responde quando @mencionado (evita ruído no server)
            uid = client.user.id if client.user else None
            mentioned = uid is not None and any(getattr(u, "id", None) == uid for u in getattr(message, "mentions", []))
            if not mentioned:
                return
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
    global _manager, _task
    if _manager is not None:
        return
    _manager = DiscordGatewayManager()
    _task = asyncio.create_task(_manager.run_forever())

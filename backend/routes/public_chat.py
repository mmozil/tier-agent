"""Chat público por link — o canal de demonstração.

`agent.tier.finance/c/<slug>` abre uma página onde qualquer pessoa conversa com o
agente **sem login e sem conectar canal nenhum**. Serve pra demonstrar um agente a
um prospect e é a base do widget de site (o widget é esta mesma rota dentro de uma
bolha).

A conversa passa pelo `agent_runtime.handle_inbound_message`, igual WhatsApp: RAG,
memória, freios, handoff, CSAT e registro no inbox funcionam sem nada a mais. O
adapter `webchat` devolve a resposta pela fila do Redis em vez de empurrar pra uma
API externa.

Config do link vive no `TaConnector(kind="webchat").config`:
    {slug, titulo, saudacao, cor, sugestoes[], pede_contato, limite_dia}

🚨 Rota PÚBLICA chamando LLM = qualquer um pode queimar o saldo do tenant.
Os freios são obrigatórios, não opcionais:
  - por sessão  (rajada de um visitante)
  - por IP      (mesma pessoa trocando de sessão)
  - por link/dia (teto absoluto que o dono configura)
O `budget_guard` por tenant continua como último recurso, mas ele é o freio de
emergência — estes aqui são o de serviço.
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
from datetime import UTC, datetime

import redis.asyncio as redis_async
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import db_context
from core.encryption import decrypt
from models import TaAgent, TaConnector
from services import agent_runtime, tier_engine
from services.connectors.adapters.webchat import drenar

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/public/chat", tags=["chat público"])

# ── Limites (default; `limite_dia` é sobrescrito por link) ──────────────
LIMITE_SESSAO = (20, 300)  # 20 mensagens a cada 5 min por sessão
LIMITE_IP = (40, 300)  # 40 mensagens a cada 5 min por IP
LIMITE_DIA_PADRAO = 500  # teto diário por link
TAMANHO_MAX_MSG = 2000

_SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
_SESSAO_OK = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


# ── Contratos ───────────────────────────────────────────────────────────
class EntradaMensagem(BaseModel):
    session_id: str = Field(..., description="id gerado pelo navegador, guardado no localStorage")
    texto: str
    nome: str | None = None
    telefone: str | None = None
    voz: bool = Field(False, description="tela de voz: devolve também o áudio da resposta")


class RespostaMensagem(BaseModel):
    baloes: list[str]
    status: str
    encerrado: bool = False
    audio_url: str | None = Field(
        None,
        description="Compat: a primeira fala. Prefira audio_urls.",
    )
    audio_urls: list[str] = Field(
        default_factory=list,
        description="Uma URL por FRASE, na ordem. A 1a fica pronta em ~1s; as outras vao atras.",
    )


# TTS só na resposta do próprio agente. NÃO existe endpoint de "sintetize este
# texto": seria um gerador de áudio grátis pra qualquer um, na conta do tenant.
TTS_MAX_CHARS = 900

# Tarefas de fundo (runtime que continua após a resposta + aquecimento de TTS).
# Referência forte obrigatória: task sem dono é coletada pelo GC no meio.
_tarefas_fundo: set[asyncio.Task] = set()


def _agendar(coro) -> asyncio.Task:
    t = asyncio.create_task(coro)
    _tarefas_fundo.add(t)
    t.add_done_callback(_descartar_tarefa)
    return t


def _descartar_tarefa(t: asyncio.Task) -> None:
    _tarefas_fundo.discard(t)
    if not t.cancelled() and t.exception():
        logger.error("webchat: tarefa de fundo falhou", exc_info=t.exception())


def _provedores_tts() -> list[str]:
    """Quais provedores de voz dá pra tentar, na ordem.

    `TTS_PROVIDER` força um. Sem ele, vale o que estiver configurado — o
    self-hosted vem primeiro porque não custa por caractere.
    """
    forcado = (os.environ.get("TTS_PROVIDER") or "").strip().lower()
    if forcado:
        return [forcado]
    ordem = []
    if os.environ.get("TTS_OPENAI_BASE_URL"):
        ordem.append("openai_compat")  # Kokoro self-hosted / OpenAI / DeepInfra
    if os.environ.get("MINIMAX_API_KEY"):
        ordem.append("minimax")
    if os.environ.get("ELEVENLABS_API_KEY"):
        ordem.append("elevenlabs")
    return ordem


def _partir_em_falas(texto: str, maximo: int = 4) -> list[str]:
    """Quebra a resposta em frases faláveis.

    A primeira frase é curta e fica pronta em ~1s, então o visitante ouve quase
    de imediato enquanto o resto ainda está sendo sintetizado. Frase muito curta
    é grudada na seguinte pra não virar áudio picotado.
    """
    partes = re.split(r"(?<=[.!?])\s+", (texto or "").strip())
    falas: list[str] = []
    for p in partes:
        p = p.strip()
        if not p:
            continue
        if falas and (len(falas[-1]) < 40 or len(p) < 25):
            falas[-1] = f"{falas[-1]} {p}"
        else:
            falas.append(p)
    if len(falas) > maximo:
        falas = [*falas[: maximo - 1], " ".join(falas[maximo - 1 :])]
    return falas[:maximo]


async def _preparar_falas(texto: str) -> list[str]:
    """Guarda cada frase sob um token e devolve as URLs, na ordem.

    A 1ª frase já sai pro TTS AQUI, em fundo (`_aquecer_fala`): a síntese começa
    no instante em que a resposta existe, e roda em paralelo com a volta do HTTP
    + o fetch do navegador. Quando o GET chega, o MP3 costuma estar pronto.
    Só a 1ª: aquecer todas em paralelo já derrubou o Kokoro por OOM.
    """
    texto = (texto or "").strip()[:TTS_MAX_CHARS]
    if not texto or not _provedores_tts():
        return []

    base = (getattr(settings, "public_api_url", None) or "https://api-agent.tier.finance/api/v1").rstrip("/")
    tokens: list[str] = []
    try:
        r = await _redis()
        try:
            for fala in _partir_em_falas(texto):
                token = secrets.token_urlsafe(16)
                await r.setex(f"webchat:voz:{token}", 300, fala)
                tokens.append(token)
            if tokens:
                # Marcador "síntese em andamento": o GET espera o aquecimento
                # em vez de sintetizar a MESMA frase em dobro no Kokoro.
                await r.setex(f"webchat:voz:pre:{tokens[0]}", 30, "1")
        finally:
            await r.aclose()
    except Exception:
        logger.exception("webchat voz: não consegui guardar as falas")
        return []

    _agendar(_aquecer_fala(tokens[0]))
    return [f"{base}/public/chat/voz/{t}" for t in tokens]


async def _aquecer_fala(token: str) -> None:
    """Sintetiza a fala em FUNDO e deixa o MP3 pronto no Redis (base64, TTL 5min)."""
    t0 = time.monotonic()
    try:
        r = await _redis()
    except Exception:
        logger.exception("webchat voz: aquecimento sem redis")
        return
    try:
        texto = await r.get(f"webchat:voz:{token}")
        if texto:
            audio = await _audio_da_frase(texto)  # já é fail-safe (None em erro)
            if audio:
                await r.setex(f"webchat:voz:mp3:{token}", 300, base64.b64encode(audio).decode())
                logger.info(
                    "webchat voz timing: 1a fala aquecida em %.2fs (%d KB)",
                    time.monotonic() - t0, len(audio) // 1024,
                )
    except Exception:
        logger.exception("webchat voz: aquecimento da 1a fala falhou")
    finally:
        # Aquecido OU falhou: o GET não pode ficar esperando um MP3 que não vem.
        try:
            await r.delete(f"webchat:voz:pre:{token}")
        finally:
            await r.aclose()


def _chave_do_conteudo(texto: str) -> str:
    """A mesma frase, sintetizada uma vez só.

    🚨 A chave é o TEXTO, não o token. É isso que deixa a síntese ESPECULATIVA
    (disparada no meio do streaming, antes de existir token) encontrar-se com o
    aquecimento oficial (disparado depois, já com token): os dois pedem a mesma
    frase, então batem na mesma chave e o segundo não sintetiza nada.
    """
    return "webchat:voz:h:" + hashlib.sha1(texto.strip().encode("utf-8")).hexdigest()[:24]


async def _audio_da_frase(texto: str) -> bytes | None:
    """Sintetiza UMA frase e devolve os bytes do MP3.

    Percorre os provedores na ordem: saldo zerado num deles não pode calar o
    agente. Falha em todos devolve None e a tela cai na voz do navegador —
    áudio é melhoria, não requisito."""
    texto = (texto or "").strip()
    if not texto:
        return None
    if len(texto) > TTS_MAX_CHARS:
        texto = texto[:TTS_MAX_CHARS]

    # Já sintetizada nos últimos 5 min? Sai na hora — o Kokoro cobra ~1,0s fixos
    # por chamada, independente do tamanho da frase (medido: 6 chars = 1,03s).
    #
    # 🚨 E aqui não basta olhar o cache: PRECISA de fila de um.
    # Medido em produção com só o cache: a especulação começava em 34,8s e
    # terminava em 36,8s; o aquecimento oficial começava em 35,1s, achava o
    # cache VAZIO (o outro ainda estava sintetizando) e fazia a MESMA frase de
    # novo, terminando em 38,8s. Dois Kokoros para um áudio, e o segundo era
    # justamente o que o navegador estava esperando.
    #
    # Com a fila, o segundo espera o primeiro em vez de competir com ele.
    chave = _chave_do_conteudo(texto)
    trava = chave + ":lock"
    tenho_a_vez = False
    try:
        r = await _redis()
        try:
            b64 = await r.get(chave)
            if not b64:
                tenho_a_vez = bool(await r.set(trava, "1", nx=True, ex=25))
                if not tenho_a_vez:
                    # Alguém já está sintetizando esta frase: esperar sai mais
                    # barato (e mais rápido) do que sintetizar em dobro.
                    for _ in range(60):  # até ~6s
                        await asyncio.sleep(0.1)
                        b64 = await r.get(chave)
                        if b64 or not await r.exists(trava):
                            break
        finally:
            await r.aclose()
        if b64:
            return base64.b64decode(b64)
    except Exception:
        logger.debug("webchat voz: cache por conteúdo indisponível", exc_info=True)

    from services.voice import elevenlabs_client, minimax_client, openai_compat_client

    clientes = {
        "openai_compat": openai_compat_client,
        "kokoro": openai_compat_client,  # apelido: Kokoro fala esse protocolo
        "minimax": minimax_client,
        "elevenlabs": elevenlabs_client,
    }

    for nome in _provedores_tts():
        cliente = clientes.get(nome)
        if not cliente:
            logger.warning("webchat voz: provedor '%s' desconhecido", nome)
            continue
        try:
            r = await cliente.synthesize(texto)
        except Exception:
            logger.exception("webchat voz: %s levantou exceção", nome)
            continue
        if not r.ok or not r.audio_bytes:
            # Cai pro próximo: saldo zerado num provedor não pode calar o agente.
            logger.warning("webchat voz: %s falhou — %s", nome, r.error)
            continue

        logger.info("webchat voz: %s gerou %d KB", nome, len(r.audio_bytes) // 1024)
        try:
            rd = await _redis()
            try:
                await rd.setex(chave, 300, base64.b64encode(r.audio_bytes).decode())
                # Solta a fila SEMPRE que fui eu quem sintetizou — quem espera
                # não pode ficar preso a uma trava de 25s.
                if tenho_a_vez:
                    await rd.delete(trava)
            finally:
                await rd.aclose()
        except Exception:
            logger.debug("webchat voz: não consegui guardar por conteúdo", exc_info=True)
        return r.audio_bytes

    # Nenhum provedor entregou. Solta a fila na saída também: quem está
    # esperando precisa descobrir AGORA que não vem áudio, e não daqui a 25s.
    if tenho_a_vez:
        try:
            rd = await _redis()
            try:
                await rd.delete(trava)
            finally:
                await rd.aclose()
        except Exception:
            logger.debug("webchat voz: não consegui soltar a fila", exc_info=True)
    return None


# ── Redis ───────────────────────────────────────────────────────────────
async def _redis():
    return await redis_async.from_url(settings.redis_url, decode_responses=True)


async def _passou_no_limite(chave: str, teto: int, janela: int) -> bool:
    """Contador com expiração. True = pode seguir."""
    try:
        r = await _redis()
        try:
            atual = await r.incr(chave)
            if atual == 1:
                await r.expire(chave, janela)
            return atual <= teto
        finally:
            await r.aclose()
    except Exception:
        # Redis fora = o adapter webchat também não funciona. Deixa passar aqui
        # pra falhar com mensagem clara lá, em vez de virar "limite atingido".
        logger.exception("limite: redis indisponível chave=%s", chave)
        return True


def _ip_do_cliente(request: Request) -> str:
    encaminhado = request.headers.get("x-forwarded-for") or ""
    if encaminhado:
        return encaminhado.split(",")[0].strip()
    return request.client.host if request.client else "desconhecido"


# ── Resolução do link ───────────────────────────────────────────────────
async def _achar_link(db: AsyncSession, slug: str) -> tuple[TaConnector, dict, TaAgent]:
    if not _SLUG_OK.match(slug or ""):
        raise HTTPException(404, "Link não encontrado")

    resultado = await db.execute(
        select(TaConnector).where(TaConnector.kind == "webchat", TaConnector.enabled.is_(True))
    )
    for conn in resultado.scalars().all():
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:
            continue
        if str(cfg.get("slug") or "") != slug:
            continue

        agente = await db.get(TaAgent, conn.agent_id)
        if not agente or not agente.active:
            raise HTTPException(404, "Link não encontrado")
        return conn, cfg, agente

    raise HTTPException(404, "Link não encontrado")


# ── Endpoints ───────────────────────────────────────────────────────────
@router.get("/voz/{token}")
async def transmitir_voz(token: str):
    """Transmite o áudio da fala guardada — em pedaços, conforme sai do TTS.

    O `<audio>` do navegador toca MP3 progressivo nativamente, então o visitante
    escuta a primeira sílaba quase imediatamente em vez de esperar o arquivo.
    """
    if not re.match(r"^[A-Za-z0-9_-]{16,64}$", token or ""):
        raise HTTPException(404, "Áudio não encontrado")

    t0 = time.monotonic()
    b64: str | None = None
    try:
        r = await _redis()
        try:
            texto = await r.get(f"webchat:voz:{token}")
            if texto:
                # Aquecimento: a 1ª fala é sintetizada em fundo assim que a
                # resposta existe. Se o MP3 já está pronto, sai na hora; se a
                # síntese está EM ANDAMENTO, esperar é mais rápido (e mais leve
                # pro Kokoro) do que sintetizar a mesma frase em dobro.
                b64 = await r.get(f"webchat:voz:mp3:{token}")
                if not b64 and await r.exists(f"webchat:voz:pre:{token}"):
                    for _ in range(40):  # até ~4s
                        await asyncio.sleep(0.1)
                        b64 = await r.get(f"webchat:voz:mp3:{token}")
                        if b64 or not await r.exists(f"webchat:voz:pre:{token}"):
                            break
        finally:
            await r.aclose()
    except Exception:
        logger.exception("webchat voz: redis fora ao buscar a fala")
        raise HTTPException(503, "Áudio indisponível") from None

    if not texto:
        raise HTTPException(404, "Áudio não encontrado")

    if b64:
        try:
            audio = base64.b64decode(b64)
            logger.info(
                "webchat voz timing: GET servido do cache aquecido em %.2fs (%d KB)",
                time.monotonic() - t0, len(audio) // 1024,
            )
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={"Cache-Control": "no-store", "Content-Length": str(len(audio))},
            )
        except Exception:
            logger.exception("webchat voz: cache aquecido corrompido — sintetizo na hora")

    # 🚨 Devolve o arquivo COMPLETO, com Content-Length. StreamingResponse em
    # chunked cross-origin sem Content-Length faz o <audio> do Chrome pendurar:
    # o  e chamado, o evento  nunca dispara e nao sai som.
    # Como a fala aqui e UMA FRASE, sintetizar inteiro custa ~1s.
    audio = await _audio_da_frase(texto)
    if not audio:
        raise HTTPException(503, "Não consegui gerar o áudio")
    logger.info(
        "webchat voz timing: GET sintetizado na hora em %.2fs (%d KB)",
        time.monotonic() - t0, len(audio) // 1024,
    )
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "Content-Length": str(len(audio))},
    )



@router.get("/{slug}")
async def abrir_link(slug: str):
    """Dados públicos pra montar a página. Não expõe nada além da aparência."""
    async with db_context() as db:
        _, cfg, agente = await _achar_link(db, slug)

    return {
        "slug": slug,
        "agente": agente.nome,
        "avatar_url": agente.avatar_url,
        "titulo": cfg.get("titulo") or agente.nome,
        "subtitulo": cfg.get("subtitulo") or "",
        "saudacao": cfg.get("saudacao") or f"Olá! Sou {agente.nome}. Como posso ajudar?",
        "cor": cfg.get("cor") or "#003083",
        "logo_url": cfg.get("logo_url"),
        "sugestoes": cfg.get("sugestoes") or [],
        "pede_contato": bool(cfg.get("pede_contato")),
        "rodape": cfg.get("rodape") or "",
    }


@router.post("/{slug}/mensagem", response_model=RespostaMensagem)
async def enviar_mensagem(slug: str, entrada: EntradaMensagem, request: Request):
    """Manda uma mensagem pro agente e devolve o que ele respondeu.

    O runtime roda como TAREFA e a rota drena a fila do Redis assim que a
    resposta aparece nela. O que vem depois do envio no `handle_inbound_message`
    (auto-CRM no ERP, auto-qualificação, lead, detecção de loop, Langfuse) é
    burocracia de registro — segurava o visitante esperando um texto que já
    estava pronto. Agora ela termina em fundo.
    """
    t0 = time.monotonic()
    texto = (entrada.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Mensagem vazia")
    if len(texto) > TAMANHO_MAX_MSG:
        raise HTTPException(400, f"Mensagem muito longa (máx {TAMANHO_MAX_MSG} caracteres)")
    if not _SESSAO_OK.match(entrada.session_id or ""):
        raise HTTPException(400, "Sessão inválida")

    async with db_context() as db:
        _, cfg, agente = await _achar_link(db, slug)

    hoje = datetime.now(UTC).strftime("%Y%m%d")
    ip = _ip_do_cliente(request)
    teto_dia = int(cfg.get("limite_dia") or LIMITE_DIA_PADRAO)

    limites = [
        (f"webchat:lim:s:{slug}:{entrada.session_id}", *LIMITE_SESSAO),
        (f"webchat:lim:ip:{slug}:{ip}", *LIMITE_IP),
        (f"webchat:lim:dia:{slug}:{hoje}", teto_dia, 86400),
    ]
    for chave, teto, janela in limites:
        if not await _passou_no_limite(chave, teto, janela):
            logger.warning("webchat: limite atingido slug=%s chave=%s", slug, chave)
            raise HTTPException(
                429,
                "Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo.",
            )

    # Prefixo `web:` deixa a origem óbvia no inbox e evita colidir com telefone.
    chat_id = f"web:{entrada.session_id}"
    t_pronto = time.monotonic()

    async def _rodar_runtime() -> dict:
        # Sessão própria: a tarefa pode sobreviver à requisição HTTP.
        async with db_context() as db:
            return await agent_runtime.handle_inbound_message(
                db,
                connector_kind="webchat",
                instance_id=slug,
                external_chat_id=chat_id,
                sender_name=(entrada.nome or "").strip() or "Visitante",
                text_content=texto,
                modo_voz=entrada.voz,  # tela de voz: resposta curta, gera mais rapido
            )

    # ── SÍNTESE ESPECULATIVA ────────────────────────────────────────────
    # 🚨 O que fazia a voz parecer travada não era o modelo: era a ORDEM.
    # O TTS só começava depois da resposta INTEIRA pronta, e o Kokoro cobra
    # ~1,5s fixos. Somava 3s de modelo + 1,5s de voz, em série.
    #
    # Agora a primeira frase vai pro TTS assim que o modelo a FECHA, enquanto
    # ele ainda escreve o resto. Quando o HTTP volta, o MP3 costuma estar
    # pronto e o GET do navegador é instantâneo.
    #
    # "Especulativa" porque o turno ainda pode mudar de rumo (uma ferramenta
    # roda e o modelo reescreve). Se mudar, perdemos UMA chamada ao Kokoro,
    # que é self-hosted. O encontro é pelo hash do texto: se a frase final for
    # a mesma, o aquecimento oficial acha pronto e não sintetiza de novo.
    escuta = None
    if entrada.voz:
        ja = {"disparou": False}

        def _na_primeira_frase(parcial: str) -> bool:
            if ja["disparou"]:
                return True
            falas = _partir_em_falas(parcial)
            if not falas:
                return False
            # < 40 chars ainda pode ser colado na frase seguinte por
            # `_partir_em_falas` — sintetizar agora seria sintetizar outra coisa.
            if len(falas[0]) < 40:
                return False
            ja["disparou"] = True
            logger.info("webchat voz: especulando o TTS de %d chars", len(falas[0]))
            _agendar(_audio_da_frase(falas[0]))
            return True

        escuta = tier_engine.escutar_primeira_frase(_na_primeira_frase)

    try:
        tarefa = _agendar(_rodar_runtime())
    finally:
        # O contexto já foi copiado pela tarefa — desligo aqui pra não vazar
        # a escuta pro resto da requisição.
        if escuta is not None:
            tier_engine.parar_de_escutar(escuta)

    # Espera o PRIMEIRO dos dois: a resposta na fila ou o runtime terminar.
    # (O adapter webchat envia a resposta INTEIRA num push só — sem corrida de
    # balão atrasado chegando depois do drain.)
    baloes: list[str] = []
    resultado: dict = {}
    while True:
        baloes = await drenar(chat_id)
        if baloes:
            break
        if tarefa.done():
            # o push pode ter acontecido entre o drain e o done — confere de novo
            baloes = await drenar(chat_id)
            break
        if time.monotonic() - t_pronto > 90:
            logger.error("webchat: runtime passou de 90s slug=%s — respondo sem ele", slug)
            break
        await asyncio.wait({tarefa}, timeout=0.15)

    if tarefa.done() and not tarefa.cancelled():
        try:
            resultado = tarefa.result()
        except Exception:
            logger.exception("webchat: runtime falhou slug=%s", slug)
            resultado = {"status": "engine_error"}
    t_resposta = time.monotonic()

    status = str(resultado.get("status") or "ok")

    if not baloes:
        # O runtime tem caminhos que não respondem nada (bot pausado por handoff,
        # tenant suspenso, provider desligado). Não devolver silêncio pro visitante.
        baloes = [_recado_de_silencio(status)]

    audio_urls: list[str] = []
    if entrada.voz:
        # uma URL por frase: a 1a toca quase de imediato (e já sai aquecendo)
        audio_urls = await _preparar_falas(" ".join(baloes))

    logger.info(
        "webchat timing slug=%s voz=%s total=%.2fs — preparo=%.2fs resposta=%.2fs falas=%.2fs fundo=%s",
        slug, entrada.voz, time.monotonic() - t0,
        t_pronto - t0, t_resposta - t_pronto, time.monotonic() - t_resposta,
        "rodando" if not tarefa.done() else "concluido",
    )

    return RespostaMensagem(
        baloes=baloes,
        status=status,
        encerrado=status in {"tenant_suspended", "agent_inactive"},
        audio_url=(audio_urls[0] if audio_urls else None),
        audio_urls=audio_urls,
    )


def _recado_de_silencio(status: str) -> str:
    """Quando o agente não produz texto, o visitante ainda merece uma resposta."""
    recados = {
        "handed_off_paused": "Sua mensagem foi registrada — um atendente vai responder por aqui.",
        "handoff": "Já avisei a equipe. Alguém entra em contato em instantes.",
        "tenant_suspended": "Este atendimento está temporariamente indisponível.",
        "agent_inactive": "Este atendimento está temporariamente indisponível.",
        "llm_disabled": "Este atendimento está temporariamente indisponível.",
        "blocked_moderation": "Não consigo responder a essa mensagem.",
        "injection_blocked": "Não consigo responder a essa mensagem.",
    }
    return recados.get(status, "Tive um problema para responder agora. Pode repetir?")

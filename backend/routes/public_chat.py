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

import json
import logging
import os
import re
import secrets
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
from services import agent_runtime
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
    """Guarda cada frase sob um token e devolve as URLs, na ordem."""
    texto = (texto or "").strip()[:TTS_MAX_CHARS]
    if not texto or not _provedores_tts():
        return []

    base = (getattr(settings, "public_api_url", None) or "https://api-agent.tier.finance/api/v1").rstrip("/")
    urls: list[str] = []
    try:
        r = await _redis()
        try:
            for fala in _partir_em_falas(texto):
                token = secrets.token_urlsafe(16)
                await r.setex(f"webchat:voz:{token}", 300, fala)
                urls.append(f"{base}/public/chat/voz/{token}")
        finally:
            await r.aclose()
    except Exception:
        logger.exception("webchat voz: não consegui guardar as falas")
        return []
    return urls


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
        return r.audio_bytes

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

    try:
        r = await _redis()
        try:
            texto = await r.get(f"webchat:voz:{token}")
        finally:
            await r.aclose()
    except Exception:
        logger.exception("webchat voz: redis fora ao buscar a fala")
        raise HTTPException(503, "Áudio indisponível") from None

    if not texto:
        raise HTTPException(404, "Áudio não encontrado")

    # 🚨 Devolve o arquivo COMPLETO, com Content-Length. StreamingResponse em
    # chunked cross-origin sem Content-Length faz o <audio> do Chrome pendurar:
    # o  e chamado, o evento  nunca dispara e nao sai som.
    # Como a fala aqui e UMA FRASE, sintetizar inteiro custa ~1s.
    audio = await _audio_da_frase(texto)
    if not audio:
        raise HTTPException(503, "Não consegui gerar o áudio")
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
    """Manda uma mensagem pro agente e devolve o que ele respondeu."""
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

    async with db_context() as db:
        resultado = await agent_runtime.handle_inbound_message(
            db,
            connector_kind="webchat",
            instance_id=slug,
            external_chat_id=chat_id,
            sender_name=(entrada.nome or "").strip() or "Visitante",
            text_content=texto,
            modo_voz=entrada.voz,  # tela de voz: resposta curta, gera mais rapido
        )

    baloes = await drenar(chat_id)
    status = str(resultado.get("status") or "ok")

    if not baloes:
        # O runtime tem caminhos que não respondem nada (bot pausado por handoff,
        # tenant suspenso, provider desligado). Não devolver silêncio pro visitante.
        baloes = [_recado_de_silencio(status)]

    audio_urls: list[str] = []
    if entrada.voz:
        # uma URL por frase: a 1a toca quase de imediato
        audio_urls = await _preparar_falas(" ".join(baloes))

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

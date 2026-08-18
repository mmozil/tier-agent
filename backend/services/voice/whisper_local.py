"""STT local com faster-whisper — grátis, sem chave, roda na CPU do servidor.

Mesmo padrão do fallback local do Vivaldi (whisper local). Não depende de
nenhum provedor externo nem de chave de API. Modelo configurável via
`WHISPER_MODEL` (default "small" — bom equilíbrio qualidade pt-BR x CPU).

- Carrega o modelo 1x por processo (lazy singleton) — só quando chega o 1º áudio.
- A transcrição (CPU-bound) roda em thread (`asyncio.to_thread`) pra NÃO travar
  o event loop do FastAPI.
- Aceita ogg/opus do WhatsApp direto (faster-whisper decodifica via PyAV).
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile

import httpx

from services.voice.deepgram_client import TranscribeResult

logger = logging.getLogger(__name__)

_MODEL = None
_MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")


def _get_model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel

        logger.info("carregando whisper local model=%s (cpu/int8)…", _MODEL_NAME)
        _MODEL = WhisperModel(_MODEL_NAME, device="cpu", compute_type="int8")
        logger.info("whisper local pronto (model=%s)", _MODEL_NAME)
    return _MODEL


def _transcribe_file(path: str, language: str) -> tuple[str, float, list[dict]]:
    """Devolve (texto, duração, trechos com tempo).

    Os trechos SEMPRE existiram — o faster-whisper entrega `start`/`end` em cada
    segmento e a gente jogava fora ao juntar o texto. Guardar é de graça, e é o
    que deixa a ata do Discoo dizer em que minuto cada tarefa foi combinada.
    """
    model = _get_model()
    segments, info = model.transcribe(path, language=language, beam_size=1, vad_filter=True)
    trechos: list[dict] = []
    partes: list[str] = []
    # o gerador do faster-whisper é consumido UMA vez — daí montar texto e
    # trechos no mesmo laço em vez de iterar duas.
    for s in segments:
        t = (s.text or "").strip()
        if not t:
            continue
        partes.append(t)
        trechos.append({"inicio": round(float(s.start or 0), 2), "fim": round(float(s.end or 0), 2), "texto": t})
    return " ".join(partes).strip(), float(getattr(info, "duration", 0) or 0), trechos


async def transcribe_bytes(
    data: bytes, *, language: str = "pt"
) -> TranscribeResult:
    """Transcreve bytes de áudio já em memória (ex: mídia Cloud baixada com token)."""
    if not data:
        return TranscribeResult(ok=False, text="", error="áudio vazio")
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
            f.write(data)
            tmp = f.name
        text, dur, trechos = await asyncio.to_thread(_transcribe_file, tmp, language)
        return TranscribeResult(
            ok=bool(text),
            text=text,
            confidence=1.0 if text else 0.0,
            duration_seconds=dur,
            language=language,
            segments=trechos,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("whisper local falhou")
        return TranscribeResult(ok=False, text="", error=f"whisper: {e}")
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except Exception:  # noqa: BLE001
                pass


async def transcribe_url(
    audio_url: str, *, language: str = "pt", timeout_s: int = 60
) -> TranscribeResult:
    """Baixa o áudio da URL pública (R2 do Engine) e transcreve local."""
    if not audio_url:
        return TranscribeResult(ok=False, text="", error="audio_url vazio")
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.get(audio_url)
        if r.status_code >= 400:
            return TranscribeResult(ok=False, text="", error=f"download HTTP {r.status_code}")
        data = r.content
    except Exception as e:  # noqa: BLE001
        return TranscribeResult(ok=False, text="", error=f"download: {e}")
    return await transcribe_bytes(data, language=language)

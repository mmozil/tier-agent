"""Deepgram STT — transcrição de áudio PT-BR.

Nova-3 model padrão (~$0.0043/min). Aceita URL pública (R2 do Engine) ou bytes
diretos. Retorna transcript + duração + confidence.

Docs: https://developers.deepgram.com/reference/speech-to-text-api/listen
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "nova-3"
DEFAULT_LANGUAGE = "pt-BR"


@dataclass
class TranscribeResult:
    ok: bool
    text: str
    confidence: float = 0.0
    duration_seconds: float = 0.0
    language: str = DEFAULT_LANGUAGE
    error: str | None = None
    # Trechos com tempo: [{"inicio": 12.4, "fim": 15.9, "texto": "..."}].
    # Só o whisper local preenche hoje. O Discoo usa pra carimbar o minuto em
    # cada tarefa da ata — sem isso a linha existe, só não tem [12:04].
    segments: list[dict] | None = None


async def transcribe_url(
    audio_url: str,
    *,
    language: str = DEFAULT_LANGUAGE,
    model: str = DEFAULT_MODEL,
    timeout_s: int = 30,
) -> TranscribeResult:
    """Transcreve áudio acessível via URL pública (R2 do Tier WhatsApp Engine)."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        return TranscribeResult(ok=False, text="", error="DEEPGRAM_API_KEY ausente")
    if not audio_url:
        return TranscribeResult(ok=False, text="", error="audio_url vazio")

    params = {
        "model": model,
        "language": language,
        "smart_format": "true",
        "punctuate": "true",
    }
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"url": audio_url}

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(
                "https://api.deepgram.com/v1/listen",
                params=params,
                headers=headers,
                json=payload,
            )
    except Exception as e:
        return TranscribeResult(ok=False, text="", error=f"deepgram conn: {e}")

    if r.status_code >= 400:
        return TranscribeResult(
            ok=False, text="", error=f"deepgram HTTP {r.status_code}: {r.text[:200]}"
        )

    try:
        data = r.json()
        results = data.get("results", {})
        channels = results.get("channels") or []
        if not channels:
            return TranscribeResult(ok=False, text="", error="no channels in response")
        alt = (channels[0].get("alternatives") or [{}])[0]
        text = (alt.get("transcript") or "").strip()
        conf = float(alt.get("confidence", 0))
        duration = float(data.get("metadata", {}).get("duration", 0))
        return TranscribeResult(
            ok=bool(text),
            text=text,
            confidence=conf,
            duration_seconds=duration,
            language=language,
        )
    except Exception as e:
        return TranscribeResult(ok=False, text="", error=f"parse: {e}")


async def transcribe_bytes(
    audio_bytes: bytes,
    *,
    mime: str = "audio/ogg",
    language: str = DEFAULT_LANGUAGE,
    model: str = DEFAULT_MODEL,
    timeout_s: int = 30,
) -> TranscribeResult:
    """Transcreve áudio binário direto (sem URL pública)."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        return TranscribeResult(ok=False, text="", error="DEEPGRAM_API_KEY ausente")
    if not audio_bytes:
        return TranscribeResult(ok=False, text="", error="audio_bytes vazio")

    params = {
        "model": model,
        "language": language,
        "smart_format": "true",
        "punctuate": "true",
    }
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": mime,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(
                "https://api.deepgram.com/v1/listen",
                params=params,
                headers=headers,
                content=audio_bytes,
            )
    except Exception as e:
        return TranscribeResult(ok=False, text="", error=f"deepgram conn: {e}")

    if r.status_code >= 400:
        return TranscribeResult(
            ok=False, text="", error=f"deepgram HTTP {r.status_code}: {r.text[:200]}"
        )

    try:
        data = r.json()
        channels = (data.get("results") or {}).get("channels") or []
        if not channels:
            return TranscribeResult(ok=False, text="", error="no channels")
        alt = (channels[0].get("alternatives") or [{}])[0]
        return TranscribeResult(
            ok=True,
            text=(alt.get("transcript") or "").strip(),
            confidence=float(alt.get("confidence", 0)),
            duration_seconds=float(data.get("metadata", {}).get("duration", 0)),
            language=language,
        )
    except Exception as e:
        return TranscribeResult(ok=False, text="", error=f"parse: {e}")

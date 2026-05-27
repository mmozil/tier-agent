"""ElevenLabs TTS — voz Flash v2.5 PT-BR.

Custos ~$0.0008/1k chars (50% off via cache).
Default voice = "Rachel" (21m00Tcm4TlvDq8ikWAM) — multilingue PT-BR aceitável.
Cliente pode override via env ELEVENLABS_VOICE_ID.

Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel — multilingue
DEFAULT_MODEL_ID = "eleven_flash_v2_5"  # latência baixa + PT-BR
DEFAULT_FORMAT = "mp3_44100_64"  # boa qualidade, tamanho ok


@dataclass
class SynthesizeResult:
    ok: bool
    audio_bytes: bytes = b""
    mime: str = "audio/mpeg"
    duration_estimate_s: float = 0.0
    chars: int = 0
    error: str | None = None


async def synthesize(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_FORMAT,
    timeout_s: int = 30,
) -> SynthesizeResult:
    """Gera áudio TTS a partir de texto.

    Retorna bytes MP3. Caller upload pra R2 (via storage_service) e envia URL
    pelo WhatsApp Engine.
    """
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return SynthesizeResult(ok=False, error="ELEVENLABS_API_KEY ausente")

    text = (text or "").strip()
    if not text:
        return SynthesizeResult(ok=False, error="text vazio")
    # ElevenLabs limita ~5000 chars/request
    if len(text) > 5000:
        text = text[:5000]

    vid = voice_id or os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE_ID
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    params = {"output_format": output_format}
    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(url, headers=headers, params=params, json=payload)
    except Exception as e:
        return SynthesizeResult(ok=False, error=f"elevenlabs conn: {e}")

    if r.status_code >= 400:
        return SynthesizeResult(
            ok=False,
            error=f"elevenlabs HTTP {r.status_code}: {r.text[:200]}",
        )

    audio = r.content
    if not audio:
        return SynthesizeResult(ok=False, error="empty audio response")

    # Estimativa rough: 150 chars/min em pt-BR speech
    duration = len(text) / 150 * 60

    return SynthesizeResult(
        ok=True,
        audio_bytes=audio,
        mime="audio/mpeg",
        duration_estimate_s=duration,
        chars=len(text),
    )

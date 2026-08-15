"""TTS por protocolo OpenAI (`POST /v1/audio/speech`) — serve vários provedores.

Um cliente só atende:
  - **Kokoro-FastAPI** self-hosted (Apache 2.0, roda em CPU, vozes pt-BR
    `pf_dora` / `pm_alex` / `pm_santa`) — sem chave e sem custo por caractere
  - OpenAI (`tts-1`, `gpt-4o-mini-tts`)
  - DeepInfra, Groq/PlayAI e qualquer outro que copie o mesmo formato

Só muda a base e o nome da voz. Diferente do MiniMax (JSON com áudio em hex) e do
ElevenLabs (rota própria por voz), aqui a resposta já é o binário do áudio.

Kokoro aceita chave vazia — é justamente o ponto dele.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "kokoro"
DEFAULT_VOICE = "pf_dora"  # feminina pt-BR do Kokoro


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
    model_id: str | None = None,
    timeout_s: int = 60,
) -> SynthesizeResult:
    """Gera o MP3 de um texto. Mesma assinatura dos outros clientes de voz."""
    base = (os.environ.get("TTS_OPENAI_BASE_URL") or "").rstrip("/")
    if not base:
        return SynthesizeResult(ok=False, error="TTS_OPENAI_BASE_URL ausente")

    text = (text or "").strip()
    if not text:
        return SynthesizeResult(ok=False, error="text vazio")
    if len(text) > 5000:
        text = text[:5000]

    voz = voice_id or os.environ.get("TTS_OPENAI_VOICE") or DEFAULT_VOICE
    modelo = model_id or os.environ.get("TTS_OPENAI_MODEL") or DEFAULT_MODEL
    chave = os.environ.get("TTS_OPENAI_API_KEY") or "sem-chave"  # Kokoro ignora

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(
                f"{base}/v1/audio/speech",
                headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"},
                json={
                    "model": modelo,
                    "input": text,
                    "voice": voz,
                    "response_format": "mp3",
                },
            )
    except Exception as e:
        return SynthesizeResult(ok=False, error=f"tts openai-compat conn: {e}")

    if r.status_code >= 400:
        return SynthesizeResult(ok=False, error=f"tts HTTP {r.status_code}: {r.text[:200]}")

    audio = r.content
    # Erro pode voltar como JSON com HTTP 200 em alguns provedores.
    if not audio or audio[:1] == b"{":
        return SynthesizeResult(ok=False, error=f"tts sem áudio: {r.text[:160]}")

    return SynthesizeResult(
        ok=True,
        audio_bytes=audio,
        mime="audio/mpeg",
        duration_estimate_s=len(text) / 150 * 60,
        chars=len(text),
    )

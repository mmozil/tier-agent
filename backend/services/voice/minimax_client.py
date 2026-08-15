"""MiniMax TTS (T2A v2) — voz sintética multilíngue com reforço de português.

Alternativa ao ElevenLabs. Mesma assinatura de `elevenlabs_client.synthesize`,
então o chamador troca de provedor sem saber a diferença.

🚨 Dois domínios, duas contas diferentes:
  - `api.minimaxi.chat` / `api.minimax.io` → internacional
  - `api.minimax.chat`                    → China
A MESMA chave dá `invalid api key` no domínio errado. Se aparecer 2049, o
provável é domínio trocado, não chave ruim.

O áudio volta em **hex dentro do JSON** (`data.audio`), não como corpo binário.

Docs: https://www.minimax.io/platform/document/T2A%20V2
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_HOST = "https://api.minimaxi.chat"
DEFAULT_MODEL = "speech-02-turbo"  # baixa latência; `speech-02-hd` tem mais qualidade
DEFAULT_VOICE = "female-shaonv"
# Sem isto o modelo tende ao inglês/mandarim na pronúncia de nomes em pt-BR.
LANGUAGE_BOOST = "Portuguese"


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
    timeout_s: int = 40,
) -> SynthesizeResult:
    """Gera o MP3 de um texto. Devolve bytes prontos pra subir no R2."""
    api_key = os.environ.get("MINIMAX_API_KEY")
    if not api_key:
        return SynthesizeResult(ok=False, error="MINIMAX_API_KEY ausente")

    text = (text or "").strip()
    if not text:
        return SynthesizeResult(ok=False, error="text vazio")
    if len(text) > 5000:
        text = text[:5000]

    host = (os.environ.get("MINIMAX_HOST") or DEFAULT_HOST).rstrip("/")
    vid = voice_id or os.environ.get("MINIMAX_VOICE_ID") or DEFAULT_VOICE
    modelo = model_id or os.environ.get("MINIMAX_TTS_MODEL") or DEFAULT_MODEL

    url = f"{host}/v1/t2a_v2"
    # Algumas contas exigem GroupId na query; quando não exigem, mandar não atrapalha.
    params = {}
    grupo = os.environ.get("MINIMAX_GROUP_ID")
    if grupo:
        params["GroupId"] = grupo

    payload = {
        "model": modelo,
        "text": text,
        "stream": False,
        "language_boost": LANGUAGE_BOOST,
        "voice_setting": {"voice_id": vid, "speed": 1.0, "vol": 1.0, "pitch": 0},
        "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.post(
                url,
                params=params,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
    except Exception as e:
        return SynthesizeResult(ok=False, error=f"minimax conn: {e}")

    if r.status_code >= 400:
        return SynthesizeResult(ok=False, error=f"minimax HTTP {r.status_code}: {r.text[:200]}")

    try:
        corpo = r.json()
    except Exception:
        return SynthesizeResult(ok=False, error="minimax: resposta não é JSON")

    # O erro vem com HTTP 200 e status_code no corpo — checar aqui é obrigatório.
    base = corpo.get("base_resp") or {}
    if base.get("status_code"):
        return SynthesizeResult(
            ok=False,
            error=f"minimax {base.get('status_code')}: {base.get('status_msg')}",
        )

    hexa = ((corpo.get("data") or {}).get("audio")) or ""
    if not hexa:
        return SynthesizeResult(ok=False, error="minimax: sem áudio na resposta")

    try:
        audio = bytes.fromhex(hexa)
    except ValueError:
        return SynthesizeResult(ok=False, error="minimax: áudio não veio em hex")

    return SynthesizeResult(
        ok=True,
        audio_bytes=audio,
        mime="audio/mpeg",
        duration_estimate_s=len(text) / 150 * 60,
        chars=len(text),
    )

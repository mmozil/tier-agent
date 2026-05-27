"""Nó send_audio — gera TTS (ElevenLabs Flash v2.5 PT-BR) + envia áudio pelo canal.

Pipeline:
1. Renderiza text com {{vars}}
2. ElevenLabs.synthesize → bytes MP3
3. Upload R2 (storage_service)
4. Acumula em ctx.outbound_messages com kind=audio + url R2
5. _flush_outbound do executor envia via WhatsApp Engine (já suporta audio)
"""

from __future__ import annotations

import logging

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_send_audio(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Gera áudio TTS + envia pelo canal.

    Config:
        text (str): conteúdo (suporta vars)
        voice_id (str, opcional): override default
        save_url_as (str, opcional): salva URL R2 gerada em vars[X]
    """
    raw = (config.get("text") or "").strip()
    if not raw:
        return NodeResult(error="send_audio: text vazio")

    text = render_string(raw, ctx.template_context)
    voice_id = (config.get("voice_id") or "").strip() or None
    save_url_as = (config.get("save_url_as") or "").strip() or None

    try:
        from services.voice import elevenlabs_client

        result = await elevenlabs_client.synthesize(text, voice_id=voice_id)
    except Exception as e:
        return NodeResult(error=f"send_audio synthesize: {e}")

    if not result.ok or not result.audio_bytes:
        return NodeResult(error=f"send_audio: {result.error or 'audio vazio'}")

    # Upload R2 pra ter URL pública (Engine envia áudio por URL)
    try:
        from services.storage_service import storage

        upload = storage.upload(
            result.audio_bytes,
            folder=f"voice/agent-{ctx.agent_id}",
            filename=f"tts-{ctx.execution_id}-{abs(hash(text)) % 100000}.mp3",
            content_type="audio/mpeg",
        )
        audio_url = upload.get("url") if isinstance(upload, dict) else str(upload)
    except Exception as e:
        return NodeResult(error=f"send_audio upload R2: {e}")

    # Acumula no outbound — _flush_outbound do executor envia pelo canal
    ctx.outbound_messages.append(
        {
            "kind": "audio",
            "content": audio_url,
            "mime": result.mime,
            "text": text,  # caption opcional pro adapter
        }
    )

    vars_update = {}
    if save_url_as:
        vars_update[save_url_as] = audio_url

    return NodeResult(
        output={
            "audio_url": audio_url,
            "chars": result.chars,
            "duration_estimate_s": round(result.duration_estimate_s, 1),
            "text_preview": text[:100],
        },
        vars_update=vars_update,
    )

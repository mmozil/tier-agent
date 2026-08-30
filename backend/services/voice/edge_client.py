"""TTS pelas vozes neurais do Edge — o motor de leitura em voz alta da Microsoft.

Escolhido em 29/08/2026, depois de medir as treze vozes pt-BR gratuitas que
existem. Medido nesta frase de teste, tempo até o PRIMEIRO som:

    Edge Antônio      390 ms   (streama, termina em ~1,4 s)
    Edge Francisca    490 ms   (streama)
    Edge Thalita      930 ms   (streama)  ← a escolhida
    Piper faber       310 ms   (arquivo inteiro de uma vez)
    Kokoro pf_dora  1.440 ms   ← o que estava no ar

A Thalita não é a mais rápida das três — é a voz que o dono escolheu ouvindo.

🚨 ISTO NÃO É API OFICIAL. É o endpoint que o navegador Edge usa para ler página
em voz alta: sem contrato, sem suporte, sem SLA, sem permissão de uso comercial,
e pode ser cortado sem aviso. A decisão de usar assim mesmo foi tomada com esse
risco na mesa.

O que essa escolha exige em troca — e está implementado:

  · NUNCA ser o único motor. `TTS_PROVIDER` aceita lista, e a configuração em
    produção é `edge,openai_compat`: se o Edge cair, o Kokoro assume e a voz
    continua saindo. Feia e lenta, mas saindo.
  · trocar de volta é UMA variável de ambiente, sem deploy de código.

Streaming: a lib entrega o áudio em pedaços conforme a Microsoft manda. Como o
resto do sistema espera o MP3 inteiro (o `<audio>` do navegador precisa de
`Content-Length` — chunked cross-origin sem ele pendura o Chrome), aqui a gente
junta os pedaços. O ganho continua existindo, porque o gargalo era a síntese, não
o transporte.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Só existem TRÊS vozes pt-BR no Edge — conferido pela lista da própria API em
# 29/08/2026. As de Portugal (Duarte, Raquel) têm sotaque europeu e não servem
# para uma família brasileira.
DEFAULT_VOICE = "pt-BR-ThalitaMultilingualNeural"

VOZES_PT_BR = (
    "pt-BR-ThalitaMultilingualNeural",  # feminina, multilíngue
    "pt-BR-FranciscaNeural",            # feminina
    "pt-BR-AntonioNeural",              # masculina
)


@dataclass
class SynthesizeResult:
    ok: bool
    audio_bytes: bytes = b""
    mime: str = "audio/mpeg"
    duration_estimate_s: float = 0.0
    chars: int = 0
    error: str | None = None


def _voz() -> str:
    v = (os.environ.get("TTS_EDGE_VOICE") or "").strip() or DEFAULT_VOICE
    if v not in VOZES_PT_BR:
        # Não recusa: o Edge tem voz em dezenas de idiomas e alguém pode querer
        # uma de propósito. Só avisa, porque errar o nome devolve erro seco.
        logger.warning("edge tts: voz '%s' fora das três pt-BR conhecidas", v)
    return v


async def synthesize(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str | None = None,  # noqa: ARG001 — o Edge não tem modelo, só voz
    timeout_s: int = 60,
) -> SynthesizeResult:
    """Gera o MP3 de um texto. Mesma assinatura dos outros clientes de voz."""
    text = (text or "").strip()
    if not text:
        return SynthesizeResult(ok=False, error="text vazio")
    if len(text) > 5000:
        text = text[:5000]

    try:
        import edge_tts
    except ImportError:
        # Dependência ausente não pode derrubar a voz: quem chama percorre os
        # provedores em ordem e o próximo (Kokoro) assume.
        return SynthesizeResult(ok=False, error="edge-tts não instalado")

    voz = voice_id or _voz()
    ritmo = (os.environ.get("TTS_EDGE_RATE") or "+0%").strip()
    tom = (os.environ.get("TTS_EDGE_PITCH") or "+0Hz").strip()

    pedacos = bytearray()
    try:
        fala = edge_tts.Communicate(text, voz, rate=ritmo, pitch=tom)
        async for ch in fala.stream():
            if ch.get("type") == "audio" and ch.get("data"):
                pedacos += ch["data"]
    except Exception as e:  # noqa: BLE001
        # Endpoint não oficial: ele PODE sumir. Falhar aqui é previsto, e o
        # provedor seguinte na lista é quem salva a conversa.
        logger.warning("edge tts: falhou (%s) — o próximo provedor assume", e)
        return SynthesizeResult(ok=False, error=f"edge-tts: {e}")

    if not pedacos:
        return SynthesizeResult(ok=False, error="edge-tts devolveu áudio vazio")

    return SynthesizeResult(
        ok=True,
        audio_bytes=bytes(pedacos),
        mime="audio/mpeg",
        chars=len(text),
        # ~14 caracteres por segundo de fala em pt-BR, medido nas amostras.
        duration_estimate_s=round(len(text) / 14.0, 2),
    )

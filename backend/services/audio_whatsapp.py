"""Áudio gravado no navegador → mensagem de voz do WhatsApp (ogg/opus mono).

O WhatsApp só toca como MENSAGEM DE VOZ (a bolinha com a onda, não um arquivo)
o áudio em ogg/opus com `ptt=true`. O Engine rotula o que recebe como
`audio/ogg; codecs=opus` e não converte nada. O navegador grava em outro
formato: Chrome/Edge gravam webm/opus, Safari grava mp4/aac, só o Firefox grava
ogg. Por isso a conversão acontece aqui, com o PyAV que já vem com o
faster-whisper (as bibliotecas do ffmpeg vêm dentro do pacote; não precisa
instalar ffmpeg na imagem).
"""

from __future__ import annotations

import io


class AudioInvalido(ValueError):
    """O arquivo não tem áudio que dê para decodificar."""


def para_ogg_opus(dados: bytes, *, bitrate: int = 32_000) -> bytes:
    """Decodifica qualquer áudio que o ffmpeg leia e devolve ogg/opus mono 48 kHz."""
    import av  # import tardio: só quem envia áudio paga o custo

    try:
        entrada = av.open(io.BytesIO(dados))
    except Exception as e:  # noqa: BLE001 — qualquer erro do container vira "áudio inválido"
        raise AudioInvalido(f"não deu para abrir o áudio: {e}") from e
    try:
        fluxo = next((s for s in entrada.streams if s.type == "audio"), None)
        if fluxo is None:
            raise AudioInvalido("o arquivo não tem faixa de áudio")
        saida_buf = io.BytesIO()
        saida = av.open(saida_buf, mode="w", format="ogg")
        try:
            destino = saida.add_stream("libopus", rate=48_000)
            destino.bit_rate = bitrate
            destino.layout = "mono"
            reamostrar = av.AudioResampler(format="s16", layout="mono", rate=48_000)
            quadros = 0
            for quadro in entrada.decode(fluxo):
                quadro.pts = None
                for q in reamostrar.resample(quadro):
                    quadros += 1
                    for pacote in destino.encode(q):
                        saida.mux(pacote)
            for q in reamostrar.resample(None):
                for pacote in destino.encode(q):
                    saida.mux(pacote)
            for pacote in destino.encode(None):
                saida.mux(pacote)
            if not quadros:
                raise AudioInvalido("o áudio está vazio")
        finally:
            saida.close()
        return saida_buf.getvalue()
    finally:
        entrada.close()

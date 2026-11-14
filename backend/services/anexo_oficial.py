"""Anexo pelo painel no número OFICIAL (API da Meta) — 14/11/2026.

Até aqui o clipe do inbox só funcionava no número por QR: no oficial o servidor
recusava com 422 (caso Esneper, 8 tentativas em 14/11). A API da Meta aceita mídia
por link, com limites próprios mais apertados que os do QR — o que não cabe no
formato pedido vai como DOCUMENTO, que é o que o WhatsApp faria.

Limites da Meta (Cloud API, «Supported media types»):
  imagem  jpeg/png ............ 5 MB   (webp lá é figurinha, não foto)
  vídeo   mp4/3gpp ............ 16 MB
  áudio   ogg/opus, mp3, aac... 16 MB
  documento qualquer .......... 100 MB (o nosso teto de 25 MB vem antes)
"""

from __future__ import annotations

MB = 1024 * 1024

IMAGEM_OFICIAL = ("image/jpeg", "image/png")
LIMITE_IMAGEM_OFICIAL = 5 * MB
VIDEO_OFICIAL = ("video/mp4", "video/3gpp")
LIMITE_VIDEO_OFICIAL = 16 * MB
LIMITE_AUDIO_OFICIAL = 16 * MB

# Códigos da Meta para «passou da janela de 24 h desde a última mensagem do contato».
CODIGOS_FORA_DA_JANELA = {131047, 470}

MSG_FORA_DA_JANELA = (
    "Passaram 24 horas desde a última mensagem deste contato. No WhatsApp oficial, "
    "depois disso a Meta só deixa falar com um modelo aprovado (Nova conversa › modelo)."
)


def tipo_no_oficial(kind: str, mime: str, tamanho: int) -> str:
    """O tipo que o arquivo vai ter no número oficial. Fora do que a Meta aceita como
    foto/vídeo/áudio, vira documento — o contato recebe o arquivo do mesmo jeito."""
    mime = (mime or "").lower()
    if kind == "image" and (mime not in IMAGEM_OFICIAL or tamanho > LIMITE_IMAGEM_OFICIAL):
        return "document"
    if kind == "video" and (mime not in VIDEO_OFICIAL or tamanho > LIMITE_VIDEO_OFICIAL):
        return "document"
    if kind == "audio" and tamanho > LIMITE_AUDIO_OFICIAL:
        return "document"
    return kind


def legenda_vai_junto(oficial: bool, kind: str) -> bool:
    """A legenda segue no mesmo balão? No QR só a foto leva legenda (o Engine não aceita
    em documento/áudio). No oficial a Meta aceita em foto, vídeo e documento; áudio nunca."""
    if oficial:
        return kind in ("image", "video", "document")
    return kind == "image"


def mensagem_de_erro(meta_code: int | None, detalhe: str | None, bruto: str) -> tuple[int, str]:
    """(status HTTP, texto) para o painel. Fora da janela é regra da Meta, não falha nossa:
    422 com o caminho; o resto continua 502 com o motivo da Meta quando ele existe."""
    if meta_code in CODIGOS_FORA_DA_JANELA:
        return 422, MSG_FORA_DA_JANELA
    return 502, f"Falha ao enviar: {detalhe or bruto}"

"""Anexo pelo painel no número OFICIAL (14/11/2026, caso Esneper).

O clipe do inbox recusava com 422 no número da API da Meta. Agora vai: o tipo respeita os limites
da Meta (o que não cabe vira documento), a legenda segue no mesmo balão quando a Meta aceita, o
documento leva o nome do arquivo, vídeo deixou de cair no texto vazio, e passar da janela de 24 h
volta com o caminho do modelo em vez de «falha».
"""

import asyncio

from services.anexo_oficial import (
    MB,
    MSG_FORA_DA_JANELA,
    legenda_vai_junto,
    mensagem_de_erro,
    tipo_no_oficial,
)
from services.connectors.adapters import whatsapp_cloud
from services.connectors.base import ConnectorAttachment, ConnectorConfig, OutboundMessage


def _rodar(coro):
    # Mesmo padrão da casa: asyncio.run() desarma o laço global e quebra testes vizinhos.
    return asyncio.get_event_loop().run_until_complete(coro)


# ─── tipo do arquivo no oficial ─────────────────────────────────────────────


def test_foto_dentro_do_limite_continua_foto():
    assert tipo_no_oficial("image", "image/jpeg", 2 * MB) == "image"
    assert tipo_no_oficial("image", "image/png", 5 * MB) == "image"


def test_foto_grande_ou_webp_vira_documento():
    assert tipo_no_oficial("image", "image/jpeg", 5 * MB + 1) == "document"
    assert tipo_no_oficial("image", "image/webp", 100_000) == "document"


def test_video_mp4_vai_como_video_e_o_resto_como_documento():
    assert tipo_no_oficial("video", "video/mp4", 10 * MB) == "video"
    assert tipo_no_oficial("video", "video/quicktime", 1 * MB) == "document"
    assert tipo_no_oficial("video", "video/mp4", 16 * MB + 1) == "document"


def test_audio_e_documento_ficam_como_estao():
    assert tipo_no_oficial("audio", "audio/ogg", 1 * MB) == "audio"
    assert tipo_no_oficial("document", "application/pdf", 20 * MB) == "document"


# ─── legenda ────────────────────────────────────────────────────────────────


def test_legenda_no_oficial_vai_junto_menos_no_audio():
    assert legenda_vai_junto(True, "image")
    assert legenda_vai_junto(True, "document")
    assert legenda_vai_junto(True, "video")
    assert not legenda_vai_junto(True, "audio")


def test_legenda_no_qr_continua_so_na_foto():
    assert legenda_vai_junto(False, "image")
    assert not legenda_vai_junto(False, "document")
    assert not legenda_vai_junto(False, "video")


# ─── erro ───────────────────────────────────────────────────────────────────


def test_fora_da_janela_e_422_com_o_caminho_do_modelo():
    assert mensagem_de_erro(131047, "Re-engagement message", "bruto") == (422, MSG_FORA_DA_JANELA)
    assert mensagem_de_erro(470, None, "bruto") == (422, MSG_FORA_DA_JANELA)


def test_outro_erro_continua_502_com_o_motivo():
    assert mensagem_de_erro(131053, "Media upload error", "bruto") == (502, "Falha ao enviar: Media upload error")
    # QR (Engine): sem código da Meta, o texto de antes
    assert mensagem_de_erro(None, None, "Tier Engine retornou 409") == (502, "Falha ao enviar: Tier Engine retornou 409")


# ─── corpo que vai para a Meta ──────────────────────────────────────────────


def _cliente_que_guarda(guardado):
    class _Resp:
        status_code = 200

        def json(self):
            return {"messages": [{"id": "wamid.X"}]}

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            guardado.append(json)
            return _Resp()

    return _Cli


def _enviar(monkeypatch, anexo, legenda=""):
    guardado = []
    monkeypatch.setattr(whatsapp_cloud.httpx, "AsyncClient", _cliente_que_guarda(guardado))
    cfg = ConnectorConfig(data={"phone_number_id": "PID", "token": "TOK"})
    msg = OutboundMessage(external_chat_id="5511999990000", content=legenda, attachments=[anexo])
    _rodar(whatsapp_cloud.WhatsAppCloudConnector().send(cfg, msg))
    return guardado[0]


def test_documento_leva_o_nome_do_arquivo_e_a_legenda(monkeypatch):
    anexo = ConnectorAttachment(kind="document", url="https://r2/x.pdf", mime="application/pdf", name="Proposta Esneper.pdf")
    corpo = _enviar(monkeypatch, anexo, "Segue a proposta")
    assert corpo["type"] == "document"
    assert corpo["document"] == {
        "link": "https://r2/x.pdf",
        "caption": "Segue a proposta",
        "filename": "Proposta Esneper.pdf",
    }


def test_video_vai_como_video(monkeypatch):
    anexo = ConnectorAttachment(kind="video", url="https://r2/v.mp4", mime="video/mp4", name="v.mp4")
    corpo = _enviar(monkeypatch, anexo, "olha")
    assert corpo["type"] == "video"
    assert corpo["video"] == {"link": "https://r2/v.mp4", "caption": "olha"}


def test_foto_e_audio_seguem_como_antes(monkeypatch):
    foto = _enviar(monkeypatch, ConnectorAttachment(kind="image", url="https://r2/f.jpg", mime="image/jpeg"), "oi")
    assert foto["type"] == "image" and foto["image"] == {"link": "https://r2/f.jpg", "caption": "oi"}
    audio = _enviar(monkeypatch, ConnectorAttachment(kind="audio", url="https://r2/a.ogg", mime="audio/ogg"))
    assert audio["type"] == "audio" and audio["audio"] == {"link": "https://r2/a.ogg"}

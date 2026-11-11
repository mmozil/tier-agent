"""Link sem imagem de prévia sai limpo no WhatsApp oficial (11/11/2026, CCDA).

A página de agendamento do ccda.com.br não tem `og:image`: o celular de quem recebe caía no ícone
do site (192 px) esticado num quadrado — «a imagem parece sem qualidade». Agora o Agent confere
antes de mandar e, sem imagem, manda `preview_url: false`.
"""

import asyncio

import pytest

from services import previa_link
from services.connectors.adapters import whatsapp_cloud
from services.connectors.base import ConnectorConfig, OutboundMessage


@pytest.fixture(autouse=True)
def _banco_falso(monkeypatch):
    """O «site sem imagem» também vai para o banco (`ta_site_previa`). Nos testes, um dict —
    a bateria roda numa cópia DENTRO do contêiner de produção e não pode gravar lá."""
    sites: set[str] = set()

    async def _ler(host):
        return host in sites

    async def _gravar(host):
        sites.add(host)

    monkeypatch.setattr(previa_link, "_site_sem_imagem_no_banco", _ler)
    monkeypatch.setattr(previa_link, "gravar_site_sem_imagem", _gravar)
    monkeypatch.setattr(previa_link, "_ESPERAS_SEGUNDO_PLANO", (0.0, 0.01, 0.02))
    return sites


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _pagina(html: str):
    async def _baixar(_cli, url, _limite):
        return url, "text/html; charset=utf-8", html.encode()

    return _baixar


def _limpar():
    previa_link._CACHE_IMAGEM.clear()
    previa_link._CACHE_SITE_SEM_IMAGEM.clear()


def test_pagina_sem_og_image_e_false_com_og_image_e_true(monkeypatch):
    _limpar()
    monkeypatch.setattr(previa_link, "_baixar", _pagina('<html><head><title>CCDA</title><link rel="icon" href="/i.png"></head></html>'))
    assert _rodar(previa_link.pagina_tem_imagem("veja https://www.ccda.com.br/agendamento-de-visita/")) is False
    _limpar()
    monkeypatch.setattr(previa_link, "_baixar", _pagina('<html><head><meta property="og:image" content="https://x/y.jpg"></head></html>'))
    assert _rodar(previa_link.pagina_tem_imagem("https://site.com/a")) is True


def test_sem_link_ou_pagina_ilegivel_e_none(monkeypatch):
    _limpar()
    assert _rodar(previa_link.pagina_tem_imagem("sem link aqui")) is None

    async def _nada(*_a):
        return None

    monkeypatch.setattr(previa_link, "_baixar", _nada)
    assert _rodar(previa_link.pagina_tem_imagem("https://fora-do-ar.com.br/")) is None


def test_resultado_fica_em_cache(monkeypatch):
    _limpar()
    chamadas = []

    async def _conta(_cli, url, _limite):
        chamadas.append(url)
        return url, "text/html", b"<html><head><title>x</title></head></html>"

    monkeypatch.setattr(previa_link, "_baixar", _conta)
    for _ in range(3):
        assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/")) is False
    assert len(chamadas) == 1


class _Resp:
    status_code = 200

    def json(self):
        return {"messages": [{"id": "wamid.X"}]}


def _cliente_que_guarda(guardado):
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


def _enviar(monkeypatch, tem_imagem, texto):
    guardado = []

    async def _tem(_texto, **_k):
        return tem_imagem

    monkeypatch.setattr(previa_link, "pagina_tem_imagem", _tem)
    monkeypatch.setattr(whatsapp_cloud.httpx, "AsyncClient", _cliente_que_guarda(guardado))
    cfg = ConnectorConfig(data={"phone_number_id": "PID", "token": "TOK"})
    _rodar(whatsapp_cloud.WhatsAppCloudConnector().send(cfg, OutboundMessage(external_chat_id="5511999990000", content=texto)))
    return guardado[0]["text"]


def test_envio_desliga_previa_so_quando_a_pagina_nao_tem_imagem(monkeypatch):
    texto = "Aqui está o link: https://www.ccda.com.br/agendamento-de-visita/"
    assert _enviar(monkeypatch, False, texto)["preview_url"] is False
    assert _enviar(monkeypatch, True, texto)["preview_url"] is True
    assert _enviar(monkeypatch, None, texto)["preview_url"] is True  # não deu para ler: como antes
    assert _enviar(monkeypatch, None, "sem link")["preview_url"] is True


def test_youtube_nunca_desliga_a_previa(monkeypatch):
    _limpar()

    async def _nao_deve_baixar(*_a):
        raise AssertionError("YouTube não precisa ser lido")

    monkeypatch.setattr(previa_link, "_baixar", _nao_deve_baixar)
    assert _rodar(previa_link.pagina_tem_imagem("vídeo: https://www.youtube.com/watch?v=yJ9lZV-6_P8")) is True


def test_site_sem_imagem_vale_para_as_outras_paginas_sem_ler_de_novo(monkeypatch):
    _limpar()
    lidas = []

    async def _sem_og(_cli, url, _limite):
        lidas.append(url)
        return url, "text/html", b"<html><head><title>CCDA</title></head></html>"

    monkeypatch.setattr(previa_link, "_baixar", _sem_og)
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/")) is False
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/agendamento-de-visita/")) is False
    assert lidas == ["https://www.ccda.com.br/"]


def test_pagina_lenta_nao_segura_o_envio_e_termina_em_segundo_plano(monkeypatch):
    _limpar()

    async def _lenta(_cli, url, _limite):
        await asyncio.sleep(0.8)  # mais que o prazo do envio (0,05 + 0,5 de folga)
        return url, "text/html", b"<html><head><title>lenta</title></head></html>"

    monkeypatch.setattr(previa_link, "_baixar", _lenta)
    assert _rodar(previa_link.pagina_tem_imagem("https://lenta.com.br/p", prazo=0.05)) is None
    _rodar(asyncio.sleep(1.2))  # a conferência em segundo plano termina
    assert _rodar(previa_link.pagina_tem_imagem("https://lenta.com.br/p", prazo=0.05)) is False


def test_site_sem_imagem_no_banco_vale_para_o_outro_processo(monkeypatch, _banco_falso):
    """2 processos: o que leu o site grava no banco; o outro, com a memória vazia, já sabe."""
    _limpar()
    monkeypatch.setattr(previa_link, "_baixar", _pagina("<html><head><title>CCDA</title></head></html>"))
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/")) is False
    assert "ccda.com.br" in _banco_falso
    _limpar()  # «o outro processo»: memória vazia

    async def _nao_deve_ler(*_a):
        raise AssertionError("o banco já sabe")

    monkeypatch.setattr(previa_link, "_baixar", _nao_deve_ler)
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/agendamento-de-visita/")) is False


def test_segundo_plano_tenta_de_novo_e_grava_no_banco(monkeypatch, _banco_falso):
    """O ccda.com.br falha de vez em quando (ConnectTimeout às 19:25 de 11/11)."""
    _limpar()
    tentativas = []

    async def _falha_duas_vezes(_cli, url, _limite):
        tentativas.append(url)
        if len(tentativas) < 3:
            await asyncio.sleep(0.8)  # estoura o prazo do envio e o 2º plano tenta de novo
            return None
        return url, "text/html", b"<html><head><title>CCDA</title></head></html>"

    monkeypatch.setattr(previa_link, "_baixar", _falha_duas_vezes)
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/agendamento-de-visita/", prazo=0.05)) is None
    _rodar(asyncio.sleep(2.5))
    assert len(tentativas) == 3 and "ccda.com.br" in _banco_falso
    assert _rodar(previa_link.pagina_tem_imagem("https://www.ccda.com.br/agendamento-de-visita/")) is False


def test_pagina_com_imagem_nao_marca_o_site(monkeypatch, _banco_falso):
    _limpar()
    monkeypatch.setattr(previa_link, "_baixar", _pagina('<html><head><meta property="og:image" content="https://x/y.jpg"></head></html>'))
    assert _rodar(previa_link.pagina_tem_imagem("https://tier.finance/")) is True
    assert not _banco_falso


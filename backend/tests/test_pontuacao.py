"""A pontuação do texto falado — e a trava que impede o modelo de reescrever.

🚨 O defeito: o Web Speech do Chrome em pt-BR devolve UMA linha minúscula sem
pontuação. "Um linguição", nas palavras do dono. Três perguntas coladas viram
uma frase só, e o modelo responde a uma delas.

🚨 O risco: um modelo que PONTUA é aceitável; um que REESCREVE, não. Numa
conversa de matrícula, palavra trocada é pior que vírgula faltando.
"""
import os

for _k, _v in {
    "DATABASE_URL": "postgresql+asyncpg://x:x@localhost/x",
    "JWT_SECRET": "x" * 32,
    "FERNET_KEY": "ZmFrZS1mZXJuZXQta2V5LWZvci11bml0LXRlc3RzLTAxMg=",
    "REDIS_URL": "redis://localhost:6379/0",
}.items():
    os.environ.setdefault(_k, _v)

import httpx
import pytest

from services.voice import pontuacao_client

CRU = "vocês atendem no sábado qual o horário"
PONTUADO = "Vocês atendem no sábado, qual o horário?"


def _servico(resposta, status=200):
    """Troca o AsyncClient por um que responde o que o teste mandar."""
    transporte = httpx.MockTransport(lambda req: httpx.Response(status, json=resposta))
    original = httpx.AsyncClient

    class Cliente(original):
        def __init__(self, *a, **kw):
            kw["transport"] = transporte
            super().__init__(*a, **kw)

    return original, Cliente


async def _com(resposta, texto=CRU, status=200, monkeypatch=None):
    original, Cliente = _servico(resposta, status)
    httpx.AsyncClient = Cliente
    try:
        return await pontuacao_client.pontuar(texto)
    finally:
        httpx.AsyncClient = original


@pytest.mark.asyncio
async def test_pontua(monkeypatch):
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await _com({"texto": PONTUADO}) == PONTUADO


@pytest.mark.asyncio
async def test_sem_url_configurada_devolve_o_cru(monkeypatch):
    """Desligar a pontuação é apagar a variável — sem deploy."""
    monkeypatch.delenv("PONTUACAO_URL", raising=False)
    assert await pontuacao_client.pontuar(CRU) == CRU


@pytest.mark.asyncio
async def test_servico_fora_do_ar_nao_cala_o_agente(monkeypatch):
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await _com({}, status=503) == CRU


@pytest.mark.asyncio
async def test_resposta_vazia_devolve_o_cru(monkeypatch):
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await _com({"texto": "   "}) == CRU


@pytest.mark.asyncio
async def test_palavra_a_mais_e_recusado(monkeypatch):
    """🚨 A trava. Pontuar não muda a contagem de palavras; reescrever muda."""
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    inventado = "Vocês atendem no sábado, qual é mesmo o horário?"
    assert await _com({"texto": inventado}) == CRU


@pytest.mark.asyncio
async def test_palavra_a_menos_e_recusado(monkeypatch):
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await _com({"texto": "Vocês atendem no sábado?"}) == CRU


@pytest.mark.asyncio
async def test_mesmas_palavras_com_acento_e_maiuscula_passa(monkeypatch):
    """Trocar caixa e pôr acento é o trabalho dele — não conta como reescrita."""
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await _com({"texto": PONTUADO}) == PONTUADO


@pytest.mark.asyncio
async def test_texto_vazio_nao_chama_o_servico(monkeypatch):
    monkeypatch.setenv("PONTUACAO_URL", "http://tier-pontuacao:9100")
    assert await pontuacao_client.pontuar("   ") == "   "

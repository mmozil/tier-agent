"""O cliente de voz do Edge — escolhido em 29/08/2026 pela voz, não pelo tempo.

🚨 É endpoint NÃO OFICIAL da Microsoft: sem contrato, sem SLA, e pode ser cortado
sem aviso. A decisão foi tomada com isso na mesa, e o que ela exige em troca está
testado aqui: o Edge NUNCA pode ser o único motor. Falha dele tem que cair no
Kokoro, não silenciar o agente.
"""
import os

for _k, _v in {
    "DATABASE_URL": "postgresql+asyncpg://x:x@localhost/x",
    "JWT_SECRET": "x" * 32,
    "FERNET_KEY": "ZmFrZS1mZXJuZXQta2V5LWZvci11bml0LXRlc3RzLTAxMg=",
    "REDIS_URL": "redis://localhost:6379/0",
}.items():
    os.environ.setdefault(_k, _v)

import pytest

from routes.public_chat import _provedores_tts
from services.voice import edge_client


def test_a_lista_de_provedores_aceita_virgula(monkeypatch):
    """🚨 O invariante da decisão: em produção são DOIS, nesta ordem."""
    monkeypatch.setenv("TTS_PROVIDER", "edge,openai_compat")
    assert _provedores_tts() == ["edge", "openai_compat"]


def test_um_nome_so_continua_valendo(monkeypatch):
    monkeypatch.setenv("TTS_PROVIDER", "openai_compat")
    assert _provedores_tts() == ["openai_compat"]


def test_espaco_e_maiuscula_nao_quebram(monkeypatch):
    monkeypatch.setenv("TTS_PROVIDER", " Edge , OpenAI_Compat ")
    assert _provedores_tts() == ["edge", "openai_compat"]


def test_sem_forcar_o_edge_entra_na_frente_do_kokoro(monkeypatch):
    """Quem manda na ordem automática é ter voz configurada."""
    monkeypatch.delenv("TTS_PROVIDER", raising=False)
    monkeypatch.setenv("TTS_EDGE_VOICE", "pt-BR-ThalitaMultilingualNeural")
    monkeypatch.setenv("TTS_OPENAI_BASE_URL", "http://kokoro-tts:8880")
    ordem = _provedores_tts()
    assert ordem.index("edge") < ordem.index("openai_compat")


def test_a_thalita_e_o_padrao():
    assert edge_client.DEFAULT_VOICE == "pt-BR-ThalitaMultilingualNeural"
    assert edge_client.DEFAULT_VOICE in edge_client.VOZES_PT_BR


def test_so_existem_tres_vozes_pt_br():
    """Conferido na lista da própria API em 29/08/2026. Se um dia virar quatro,
    este teste cai e alguém vai olhar — que é o objetivo."""
    assert len(edge_client.VOZES_PT_BR) == 3
    assert all(v.startswith("pt-BR-") for v in edge_client.VOZES_PT_BR)


@pytest.mark.asyncio
async def test_sem_a_lib_instalada_nao_explode(monkeypatch):
    """Dependência ausente é falha de provedor, não do turno: o Kokoro assume."""
    import builtins
    real = builtins.__import__

    def sem_edge(nome, *a, **kw):
        if nome == "edge_tts":
            raise ImportError("simulando ausência")
        return real(nome, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", sem_edge)
    r = await edge_client.synthesize("teste")
    assert not r.ok
    assert "não instalado" in r.error


@pytest.mark.asyncio
async def test_texto_vazio_nao_chama_a_microsoft():
    r = await edge_client.synthesize("   ")
    assert not r.ok
    assert "vazio" in r.error


@pytest.mark.asyncio
async def test_falha_devolve_resultado_e_nao_levanta(monkeypatch):
    """🚨 Levantar aqui mataria o turno inteiro. O contrato é devolver ok=False
    para o chamador seguir para o próximo provedor."""
    class Explode:
        def __init__(self, *a, **kw):
            raise RuntimeError("endpoint fora do ar")

    edge_tts = pytest.importorskip("edge_tts")
    monkeypatch.setattr(edge_tts, "Communicate", Explode)
    r = await edge_client.synthesize("teste")
    assert not r.ok
    assert "fora do ar" in r.error


def test_voz_vem_do_ambiente(monkeypatch):
    monkeypatch.setenv("TTS_EDGE_VOICE", "pt-BR-FranciscaNeural")
    assert edge_client._voz() == "pt-BR-FranciscaNeural"

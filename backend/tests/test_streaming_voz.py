"""O streaming da tela de voz — e a armadilha que ele traz junto.

🚨 O ganho é de ORDEM, não de velocidade: a primeira frase vai pro TTS enquanto
o modelo ainda escreve o resto. Medido antes: 6,5s da última sílaba ao primeiro
som, com 3s de modelo e 1,5s de Kokoro EM SÉRIE.

O risco mora no `tool_calls`: em SSE ele chega picotado por índice e o
`arguments` só fecha no último pedaço. Remontar errado não dá erro — dá um
agente que conversa bem e não move mais nada no CRM, que é o defeito mais caro
que este produto já teve.
"""
import os

# O Settings do app exige segredos; a suíte não fala com banco nem com nuvem
# aqui — o que se testa é o parser de SSE, que é puro.
for _k, _v in {
    "database_url": "postgresql+asyncpg://x:x@localhost/x",
    "jwt_secret": "x" * 32,
    "fernet_key": "ZmFrZS1mZXJuZXQta2V5LWZvci11bml0LXRlc3RzLTAxMg=",
    "redis_url": "redis://localhost:6379/0",
}.items():
    os.environ.setdefault(_k.upper(), _v)

import json

import httpx
import pytest

from services import tier_engine


def _sse(eventos: list[dict]) -> bytes:
    linhas = [f"data: {json.dumps(e)}\n\n" for e in eventos]
    return ("".join(linhas) + "data: [DONE]\n\n").encode()


def _delta(**d):
    return {"choices": [{"delta": d}]}


async def _rodar(eventos, ouvinte):
    transporte = httpx.MockTransport(
        lambda req: httpx.Response(200, content=_sse(eventos), headers={"Content-Type": "text/event-stream"})
    )
    original = httpx.AsyncClient

    class Cliente(original):
        def __init__(self, *a, **kw):
            kw["transport"] = transporte
            super().__init__(*a, **kw)

    httpx.AsyncClient = Cliente
    try:
        return await tier_engine._stream_openai_compatible(
            base_url="https://x/v1", headers={}, payload={"model": "m", "messages": []},
            model="m", timeout_s=10, ouvinte=ouvinte,
        )
    finally:
        httpx.AsyncClient = original


@pytest.mark.asyncio
async def test_texto_remontado_na_ordem():
    r = await _rodar([_delta(content="Claro. "), _delta(content="O valor é 1.400.")], lambda _: True)
    assert r["choices"][0]["message"]["content"] == "Claro. O valor é 1.400."


@pytest.mark.asyncio
async def test_tool_call_picotada_volta_inteira():
    """🚨 O `arguments` chega em pedaços de JSON que só fecham no fim. Se a
    remontagem quebrar, o agente perde as ferramentas — conversa igual, e o
    card nunca mais anda."""
    r = await _rodar([
        _delta(tool_calls=[{"index": 0, "id": "c1", "function": {"name": "atualizar_campo_crm", "arguments": ""}}]),
        _delta(tool_calls=[{"index": 0, "function": {"arguments": '{"campo":"ano_'}}]),
        _delta(tool_calls=[{"index": 0, "function": {"arguments": 'escolar","valor":"4º ano"}'}}]),
    ], lambda _: True)
    tc = r["choices"][0]["message"]["tool_calls"]
    assert len(tc) == 1
    assert tc[0]["id"] == "c1"
    assert tc[0]["function"]["name"] == "atualizar_campo_crm"
    assert json.loads(tc[0]["function"]["arguments"]) == {"campo": "ano_escolar", "valor": "4º ano"}


@pytest.mark.asyncio
async def test_duas_ferramentas_no_mesmo_turno_nao_se_misturam():
    """O v3 chama campo E etapa no mesmo turno. Índices trocados grudariam o
    argumento de uma no nome da outra."""
    r = await _rodar([
        _delta(tool_calls=[
            {"index": 0, "id": "a", "function": {"name": "atualizar_campo_crm", "arguments": '{"c":1}'}},
            {"index": 1, "id": "b", "function": {"name": "atualizar_etapa_crm", "arguments": '{"e":2}'}},
        ]),
    ], lambda _: True)
    tc = r["choices"][0]["message"]["tool_calls"]
    assert [t["function"]["name"] for t in tc] == ["atualizar_campo_crm", "atualizar_etapa_crm"]
    assert [t["function"]["arguments"] for t in tc] == ['{"c":1}', '{"e":2}']


@pytest.mark.asyncio
async def test_ouvinte_avisado_na_primeira_frase_e_so_uma_vez():
    vistos = []

    def ouvinte(parcial):
        vistos.append(parcial)
        return True  # "já dá, pode parar de avisar"

    await _rodar([
        _delta(content="Claro, posso ajudar com isso agora mesmo."),
        _delta(content=" O valor do Jardim I é 1.400."),
        _delta(content=" Quer que eu detalhe?"),
    ], ouvinte)
    assert len(vistos) == 1
    assert vistos[0].endswith("agora mesmo.")


@pytest.mark.asyncio
async def test_ouvinte_que_recusa_e_chamado_de_novo():
    """Frase curta demais ainda pode ser colada na seguinte — o ouvinte recusa,
    e precisa ser consultado outra vez quando houver mais texto."""
    vistos = []

    def ouvinte(parcial):
        vistos.append(parcial)
        return len(parcial) >= 40

    await _rodar([_delta(content="Claro."), _delta(content=" O valor do Jardim I é 1.400 por mês.")], ouvinte)
    assert len(vistos) == 2


@pytest.mark.asyncio
async def test_stream_sem_conteudo_nao_chama_ninguem():
    vistos = []
    r = await _rodar([_delta(tool_calls=[{"index": 0, "id": "z", "function": {"name": "f", "arguments": "{}"}}])],
                     lambda p: vistos.append(p) or True)
    assert vistos == []
    assert r["choices"][0]["message"]["content"] == ""

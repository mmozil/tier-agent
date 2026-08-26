"""Tool `atualizar_etapa_crm` — o que ela aceita e o que faz quando dá errado.

O risco aqui não é o caminho feliz. É o agente (a) mover o card para uma etapa
que ele inventou, e (b) pedir desculpa à família por uma engrenagem interna que
ela não sabe que existe.
"""
import asyncio

import pytest

from services.agenda_tools import (
    ETAPAS_QUE_O_AGENTE_MOVE,
    _make_etapa_handler,
    build_etapa_tool_schema,
)


def rodar(handler, args):
    return asyncio.get_event_loop().run_until_complete(handler(args))


# ── schema ───────────────────────────────────────────────────────────
def test_schema_so_oferece_as_duas_etapas():
    """Enum fechado: o modelo não consegue escolher etapa fora da lista."""
    fn = build_etapa_tool_schema()["function"]
    assert fn["name"] == "atualizar_etapa_crm"
    enum = fn["parameters"]["properties"]["etapa"]["enum"]
    assert enum == ["Visita Agendada", "Perdido: não tem interesse"]
    assert fn["parameters"]["required"] == ["etapa"]


def test_schema_manda_nao_comentar_com_a_familia():
    d = build_etapa_tool_schema()["function"]["description"]
    assert "nunca avise a família" in d


def test_lista_de_etapas_e_curta_de_proposito():
    """Se alguém crescer esta lista, o teste avisa: mover funil vira palpite."""
    assert len(ETAPAS_QUE_O_AGENTE_MOVE) == 2


# ── handler ──────────────────────────────────────────────────────────
def test_sem_telefone_nao_chama_a_api_e_nao_alarma_a_familia():
    h = _make_etapa_handler("ccda", None)
    r = rodar(h, {"etapa": "Visita Agendada"})
    assert "sem comentar isso" in r
    assert "desculpa" not in r.lower()


def test_etapa_fora_da_lista_e_recusada_antes_do_http():
    h = _make_etapa_handler("ccda", "5511999999999")
    r = rodar(h, {"etapa": "Efetivação — ganho"})
    assert "etapa inválida" in r
    assert "Visita Agendada" in r


def test_etapa_vazia_tambem_e_recusada():
    h = _make_etapa_handler("ccda", "5511999999999")
    assert "etapa inválida" in rodar(h, {})


@pytest.mark.parametrize("etapa", ETAPAS_QUE_O_AGENTE_MOVE)
def test_as_duas_etapas_validas_passam_da_validacao(etapa, monkeypatch):
    """Chega a tentar o HTTP (e falha sem rede) — prova que não parou antes."""
    h = _make_etapa_handler("ccda", "5511999999999")
    r = rodar(h, {"etapa": etapa})
    assert "etapa inválida" not in r

"""Tool `atualizar_campo_crm` — o primeiro elo da jornada do v3.

Duas transições do funil acontecem quando o DADO chega, não quando alguém move o
card: `ano_escolar` preenchido leva a "Série identificada",
`motivo_procura_categoria` leva a "Motivo identificado". Sem esta tool o agente
conversa bem, o CRM não sabe de nada, e o card fica parado em Entrada de Lead
para sempre — que foi exatamente o "não move o lead" relatado.
"""
import asyncio

import pytest

from services.agenda_tools import (
    CAMPOS_DO_AGENTE,
    CATEGORIAS_DE_MOTIVO,
    _make_campo_handler,
    build_campo_tool_schema,
    build_etapa_tool_schema,
)


def rodar(handler, args):
    return asyncio.get_event_loop().run_until_complete(handler(args))


# ── schema ───────────────────────────────────────────────────────────
def test_schema_existe_com_enum_fechado():
    fn = build_campo_tool_schema()["function"]
    assert fn["name"] == "atualizar_campo_crm"
    assert fn["parameters"]["properties"]["campo"]["enum"] == CAMPOS_DO_AGENTE
    assert fn["parameters"]["required"] == ["campo", "valor"]


def test_os_dois_campos_que_movem_o_card_estao_na_lista():
    """🚨 São eles que disparam as automações. Se saírem daqui, o card não anda."""
    assert "ano_escolar" in CAMPOS_DO_AGENTE
    assert "motivo_procura_categoria" in CAMPOS_DO_AGENTE


def test_o_marco_de_preco_esta_na_lista():
    """Preço é marco transversal do v3, não etapa — mas precisa ser gravável."""
    assert "preco_apresentado" in CAMPOS_DO_AGENTE
    assert "valor_apresentado" in CAMPOS_DO_AGENTE


def test_as_nove_categorias_de_motivo_vao_na_descricao():
    """A categoria escolhe qual dos nove textos de reengajamento sai depois.
    Texto livre viraria uma categoria nova por conversa, e a cascata cairia
    sempre no genérico."""
    assert len(CATEGORIAS_DE_MOTIVO) == 9
    d = build_campo_tool_schema()["function"]["parameters"]["properties"]["valor"]["description"]
    for c in CATEGORIAS_DE_MOTIVO:
        assert c in d


def test_a_tool_de_campo_NAO_move_etapa():
    """🚨 Pedir ao modelo que grave o campo E mova o card seria pedir que ele
    repita uma regra que o CRM já sabe — e ele erraria em algum momento."""
    props = build_campo_tool_schema()["function"]["parameters"]["properties"]
    assert "etapa" not in props
    assert "estagio" not in props


def test_campo_e_etapa_sao_ferramentas_distintas():
    assert build_campo_tool_schema()["function"]["name"] != build_etapa_tool_schema()["function"]["name"]


def test_schema_manda_nao_comentar_com_a_familia():
    assert "nunca avise a família" in build_campo_tool_schema()["function"]["description"].lower()


def test_as_duas_listas_de_campo_nao_podem_divergir():
    """🚨 O CRM tem a mesma lista fechada. Se divergirem, o modelo chama um campo
    que o endpoint recusa e a jornada trava sem explicação na tela.

    A lista do CRM tem três a mais (`escola_atual` já está aqui; `origem_do_lead`
    e `data_preco_apresentado` são preenchidos por automação, não pelo modelo) —
    o que não pode existir é campo do AGENTE fora da lista do CRM.
    """
    do_crm = {
        "ano_escolar", "nome_do_filho", "escola_atual", "origem_do_lead",
        "motivo_procura", "motivo_procura_categoria",
        "preco_apresentado", "valor_apresentado", "data_preco_apresentado",
    }
    assert set(CAMPOS_DO_AGENTE) <= do_crm, set(CAMPOS_DO_AGENTE) - do_crm


# ── handler ──────────────────────────────────────────────────────────
def test_sem_telefone_nao_alarma_a_familia():
    r = rodar(_make_campo_handler("ccda", None), {"campo": "ano_escolar", "valor": "4º ano"})
    assert "sem comentar isso" in r
    assert "desculpa" not in r.lower()


def test_campo_fora_da_lista_e_recusado_antes_do_http():
    """🚨 Recusa (ao contrário da cascata, que ignora): aqui quem chama é o
    MODELO, e devolver o erro faz ele corrigir na hora."""
    r = rodar(_make_campo_handler("ccda", "5511999999999"), {"campo": "inventado", "valor": "x"})
    assert "campo inválido" in r
    assert "ano_escolar" in r


def test_valor_vazio_nao_grava():
    """Gravar vazio apagaria o dado que a família já tinha dado."""
    r = rodar(_make_campo_handler("ccda", "5511999999999"), {"campo": "ano_escolar", "valor": "  "})
    assert "valor vazio" in r


@pytest.mark.parametrize("campo", CAMPOS_DO_AGENTE)
def test_todo_campo_valido_passa_da_validacao(campo):
    """Chega a tentar o HTTP (e falha sem rede) — prova que não parou antes."""
    r = rodar(_make_campo_handler("ccda", "5511999999999"), {"campo": campo, "valor": "x"})
    assert "campo inválido" not in r

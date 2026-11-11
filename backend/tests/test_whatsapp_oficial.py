"""Modelos de mensagem do WhatsApp oficial e conversa iniciada pela equipe (11/11/2026)."""
import pytest

from routes.whatsapp_oficial import (
    nome_tecnico,
    numero_do_contato,
    resumo_do_modelo,
    texto_enviado,
    validar_modelo,
    variaveis_do_texto,
)
from services.registro_atividade import rotulo


def test_nome_tecnico_tira_acento_e_simbolo():
    assert nome_tecnico("Boas-vindas do CCDA") == "boas_vindas_do_ccda"
    assert nome_tecnico("  Matrícula 2027!! ") == "matricula_2027"
    assert nome_tecnico("???") == ""


def test_modelo_com_variavel_monta_exemplo_rodape_e_botoes():
    nome, comps = validar_modelo(
        "Boas-vindas", "Olá {{ 1 }}, aqui é a Cinthia do CCDA. Posso ajudar?", ["Maria"], "CCDA Diadema", ["Sim", "Agora não"]
    )
    assert nome == "boas_vindas"
    assert comps[0] == {
        "type": "BODY",
        "text": "Olá {{1}}, aqui é a Cinthia do CCDA. Posso ajudar?",
        "example": {"body_text": [["Maria"]]},
    }
    assert comps[1] == {"type": "FOOTER", "text": "CCDA Diadema"}
    assert comps[2]["buttons"] == [{"type": "QUICK_REPLY", "text": "Sim"}, {"type": "QUICK_REPLY", "text": "Agora não"}]


def test_modelo_sem_variavel_nao_leva_exemplo():
    _, comps = validar_modelo("Aviso", "A secretaria abre às 8h amanhã.", [], None, [])
    assert comps == [{"type": "BODY", "text": "A secretaria abre às 8h amanhã."}]


@pytest.mark.parametrize(
    ("corpo", "exemplos", "rodape", "botoes", "trecho"),
    [
        ("", [], None, [], "Escreva o texto"),
        ("Oi {{1}}, tudo bem? {{3}} ok", ["a", "b"], None, [], "ordem"),
        ("{{1}}, tudo bem com você?", ["Maria"], None, [], "começo nem no fim"),
        ("Tudo bem com você, {{1}}?", ["Maria"], None, [], "começo nem no fim"),
        ("Oi {{1}}, tudo bem?", [""], None, [], "exemplo"),
        ("Oi {{1}}, tudo bem?", ["Maria"], "x" * 61, [], "rodapé"),
        ("Oi {{1}}, tudo bem?", ["Maria"], "Oi {{1}}", [], "rodapé não aceita"),
        ("Oi, tudo bem?", [], None, ["a", "b", "c", "d"], "3 botões"),
        ("Oi, tudo bem?", [], None, ["x" * 26], "25 caracteres"),
        ("x" * 1025, [], None, [], "1.024"),
    ],
)
def test_modelo_recusado_antes_da_meta(corpo, exemplos, rodape, botoes, trecho):
    with pytest.raises(ValueError) as e:
        validar_modelo("Teste", corpo, exemplos, rodape, botoes)
    assert trecho in str(e.value)


def test_resumo_do_modelo_traduz_status_e_ignora_motivo_none():
    t = {
        "id": "1", "name": "boas_vindas", "status": "APPROVED", "category": "MARKETING", "language": "pt_BR",
        "rejected_reason": "NONE", "quality_score": {"score": "GREEN"},
        "components": [
            {"type": "BODY", "text": "Olá {{1}}, tudo bem? {{2}}"},
            {"type": "FOOTER", "text": "CCDA"},
            {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Sim"}]},
        ],
    }
    r = resumo_do_modelo(t)
    assert r["status_pt"] == "Aprovado" and r["motivo_recusa"] is None and r["variaveis"] == 2
    assert r["rodape"] == "CCDA" and r["botoes"] == ["Sim"] and r["qualidade"] == "GREEN"
    assert resumo_do_modelo({**t, "status": "REJECTED", "rejected_reason": "PROMOTIONAL"})["motivo_recusa"] == "PROMOTIONAL"
    midia = resumo_do_modelo({**t, "components": [{"type": "HEADER", "format": "IMAGE"}, *t["components"]]})
    assert midia["cabecalho_midia"] == "IMAGE" and midia["cabecalho"] is None


def test_texto_enviado_troca_as_variaveis():
    assert texto_enviado("Olá {{1}}, sou {{2}}.", ["Maria", "Cinthia"], "CCDA") == "Olá Maria, sou Cinthia.\n\nCCDA"
    assert variaveis_do_texto("{{2}} e {{1}} e {{1}}") == [1, 2]


def test_numero_do_contato_poe_o_55():
    assert numero_do_contato("(11) 98765-4321") == "5511987654321"
    assert numero_do_contato("+55 11 98765-4321") == "5511987654321"
    with pytest.raises(ValueError):
        numero_do_contato("123")


def test_registro_de_atividades_nomeia_as_acoes():
    assert rotulo("POST", "/whatsapp-oficial/modelos") == "Criou modelo de mensagem (oficial)"
    assert rotulo("DELETE", "/whatsapp-oficial/modelos") == "Apagou modelo de mensagem (oficial)"
    assert rotulo("POST", "/whatsapp-oficial/iniciar-conversa") == "Iniciou conversa com modelo (oficial)"

"""Etiquetas da conta (12/11/2026): lista fixa no padrão do Chatwoot."""

from services.etiquetas import MAX_POR_CONVERSA, cor_valida, normalizar_nome, normalizar_tag, validar_tags
from services.registro_atividade import rotulo


def test_nome_da_lista_vira_slug_como_no_chatwoot():
    assert normalizar_nome("  Visita Agendada ") == "visita-agendada"
    assert normalizar_nome("tentativa  contato 1") == "tentativa-contato-1"
    assert normalizar_nome("   ") == ""
    assert len(normalizar_nome("x" * 80)) == 24


def test_tag_da_conversa_segue_a_regra_antiga():
    # Conta sem lista não pode mudar de comportamento: espaço continua espaço.
    assert normalizar_tag("  Cliente VIP ") == "cliente vip"


def test_cor():
    assert cor_valida("#ff0000") == "#FF0000"
    assert cor_valida("red") is None
    assert cor_valida("#12345") is None


def test_sem_lista_e_texto_livre():
    final, fora = validar_tags(["VIP", "vip", " orçamento "], set(), [])
    assert final == ["vip", "orçamento"] and fora == []


def test_com_lista_so_entra_o_que_esta_na_lista():
    lista = {"visita-agendada", "clicou-errado"}
    final, fora = validar_tags(["visita-agendada", "inventada"], lista, [])
    assert final == ["visita-agendada"] and fora == ["inventada"]


def test_etiqueta_antiga_da_conversa_continua_passando():
    # Tirar uma etiqueta não pode falhar porque a conversa tem outra antiga, fora da lista.
    lista = {"visita-agendada"}
    final, fora = validar_tags(["antiga", "visita-agendada"], lista, ["antiga", "outra"])
    assert final == ["antiga", "visita-agendada"] and fora == []


def test_maximo_por_conversa():
    lista = {f"e{i}" for i in range(20)}
    final, _ = validar_tags([f"e{i}" for i in range(20)], lista, [])
    assert len(final) == MAX_POR_CONVERSA


def test_registro_de_atividades_nomeia_as_acoes_de_etiqueta():
    assert rotulo("POST", "/etiquetas") == "Criou etiqueta"
    assert rotulo("PATCH", "/etiquetas/3") == "Alterou etiqueta"
    assert rotulo("DELETE", "/etiquetas/3") == "Apagou etiqueta"
    assert rotulo("PUT", "/conversations/9/tags") == "Mudou as etiquetas"

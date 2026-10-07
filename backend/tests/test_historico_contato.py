"""Histórico do contato no card (07/10/2026): quais conversas são da MESMA pessoa."""

from services.historico_contato import chave_do_contato, mesmo_contato, quem_falou


def test_baileys_e_cloud_sao_o_mesmo_telefone():
    assert chave_do_contato("5511999990000@s.whatsapp.net", "whatsapp") == "5511999990000"
    assert chave_do_contato("5511999990000", "whatsapp_cloud") == "5511999990000"
    assert mesmo_contato("5511999990000@s.whatsapp.net", "whatsapp", "5511999990000", "whatsapp_cloud")


def test_dois_numeros_da_escola_mesma_familia():
    # a família fala com a Débora e com a Karolaine: o id do contato é o mesmo
    a = "5531988887777@s.whatsapp.net"
    assert mesmo_contato(a, "whatsapp", a, "whatsapp")


def test_telefones_diferentes_nao_se_juntam():
    assert not mesmo_contato("5511999990000@s.whatsapp.net", "whatsapp", "5511999990001@s.whatsapp.net", "whatsapp")


def test_prefixo_nao_basta():
    # o LIKE da consulta traz candidatos pelo prefixo; a regra exige o telefone INTEIRO
    assert not mesmo_contato("5511999990000@s.whatsapp.net", "whatsapp", "55119999900001@s.whatsapp.net", "whatsapp")


def test_lid_grupo_e_curto_nao_viram_telefone():
    assert chave_do_contato("123456789012345@lid", "whatsapp") == ""
    assert chave_do_contato("5511999990000-1600000000@g.us", "whatsapp") == ""
    assert chave_do_contato("12345@s.whatsapp.net", "whatsapp") == ""
    assert chave_do_contato("", "whatsapp") == ""
    assert chave_do_contato(None, "whatsapp") == ""


def test_canal_sem_telefone_so_casa_pelo_id_exato():
    # Telegram/webchat: dígitos não são telefone — juntar por dígitos colaria estranhos
    assert chave_do_contato("5511999990000", "telegram") == ""
    assert not mesmo_contato("5511999990000", "telegram", "5511999990000@s.whatsapp.net", "whatsapp")
    assert mesmo_contato("web:abc", "webchat", "web:abc", "webchat")


def test_quem_falou():
    assert quem_falou("agent", "Débora Ataíde", "SDR") == "Débora Ataíde"
    assert quem_falou("agent", None, "SDR") == "Atendente"
    assert quem_falou("assistant", None, "Nathalia") == "IA · Nathalia"
    assert quem_falou("assistant", None, None) == "IA"
    assert quem_falou("user", "Débora", "SDR") is None

"""Troca de conta no Agent (12/11/2026): a ação aparece no registro de atividades."""

from services.registro_atividade import rotulo


def test_registro_nomeia_a_troca_de_conta():
    assert rotulo("POST", "/auth/trocar-conta") == "Trocou de conta"

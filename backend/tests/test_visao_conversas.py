"""A régua de visão das conversas (Etapa 2 do caminho A) — decisão pura, sem banco."""

from services.visao_conversas import pode_ver, ve_tudo


def test_dono_e_admin_veem_tudo():
    assert ve_tudo("owner") and ve_tudo("admin")
    assert not ve_tudo("atendente")
    assert ve_tudo(None)  # token antigo sem papel = dono (comportamento legado)
    assert pode_ver("admin", 9, assigned_member_id=None, connector_id=None, meus_conectores=[])


def test_atendente_ve_o_que_e_dela():
    # atribuída a ela
    assert pode_ver("atendente", 5, assigned_member_id=5, connector_id=None, meus_conectores=[])
    # entrou por um número dela
    assert pode_ver("atendente", 5, assigned_member_id=None, connector_id=21, meus_conectores=[21, 22])


def test_atendente_nao_ve_o_resto():
    assert not pode_ver("atendente", 5, assigned_member_id=6, connector_id=30, meus_conectores=[21])
    assert not pode_ver("atendente", 5, assigned_member_id=None, connector_id=None, meus_conectores=[21])
    # sem identidade, o lado seguro é não ver nada
    assert not pode_ver("atendente", None, assigned_member_id=None, connector_id=21, meus_conectores=[21])

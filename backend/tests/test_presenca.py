"""Quem está online — regra pura de services/presenca.py (27/11/2026)."""

from services.presenca import PAINEL_ONLINE_S, RESPOSTA_ONLINE_S, estado_da_pessoa


def test_painel_aberto_agora_e_online():
    assert estado_da_pessoa(20, None) == {"online": True, "por": "painel", "visto_s": 20}


def test_um_sinal_perdido_nao_derruba():
    # o navegador manda a cada 60 s; 150 s tolera um sinal perdido
    assert estado_da_pessoa(PAINEL_ONLINE_S, None)["online"] is True
    assert estado_da_pessoa(PAINEL_ONLINE_S + 1, None)["online"] is False


def test_quem_responde_pelo_celular_sem_abrir_o_painel_e_online():
    # o caso do Vagner (M7, 27/11): nunca abriu o Agent, respondeu clientes pelo celular
    r = estado_da_pessoa(None, 240)
    assert r == {"online": True, "por": "resposta", "visto_s": 240}


def test_painel_ganha_da_resposta_quando_os_dois_valem():
    assert estado_da_pessoa(30, 90)["por"] == "painel"


def test_painel_velho_mas_respondeu_agora():
    assert estado_da_pessoa(5000, 60) == {"online": True, "por": "resposta", "visto_s": 60}


def test_offline_mostra_o_sinal_mais_recente():
    r = estado_da_pessoa(7200, RESPOSTA_ONLINE_S + 100)
    assert r == {"online": False, "por": None, "visto_s": RESPOSTA_ONLINE_S + 100}


def test_sem_sinal_nenhum():
    assert estado_da_pessoa(None, None) == {"online": False, "por": None, "visto_s": None}

"""Mensagens automáticas do WhatsApp oficial → histórico do card (12/11/2026)."""

from services.crm_historico_whatsapp import eventos_pendentes, novo_levado, origem_da_mensagem


def test_primeira_vez_leva_o_envio_e_o_status_atual():
    assert eventos_pendentes(ordem_atual=0, levado=-1) == ["enviada"]
    assert eventos_pendentes(ordem_atual=1, levado=-1) == ["enviada"]
    assert eventos_pendentes(ordem_atual=2, levado=-1) == ["enviada", "entregue"]
    # lida pula «entregue»: quem leu recebeu
    assert eventos_pendentes(ordem_atual=3, levado=-1) == ["enviada", "lida"]
    assert eventos_pendentes(ordem_atual=9, levado=-1) == ["enviada", "falhou"]


def test_depois_so_o_que_avancou():
    assert eventos_pendentes(ordem_atual=2, levado=0) == ["entregue"]
    assert eventos_pendentes(ordem_atual=3, levado=2) == ["lida"]
    assert eventos_pendentes(ordem_atual=3, levado=3) == []
    assert eventos_pendentes(ordem_atual=1, levado=0) == []


def test_marca_de_ate_onde_foi():
    assert novo_levado(0, -1) == 0
    assert novo_levado(1, -1) == 0
    assert novo_levado(3, 0) == 3
    assert novo_levado(2, 3) == 3  # nunca volta


def test_origem():
    assert origem_da_mensagem("Disparo · visita_perdida_reagendar", "No-show 11/11 — reagendar visita") == "Disparo «No-show 11/11 — reagendar visita»"
    assert origem_da_mensagem("Modelo · retomada_de_solicitacao", None) == "Modelo «retomada_de_solicitacao»"
    assert origem_da_mensagem("Callback · tour", None) == "Retorno programado (callback)"
    assert origem_da_mensagem(None, None) == "Mensagem automática"


def test_nome_do_modelo_vai_no_evento():
    """16/11/2026 (CCDA): o CRM move o card pelo modelo entregue — o evento precisa dizer qual."""
    from services.crm_historico_whatsapp import nome_do_modelo

    assert nome_do_modelo(None, "ccda_3a_tentativa_de_contato") == "ccda_3a_tentativa_de_contato"
    assert nome_do_modelo("Disparo · ccda_2a_tentativa_de_contato_filho", None) == "ccda_2a_tentativa_de_contato_filho"
    assert nome_do_modelo("Modelo · visita_perdida_reagendar", None) == "visita_perdida_reagendar"
    assert nome_do_modelo("Callback · passo-3", None) is None
    assert nome_do_modelo(None, None) is None

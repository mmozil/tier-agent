"""Ligações pelo WhatsApp oficial (14/11/2026) — regras puras do services/ligacoes.py."""

from services import ligacoes


def test_encerrada_com_duracao():
    assert ligacoes.estado_final("em_curso", {"status": "COMPLETED", "duration": 192, "start_time": "1"}) == "encerrada"


def test_sem_duracao_e_perdida():
    # A família desistiu antes de alguém atender: COMPLETED sem início nem duração.
    assert ligacoes.estado_final("tocando", {"status": "COMPLETED"}) == "perdida"


def test_recusada_por_nos_continua_recusada():
    assert ligacoes.estado_final("recusada", {"status": "COMPLETED"}) == "recusada"


def test_falhou():
    assert ligacoes.estado_final("em_curso", {"status": "FAILED", "duration": 10}) == "falhou"


def test_status_de_ligacao_nao_vira_tique_de_mensagem():
    msg = {"id": "wamid.1", "status": "read"}
    lig = {"id": "wacid.1", "type": "call", "status": "RINGING"}
    de_msg, de_lig = ligacoes.separar_statuses([msg, lig])
    assert de_msg == [msg]
    assert de_lig == [lig]


def test_rotulos_da_conversa():
    assert (
        ligacoes._rotulo("encerrada", "entrada", 192, "Marcelo")
        == "📞 Ligação recebida · 3 min 12 s · atendida por Marcelo"
    )
    assert ligacoes._rotulo("encerrada", "entrada", 40, None) == "📞 Ligação recebida · 40 s"
    assert ligacoes._rotulo("perdida", "entrada", None, None) == "📞 Ligação perdida"
    assert ligacoes._rotulo("recusada", "entrada", None, None) == "📞 Ligação recusada"
    assert ligacoes._rotulo("falhou", "entrada", None, None) == "📞 Ligação não completada"


def test_erro_da_meta_legivel():
    call = {"errors": [{"code": 138021, "message": "Call failed", "error_data": {"details": "timeout"}}]}
    assert ligacoes._erro_de(call) == "138021 · Call failed · timeout"
    assert ligacoes._erro_de({}) is None

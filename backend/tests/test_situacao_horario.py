"""Situação do horário calculada pelo sistema (09/11/2026, M7)."""

from datetime import datetime

from services.agent_runtime import situacao_do_horario

P = "Horário comercial: segunda a sexta, das 8h às 17h. [horario: seg-sex 08:00-17:00]"


def test_sem_marcacao_nao_muda_nada():
    assert situacao_do_horario("persona qualquer", datetime(2026, 11, 9, 18, 20)) == ""


def test_dentro_do_horario():
    assert "DENTRO" in situacao_do_horario(P, datetime(2026, 11, 9, 10, 0))  # segunda 10h
    assert "DENTRO" in situacao_do_horario(P, datetime(2026, 11, 9, 16, 59))


def test_segunda_depois_das_17_e_dia_util_e_volta_amanha():
    t = situacao_do_horario(P, datetime(2026, 11, 9, 18, 20))  # segunda
    assert "FORA do horário comercial — dia útil" in t
    assert "amanhã, terça-feira, a partir das 8h" in t


def test_antes_das_8_volta_hoje():
    t = situacao_do_horario(P, datetime(2026, 11, 10, 6, 30))  # terça
    assert "dia útil" in t and "hoje, a partir das 8h" in t


def test_sexta_a_noite_e_fim_de_semana_e_volta_segunda():
    for quando in (datetime(2026, 11, 13, 17, 0), datetime(2026, 11, 14, 11, 0), datetime(2026, 11, 15, 22, 0)):
        t = situacao_do_horario(P, quando)
        assert "fim de semana" in t, quando
        assert "segunda-feira, a partir das 8h" in t, quando


def test_quinta_a_noite_volta_sexta():
    t = situacao_do_horario(P, datetime(2026, 11, 12, 20, 0))
    assert "dia útil" in t and "amanhã, sexta-feira" in t


from services.agent_runtime import persona_do_horario  # noqa: E402

PB = (
    "REGRAS [horario: seg-sex 08:00-17:00]\n"
    "[[dentro]]\nMODELO DENTRO\n[[/dentro]]\n"
    "[[fora_dia_util]]\nMODELO FORA DIA UTIL\n[[/fora_dia_util]]\n"
    "[[fim_de_semana]]\nMODELO FIM DE SEMANA\n[[/fim_de_semana]]\n"
)


def test_persona_so_com_o_bloco_de_dentro():
    t = persona_do_horario(PB, datetime(2026, 11, 9, 10, 0))
    assert "MODELO DENTRO" in t and "FORA DIA UTIL" not in t and "FIM DE SEMANA" not in t
    assert "[[" not in t and "REGRAS" in t


def test_persona_so_com_o_bloco_de_fora_dia_util():
    t = persona_do_horario(PB, datetime(2026, 11, 9, 18, 20))
    assert "MODELO FORA DIA UTIL" in t and "MODELO DENTRO" not in t and "FIM DE SEMANA" not in t


def test_persona_so_com_o_bloco_de_fim_de_semana():
    for quando in (datetime(2026, 11, 13, 17, 30), datetime(2026, 11, 14, 9, 0), datetime(2026, 11, 15, 23, 0)):
        t = persona_do_horario(PB, quando)
        assert "MODELO FIM DE SEMANA" in t and "MODELO DENTRO" not in t and "FORA DIA UTIL" not in t, quando


def test_persona_sem_blocos_ou_sem_horario_passa_igual():
    assert persona_do_horario("persona comum", datetime(2026, 11, 9, 10, 0)) == "persona comum"
    sem_horario = "[[dentro]]\nX\n[[/dentro]]"
    assert persona_do_horario(sem_horario, datetime(2026, 11, 9, 10, 0)) == sem_horario


# ─── 09/11/2026 (M7): bloco [[fora]] e {quando} preenchido pelo sistema ───
from services.agent_runtime import quando_retorno  # noqa: E402

PF = (
    "[horario: seg-sex 08:00-17:00]\n"
    "[[dentro]]\nSO A PRIMEIRA\n[[/dentro]]\n"
    "[[fora]]\nTe ligo {quando}?\n[[/fora]]\n"
)


def test_quando_retorno_nos_quatro_momentos():
    assert quando_retorno(PF, datetime(2026, 11, 9, 18, 55)) == "amanhã a partir das 8h"  # segunda
    assert quando_retorno(PF, datetime(2026, 11, 13, 19, 0)) == "na segunda a partir das 8h"  # sexta
    assert quando_retorno(PF, datetime(2026, 11, 14, 10, 0)) == "na segunda a partir das 8h"  # sábado
    assert quando_retorno(PF, datetime(2026, 11, 10, 6, 30)) == "hoje a partir das 8h"  # terça cedo
    assert quando_retorno(PF, datetime(2026, 11, 9, 10, 0)) == ""  # dentro
    assert quando_retorno("sem marcação {quando}", datetime(2026, 11, 9, 18, 55)) == ""


def test_bloco_fora_some_dentro_e_aparece_fora_com_quando():
    dentro = persona_do_horario(PF, datetime(2026, 11, 9, 10, 0))
    assert "SO A PRIMEIRA" in dentro and "Te ligo" not in dentro
    noite = persona_do_horario(PF, datetime(2026, 11, 9, 18, 55))
    assert "Te ligo amanhã a partir das 8h?" in noite and "SO A PRIMEIRA" not in noite
    fds = persona_do_horario(PF, datetime(2026, 11, 14, 10, 0))
    assert "Te ligo na segunda a partir das 8h?" in fds and "[[" not in fds


def test_tag_fora_nao_engole_fora_dia_util():
    t = "[horario: seg-sex 08:00-17:00]\n[[fora_dia_util]]\nA\n[[/fora_dia_util]]\n[[fim_de_semana]]\nB\n[[/fim_de_semana]]"
    saida = persona_do_horario(t, datetime(2026, 11, 9, 18, 55))
    assert saida.splitlines()[-1] == "A" and "B" not in saida and "[[" not in saida

"""Filtro de período e de responsável da lista de conversas (09/11/2026, M7)."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy.dialects import postgresql

from services import filtro_conversas as F


def test_dia_do_brasil_vira_janela_em_utc():
    ini, fim = F.janela_utc(date(2026, 11, 9), date(2026, 11, 9))
    # 09/11 00:00 no Brasil = 03:00 UTC; o fim é exclusivo, no começo do dia seguinte
    assert ini == datetime(2026, 11, 9, 3, 0)
    assert fim == datetime(2026, 11, 10, 3, 0)


def test_conversa_das_23h_do_brasil_fica_no_proprio_dia():
    # 06/11 23:30 no Brasil = 07/11 02:30 em UTC: tem de entrar no dia 06, não no 07
    ini, fim = F.janela_utc(date(2026, 11, 6), date(2026, 11, 6))
    guardado = datetime(2026, 11, 7, 2, 30)
    assert ini <= guardado < fim


def test_so_um_lado_do_periodo():
    ini, fim = F.janela_utc(date(2026, 11, 1), None)
    assert ini == datetime(2026, 11, 1, 3, 0) and fim is None
    ini, fim = F.janela_utc(None, date(2026, 11, 30))
    assert ini is None and fim == datetime(2026, 12, 1, 3, 0)
    assert F.janela_utc(None, None) == (None, None)


def test_periodo_invertido_ou_longo_demais_recusa_com_frase():
    with pytest.raises(ValueError, match="depois do fim"):
        F.janela_utc(date(2026, 11, 9), date(2026, 11, 1))
    with pytest.raises(ValueError, match="até um ano"):
        F.janela_utc(date(2025, 1, 1), date(2026, 11, 9))


def test_responsavel_e_a_atribuida_e_senao_a_do_numero():
    assert F.responsavel_da_conversa(7, 3) == (7, "atribuida")
    assert F.responsavel_da_conversa(None, 3) == (3, "numero")
    assert F.responsavel_da_conversa(None, None) == (None, None)


def _sql(cond) -> str:
    return str(cond.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_filtro_por_pessoa_pega_atribuida_ou_numero_dela_sem_atribuicao():
    s = _sql(F.condicao_responsavel(7, [1, 2]))
    assert "ta_conversation.assigned_member_id = 7" in s
    assert "ta_conversation.assigned_member_id IS NULL" in s
    assert "ta_connector.member_id = 7" in s
    assert "ta_connector.agent_id IN (1, 2)" in s  # nunca número de outra empresa


def test_sem_responsavel_nao_some_com_conversa_sem_numero():
    s = _sql(F.condicao_responsavel(F.SEM_RESPONSAVEL, [1]))
    assert "ta_conversation.assigned_member_id IS NULL" in s
    # NOT IN com connector_id nulo daria NULL: a conversa sem número precisa do OR explícito
    assert "ta_conversation.connector_id IS NULL" in s
    assert "NOT IN" in s

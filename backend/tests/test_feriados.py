"""Feriado nacional no horário da IA (19/11/2026, M7).

Às 18:09 da quinta 19/11 a IA da M7 prometeu «te chamo amanhã a partir das 8h» a dois clientes —
a sexta 20/11 era feriado (Consciência Negra). A persona manda tratar feriado de outro jeito, mas o
modelo só recebia a data, e o cálculo do horário dizia «Sem feriados».
"""

import json
from datetime import date, datetime
from types import SimpleNamespace

from services.agent_runtime import (
    bloco_feriados,
    feriado_em,
    feriados_nacionais,
    ia_no_horario,
    quando_retorno,
    situacao_do_horario,
)

P = "Horário comercial: segunda a sexta, das 8h às 17h. [horario: seg-sex 08:00-17:00]"
VESPERA = datetime(2026, 11, 19, 18, 9)  # quinta, véspera do 20/11
FERIADO = datetime(2026, 11, 20, 10, 0)  # sexta, feriado


def test_feriados_fixos_e_moveis():
    assert feriado_em(date(2026, 11, 20)) == "Dia da Consciência Negra"
    assert feriado_em(date(2026, 4, 3)) == "Sexta-feira da Paixão"  # Páscoa 2026 = 05/04
    assert feriado_em(date(2027, 3, 26)) == "Sexta-feira da Paixão"  # Páscoa 2027 = 28/03
    assert feriado_em(date(2026, 12, 25)) == "Natal"
    assert feriado_em(date(2026, 11, 19)) is None
    assert date(2023, 11, 20) not in feriados_nacionais(2023)  # nacional só desde 2024
    assert len(feriados_nacionais(2026)) == 10


def test_vespera_de_feriado_volta_na_segunda():
    t = situacao_do_horario(P, VESPERA)
    assert "véspera de feriado" in t and "segunda-feira, a partir das 8h" in t
    assert "amanhã" not in t


def test_no_feriado_nao_e_horario_comercial():
    t = situacao_do_horario(P, FERIADO)
    assert "DENTRO" not in t
    assert "feriado (Dia da Consciência Negra)" in t and "segunda-feira, a partir das 8h" in t


def test_quando_da_persona_pula_o_feriado():
    PF = P + " Te ligo {quando}?"
    assert quando_retorno(PF, VESPERA) == "na segunda a partir das 8h"
    assert quando_retorno(PF, FERIADO) == "na segunda a partir das 8h"
    assert quando_retorno(PF, datetime(2026, 11, 12, 18, 9)) == "amanhã a partir das 8h"  # quinta comum


def test_horario_da_ia_do_numero_respeita_feriado():
    dentro = SimpleNamespace(
        ia_ligada=True, ia_horario=json.dumps({"modo": "dentro", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"})
    )
    fora = SimpleNamespace(
        ia_ligada=True, ia_horario=json.dumps({"modo": "fora", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"})
    )
    assert ia_no_horario(dentro, FERIADO) is False  # IA só no expediente: feriado não tem
    assert ia_no_horario(fora, FERIADO) is True  # IA fora do expediente: feriado é fora


def test_bloco_avisa_o_feriado_de_amanha_e_o_proximo_dia_util():
    b = bloco_feriados(VESPERA)
    assert "Amanhã (sexta-feira, 20/11) é feriado nacional: Dia da Consciência Negra." in b
    assert "Próximo dia útil (segunda a sexta, sem feriado): segunda-feira, 23/11." in b


def test_bloco_no_proprio_feriado():
    assert "Hoje (sexta-feira, 20/11) é feriado nacional" in bloco_feriados(FERIADO)


def test_sem_feriado_perto_o_prompt_fica_como_era():
    assert bloco_feriados(datetime(2026, 11, 24, 10, 0)) == ""


def test_feriado_no_domingo_nao_entra_no_prompt():
    """15/11/2026 é domingo: não tira dia útil de ninguém — não vale uma linha no prompt."""
    assert bloco_feriados(datetime(2026, 11, 10, 10, 0)) == ""

"""Agenda de visita (CCDA, 11/11/2026): o dia pedido chega inteiro, separado em manhã e
tarde, com os horários de menos movimento; e a lista fechada de ferramentas por agente.

Lógica pura + HTTP falso: nada sai para o ERP.
"""

import asyncio
import inspect
import re

import pytest

from services import agenda_tools
from services.agenda_tools import (
    _make_consultar_handler,
    filtrar_tools,
    summarize_slots,
)


def _grade(dia: str, livres: set[str], ocupados: set[str]) -> list[dict]:
    """A grade do CCDA: 08:00 a 17:00 de 30 em 30, sem 12:00–13:00 (almoço da equipe)."""
    horas = [f"{h:02d}:{m:02d}" for h in range(8, 18) for m in (0, 30) if (h, m) <= (17, 0)]
    horas = [h for h in horas if h not in {"12:00", "12:30", "13:00"}]
    out = []
    for h in horas:
        out.append(
            {
                "dia": dia,
                "hora": h,
                "inicio": f"{dia}T{h}:00-03:00",
                "disponivel": h in livres,
                "motivo": None if h in livres else ("ocupado" if h in ocupados else "passado"),
            }
        )
    return out


def test_o_dia_inteiro_chega_e_a_tarde_nao_e_cortada():
    """🚨 Com 12 por dia a tarde sumia: 16 horários livres, os 4 últimos eram da tarde."""
    dia = "2026-11-16"
    todas = {s["hora"] for s in _grade(dia, set(), set())}
    out = summarize_slots({"slots": _grade(dia, todas, set())}, dia)
    d = out["dias"][0]
    assert len(d["horarios"]) == len(todas) == 16
    assert d["tarde"][-1] == "17:00"
    assert d["manha"][0] == "08:00"
    assert all(int(h[:2]) < 12 for h in d["manha"]) and all(int(h[:2]) >= 12 for h in d["tarde"])


def test_mais_tranquilos_prefere_horario_com_vizinhanca_livre():
    """Sexta 13/11 medida em produção: livres 08:00 10:00 10:30 11:00 16:30."""
    dia = "2026-11-13"
    livres = {"08:00", "10:00", "10:30", "11:00", "16:30"}
    ocupados = {"08:30", "09:00", "09:30", "11:30", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "17:00"}
    d = summarize_slots({"slots": _grade(dia, livres, ocupados)}, dia)["dias"][0]
    assert d["manha"] == ["08:00", "10:00", "10:30", "11:00"]
    assert d["tarde"] == ["16:30"]
    # Ocupados até 60 min: 08:00 → 08:30, 09:00 (2) · 10:00 → 09:00, 09:30 (2) ·
    # 10:30 → 09:30, 11:30 (2) · 11:00 → 11:30 (1). Menos movimento primeiro, empate
    # pelo mais cedo: 11:00, 08:00, 10:00 — devolvidos em ordem de hora.
    assert d["mais_tranquilos"]["manha"] == ["08:00", "10:00", "11:00"]
    assert d["mais_tranquilos"]["tarde"] == ["16:30"]


def test_dia_pedido_sem_horario_e_dito():
    dia_pedido = "2026-11-14"  # sábado: fechado
    seguinte = "2026-11-16"
    out = summarize_slots({"slots": _grade(seguinte, {"09:00"}, set())}, dia_pedido)
    assert out["dia_pedido_sem_horario"] is True
    assert out["semana_pedida"] == "sábado"
    assert out["dias"][0]["dia"] == seguinte


def test_dia_pedido_com_horario_nao_marca_a_falta():
    dia = "2026-11-13"
    out = summarize_slots({"slots": _grade(dia, {"10:00"}, set())}, dia)
    assert "dia_pedido_sem_horario" not in out
    assert "AGENDÁVEIS" in out["status"]


def test_a_instrucao_antiga_continua_e_ganha_os_periodos():
    i = summarize_slots({"slots": _grade("2026-11-13", {"10:00"}, set())}, "2026-11-13")["instrucao"]
    assert "Dia {dia_br} às {hora}" in i
    assert "NÃO diga o dia da semana ao oferecer visita" in i
    assert "mais_tranquilos" in i
    assert "não está livre" in i


class _Resp:
    status_code = 200
    content = b"{}"

    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def test_consulta_pede_o_dia_pelo_parametro_de(monkeypatch):
    """🚨 O ERP lê `de`, não `data`: com `data` a janela começava sempre hoje."""
    chamadas = []

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None):
            chamadas.append((url, params))
            return _Resp({"slots": _grade("2026-11-20", {"10:00"}, set()), "duracao_min": 90})

    monkeypatch.setattr(agenda_tools.httpx, "AsyncClient", _Cli)
    monkeypatch.setattr(agenda_tools, "_base_url", lambda: "https://erp.teste/api/crm-agenda")
    saida = asyncio.get_event_loop().run_until_complete(_make_consultar_handler("ccda", {})({"data": "2026-11-20"}))
    assert chamadas == [("https://erp.teste/api/crm-agenda/ccda/slots", {"de": "2026-11-20"})]
    assert "20/11" in saida


def _schema(nome):
    return {"type": "function", "function": {"name": nome}}


def test_lista_fechada_corta_schema_e_handler_juntos():
    nomes = ["consultar_horarios_visita", "agendar_visita", "atualizar_etapa_crm", "marcar_perda"]
    schemas = [_schema(n) for n in nomes]
    handlers = {n: (lambda a: a) for n in nomes}
    s, h = filtrar_tools(schemas, handlers, {"consultar_horarios_visita", "agendar_visita"})
    assert [x["function"]["name"] for x in s] == ["consultar_horarios_visita", "agendar_visita"]
    assert set(h) == {"consultar_horarios_visita", "agendar_visita"}


def test_sem_lista_fechada_nada_muda():
    schemas = [_schema("marcar_perda")]
    handlers = {"marcar_perda": lambda a: a}
    assert filtrar_tools(schemas, handlers, None) == (schemas, handlers)


@pytest.mark.parametrize(
    "lista, esperado",
    [
        (None, 6),
        ({"consultar_horarios_visita", "agendar_visita"}, 2),
    ],
)
def test_discover_respeita_a_lista_do_agente(monkeypatch, lista, esperado):
    async def _slug(db, agent_id):
        return "ccda"

    async def _cfg(slug):
        return {"labels": {"nome": "Nome"}, "assuntos": [], "perguntas_extras": []}

    async def _perm(db, agent_id):
        return lista

    monkeypatch.setattr(agenda_tools, "get_agenda_slug", _slug)
    monkeypatch.setattr(agenda_tools, "_get_config", _cfg)
    monkeypatch.setattr(agenda_tools, "get_agenda_tools_permitidas", _perm)
    s, h = asyncio.get_event_loop().run_until_complete(agenda_tools.discover_agenda_tools(None, 26, "5511999999999"))
    assert len(s) == len(h) == esperado
    if lista:
        assert "marcar_perda" not in h and "atualizar_etapa_crm" not in h and "atualizar_campo_crm" not in h


def test_freios_do_pet_nao_valem_para_agenda_de_visita():
    """🚨 «tá confirmado?» depois de remarcar não pode virar «não encontrei sua visita»:
    os freios de agendamento existente e de expediente mandam chamar ferramenta do Pet."""
    from services import tier_engine

    src = inspect.getsource(tier_engine)
    for gatilho in ("_USER_ASKS_BOOKING.search", "_USER_ASKS_HOURS.search"):
        linha = next(ln for ln in src.splitlines() if gatilho in ln and ln.strip().startswith("elif"))
        assert "_has_pet_tools" in linha and "_agenda_ou_pet" not in linha, linha
    assert re.search(r"_agenda_ou_pet and _OFFERS_SLOT", src)  # o de horário inventado continua


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Pode ser às 8h ou 10:30?", {"08:00", "10:30"}),
        ("sexta às 9h30", {"09:30"}),
        ("📅 13/11 às 08:00", {"08:00"}),
        ("das 7h às 12h30", {"07:00", "12:30"}),
        ("sem hora nenhuma", set()),
        ("ligo a partir das 9 h", {"09:00"}),
    ],
)
def test_horas_citadas_normaliza(texto, esperado):
    from services.tier_engine import horas_citadas

    assert horas_citadas(texto) == esperado


def test_hora_ja_ofertada_nao_e_hora_nova():
    """O freio de «horário inventado» na agenda de visita só vale para hora NOVA: a que o
    agente já ofereceu (veio da consulta) e a família escolheu não força consulta de novo."""
    from services.tier_engine import horas_citadas

    ofertadas = horas_citadas("Para o dia 13/11 tenho de manhã 08:00 ou 10:00 e à tarde 16:30.")
    assert not (horas_citadas("Perfeito, 13/11 às 08:00. Pra agendar me passa os dados") - ofertadas)
    assert horas_citadas("Também tenho 14:00") - ofertadas == {"14:00"}

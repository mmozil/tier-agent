"""As definições das métricas de atendimento (Etapa 4) — puras, sem banco."""

from datetime import datetime, timedelta

from services.metricas_atendimento import Msg, agregar, resumir

T0 = datetime(2026, 9, 9, 12, 0, 0)


def _m(role, seg, member_id=None):
    return Msg(role, member_id, T0 + timedelta(seconds=seg))


def test_atendimento_e_primeira_resposta():
    r = resumir(1, 22, 8, T0, [_m("user", 0), _m("assistant", 2), _m("agent", 90, 8), _m("user", 120), _m("agent", 130, 8)])
    assert r.atendimento and not r.abordagem
    assert r.primeira_resposta_s == 90 and r.primeira_resposta_por == 8
    assert r.primeira_resposta_ia_s == 2
    assert r.msgs_por_membro[8] == 2 and r.duracao_s == 130


def test_abordagem_e_a_primeira_mensagem_nossa_e_humana():
    r = resumir(2, 22, 8, T0, [_m("agent", 0, 8), _m("user", 600), _m("agent", 700, 8)])
    assert r.abordagem and r.atendimento
    assert r.primeira_resposta_s == 100  # o contato respondeu e a pessoa voltou em 100 s
    ia = resumir(3, 22, None, T0, [_m("assistant", 0), _m("user", 10)])
    assert not ia.abordagem and not ia.atendimento  # IA puxou assunto: não é abordagem de pessoa


def test_nota_interna_e_ia_nao_sao_atendimento():
    r = resumir(4, 22, None, T0, [_m("user", 0), _m("assistant", 3)])
    assert not r.atendimento and r.primeira_resposta_s is None and r.primeira_resposta_ia_s == 3


def test_agregado_por_pessoa_e_por_numero():
    desde = T0 - timedelta(days=1)
    resumos = [
        resumir(1, 22, 8, T0, [_m("user", 0), _m("agent", 60, 8)]),
        resumir(2, 22, 8, T0, [_m("agent", 0, 8), _m("user", 30)]),
        resumir(3, 23, 9, T0, [_m("user", 0), _m("assistant", 1)]),
    ]
    membros = {8: {"nome": "Ana", "papel": "atendente", "origem": "erp"}, 9: {"nome": "Bia", "papel": "atendente", "origem": "erp"}}
    numeros = {22: {"id": 22, "rotulo": "11 9000", "modo": "registro", "member_id": 8}, 23: {"id": 23, "rotulo": "IA", "modo": "agente", "member_id": None}}
    out = agregar(resumos, membros=membros, numeros=numeros, desde=desde, hoje_inicio_utc=T0 - timedelta(hours=1), days=1)
    assert out["totais"] == {"conversas": 3, "conversas_hoje": 3, "atendimentos": 2, "abordagens": 1, "respondidas_por_humano": 1, "respondidas_pela_ia": 1}
    ana = next(p for p in out["por_pessoa"] if p["member_id"] == 8)
    assert (ana["conversas"], ana["atendimentos"], ana["abordagens"], ana["mensagens"]) == (2, 2, 1, 2)
    assert ana["primeira_resposta"]["mediana_s"] == 60
    n22 = next(n for n in out["por_numero"] if n["connector_id"] == 22)
    assert (n22["conversas"], n22["atendimentos"], n22["abordagens"], n22["dona"]) == (2, 2, 1, "Ana")
    assert out["tempos"]["primeira_resposta"]["n"] == 1 and out["tempos"]["primeira_resposta_ia"]["mediana_s"] == 1

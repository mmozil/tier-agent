"""Tiques de entrega no número oficial (13/11/2026, CCDA): enviada · entregue · lida · não entregue."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.db import Base
from models import TaAgent, TaConversation, TaMessageLog, TaTenant, TaWaEnvioStatus
from services import entrega_whatsapp as ew

T = datetime(2026, 11, 12, 15, 0)
WA = "5511987654321"


def _rodar(coro):
    try:
        laco = asyncio.get_event_loop()
        if laco.is_closed():
            raise RuntimeError
    except RuntimeError:
        laco = asyncio.new_event_loop()
        asyncio.set_event_loop(laco)
    return laco.run_until_complete(coro)


def s(segundos):
    return T + timedelta(seconds=segundos)


# ─── regra pura ──────────────────────────────────────────────────────────────


def test_pelo_wamid_quando_existe():
    r = ew.casar([(1, s(0), "wamid.A")], [("wamid.A", s(500), 3, None, None)])
    assert r == {1: {"entrega": "lida", "entrega_erro": None}}  # o wamid manda, mesmo longe no tempo


def test_pela_hora_a_mensagem_nossa_mais_perto():
    msgs = [(1, s(0), None), (2, s(60), None)]
    r = ew.casar(msgs, [("w1", s(3), 2, None, None), ("w2", s(62), 1, None, None)])
    assert r[1]["entrega"] == "entregue" and r[2]["entrega"] == "enviada"


def test_status_longe_demais_nao_casa():
    assert ew.casar([(1, s(0), None)], [("w", s(400), 3, None, None)]) == {}


def test_varios_baloes_vale_o_menos_avancado_e_falha_manda():
    msgs = [(1, s(0), None)]
    assert ew.casar(msgs, [("a", s(2), 3, None, None), ("b", s(3), 2, None, None)])[1]["entrega"] == "entregue"
    r = ew.casar(msgs, [("a", s(2), 3, None, None), ("b", s(3), 9, 131047, "Re-engagement message")])
    assert r[1]["entrega"] == "falhou" and "24 h" in r[1]["entrega_erro"]


def test_motivo_em_portugues_e_desconhecido():
    assert "marketing" in ew.motivo(131049, "healthy ecosystem")
    assert ew.motivo(999, "Algo") == "erro 999: Algo"
    assert ew.motivo(None, None) == "a Meta não entregou"


# ─── com o banco (SQLite) ───────────────────────────────────────────────────


class _Db:
    def __init__(self, sessao):
        self.s = sessao

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(
        motor, tables=[m.__table__ for m in (TaTenant, TaAgent, TaConversation, TaMessageLog, TaWaEnvioStatus)]
    )
    with Session(motor, expire_on_commit=False) as ss:
        yield ss
    motor.dispose()


def test_conversa_do_numero_oficial(sessao):
    conv = TaConversation(id=1, agent_id=26, connector_id=56, connector_kind="whatsapp_cloud", external_id=WA)
    sessao.add(conv)
    sessao.add_all([
        TaMessageLog(id=10, conversation_id=1, role="agent", content="MODELO", created_at=s(0)),
        TaMessageLog(id=11, conversation_id=1, role="user", content="oi", created_at=s(100)),
        TaMessageLog(id=12, conversation_id=1, role="assistant", content="resposta da IA", created_at=s(110)),
        TaMessageLog(id=13, conversation_id=1, role="agent", content="do painel, dia seguinte", created_at=s(90000)),
    ])
    sessao.add_all([
        # modelo: status nasce COM a conversa
        TaWaEnvioStatus(wamid="m", conversation_id=1, connector_id=56, destino=WA, status="read", ordem=3, criado_em=s(2)),
        # resposta da IA: sem conversa, só número + destino (o 9 pode faltar no wa_id)
        TaWaEnvioStatus(wamid="ia", connector_id=56, destino="551187654321", status="delivered", ordem=2, criado_em=s(112)),
        # painel fora da janela de 24 h
        TaWaEnvioStatus(wamid="p", connector_id=56, destino=WA, status="failed", ordem=9, erro_codigo=131047,
                        erro="Re-engagement message", criado_em=s(90001)),
        # outro contato, mesma hora: não entra
        TaWaEnvioStatus(wamid="x", connector_id=56, destino="5511900001111", status="read", ordem=3, criado_em=s(111)),
    ])
    sessao.commit()
    msgs = sessao.query(TaMessageLog).order_by(TaMessageLog.id).all()
    r = _rodar(ew.da_conversa(_Db(sessao), conv, msgs))
    assert r[10]["entrega"] == "lida"
    assert r[12]["entrega"] == "entregue"
    assert r[13]["entrega"] == "falhou" and "24 h" in r[13]["entrega_erro"]
    assert 11 not in r  # mensagem da família não tem tique


def test_outro_canal_nao_tem_tique(sessao):
    conv = SimpleNamespace(connector_kind="whatsapp", id=1, connector_id=9, external_id=WA)
    assert _rodar(ew.da_conversa(_Db(sessao), conv, [])) == {}

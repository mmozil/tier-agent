"""«Não lidas» no inbox (CCDA, o Marcos, 13/11/2026): com muitos disparos, a equipe não sabia quem
tinha respondido. Conta as mensagens do CONTATO depois que alguém da equipe viu a conversa; a resposta
da IA não conta como vista."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.db import Base
from models import TaAgent, TaConversation, TaMessageLog, TaTenant
from routes import conversations

T0 = datetime(2026, 11, 13, 10, 0)


def _rodar(coro):
    # um vizinho da suíte pode deixar a thread sem laço (ou com o laço fechado): cria um se preciso
    try:
        laco = asyncio.get_event_loop()
        if laco.is_closed():
            raise RuntimeError
    except RuntimeError:
        laco = asyncio.new_event_loop()
        asyncio.set_event_loop(laco)
    return laco.run_until_complete(coro)


class _Db:
    def __init__(self, s):
        self.s = s

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[m.__table__ for m in (TaTenant, TaAgent, TaConversation, TaMessageLog)])
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


def _msg(cid, role, minutos):
    return TaMessageLog(conversation_id=cid, role=role, content=role, created_at=T0 + timedelta(minutes=minutos))


def test_conta_so_o_que_o_contato_mandou_depois_de_visto(sessao):
    sessao.add_all([
        # 1: nova, ninguém viu — as 2 do contato contam; a da IA não
        TaConversation(id=1, agent_id=26, connector_kind="whatsapp_cloud", external_id="a", visto_equipe_em=None),
        # 2: vista às 10:05 — só a das 10:10 conta (a IA respondeu às 10:11 e continua não lida)
        TaConversation(id=2, agent_id=26, connector_kind="whatsapp_cloud", external_id="b", visto_equipe_em=T0 + timedelta(minutes=5)),
        # 3: vista depois de tudo — zero
        TaConversation(id=3, agent_id=26, connector_kind="whatsapp_cloud", external_id="c", visto_equipe_em=T0 + timedelta(hours=1)),
    ])
    sessao.add_all([
        _msg(1, "agent", 0), _msg(1, "user", 1), _msg(1, "assistant", 2), _msg(1, "user", 3),
        _msg(2, "user", 1), _msg(2, "user", 10), _msg(2, "assistant", 11),
        _msg(3, "user", 1), _msg(3, "user", 2),
    ])
    sessao.commit()
    assert _rodar(conversations._nao_lidas(_Db(sessao), [1, 2, 3])) == {1: 2, 2: 1}


def test_lista_vazia_nao_consulta():
    assert _rodar(conversations._nao_lidas(None, [])) == {}


def test_marcar_visto_zera(sessao, monkeypatch):
    sessao.add(TaConversation(id=7, agent_id=26, connector_kind="whatsapp_cloud", external_id="z", visto_equipe_em=None))
    sessao.add(_msg(7, "user", 1))
    sessao.commit()

    async def _dona(_db, cid, _user):
        return sessao.get(TaConversation, cid)

    monkeypatch.setattr(conversations, "_get_owned_conversation", _dona)
    user = SimpleNamespace(tenant_id=17, member_id=26, role="atendente")
    r = _rodar(conversations.marcar_visto(7, user=user, db=_Db(sessao)))
    assert r["ok"] is True and sessao.get(TaConversation, 7).visto_equipe_em is not None
    assert _rodar(conversations._nao_lidas(_Db(sessao), [7])) == {}


def test_lista_devolve_o_campo():
    assert conversations.ConversationOut.model_fields["nao_lidas"].default == 0

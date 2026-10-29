"""Conversa partida pelo código oculto (@lid) é juntada quando o cliente responde (29/10/2026).

A vendedora escreve primeiro pelo celular e o WhatsApp manda o chat como `<código>@lid`: a conversa
nasce com esse código. A resposta do cliente vem pelo telefone e abria OUTRA conversa — no celular é
uma só. Medido em 29/10: 53 na M7 (Douglas: 6 mensagens dela na 696, a resposta dele na 697) e 155 no
CCDA. A resposta traz os dois; é ela que junta.
"""

import asyncio
from datetime import datetime
from types import SimpleNamespace

from services import agent_runtime


class _Res:
    def __init__(self, itens):
        self._itens = itens

    def scalars(self):
        return SimpleNamespace(all=lambda: self._itens)


class _Db:
    def __init__(self, fantasmas):
        self.fantasmas = fantasmas
        self.execucoes = 0
        self.apagadas = []
        self.commits = 0

    async def execute(self, _q):
        self.execucoes += 1
        return _Res(self.fantasmas if self.execucoes == 1 else [])

    async def delete(self, obj):
        self.apagadas.append(obj.id)

    async def commit(self):
        self.commits += 1


def _conv(cid, ext, **kw):
    base = dict(id=cid, agent_id=1, connector_id=46, external_id=ext, msg_count=0, contact_name=None,
                started_at=datetime(2026, 10, 27, 12, 57), crm_opportunity_id=None, assigned_member_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_resposta_do_cliente_junta_a_conversa_do_codigo_oculto():
    telefone = _conv(697, "5514991093135@s.whatsapp.net", msg_count=10, contact_name="Douglas Dega")
    fantasma = _conv(696, "189945130029295@lid", msg_count=6, started_at=datetime(2026, 10, 27, 12, 6),
                     assigned_member_id=42)
    db = _Db([fantasma])
    n = asyncio.run(agent_runtime.juntar_conversa_do_codigo_oculto(db, telefone, "189945130029295@lid"))
    assert n == 1
    assert db.apagadas == [696] and db.commits == 1
    # 1 busca + 3 tabelas movidas (mensagens, notificações, playbooks) ANTES de apagar
    assert db.execucoes == 4
    assert telefone.msg_count == 16
    assert telefone.started_at == datetime(2026, 10, 27, 12, 6)  # a conversa começa onde ela escreveu
    assert telefone.contact_name == "Douglas Dega"
    assert telefone.assigned_member_id == 42


def test_sem_codigo_oculto_nao_mexe():
    telefone = _conv(697, "5514991093135@s.whatsapp.net")
    for jid in (None, "", "5514991093135@s.whatsapp.net", "123@g.us"):
        db = _Db([_conv(1, "x@lid")])
        assert asyncio.run(agent_runtime.juntar_conversa_do_codigo_oculto(db, telefone, jid)) == 0
        assert db.execucoes == 0 and db.apagadas == []


def test_conversa_que_ja_e_do_codigo_nao_junta_consigo():
    propria = _conv(718, "279546570002653@lid")
    db = _Db([])
    assert asyncio.run(agent_runtime.juntar_conversa_do_codigo_oculto(db, propria, "279546570002653@lid")) == 0
    assert db.execucoes == 0

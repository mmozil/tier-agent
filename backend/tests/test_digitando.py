"""«digitando…» só quando a IA vai responder (09/11/2026, M7)."""

from __future__ import annotations

from types import SimpleNamespace

from routes.webhooks import _ia_vai_responder


class _Res:
    def __init__(self, v):
        self.v = v

    def scalar(self):
        return self.v


class _Db:
    def __init__(self, status=None, erro=False):
        self.status, self.erro, self.chamou = status, erro, False

    async def execute(self, _stmt):
        self.chamou = True
        if self.erro:
            raise RuntimeError("banco fora")
        return _Res(self.status)


async def test_numero_em_registro_nunca_mostra_digitando():
    db = _Db(status="active")
    assert await _ia_vai_responder(db, SimpleNamespace(modo="registro", agent_id=24), "551199@s.whatsapp.net") is False
    assert db.chamou is False  # nem consulta a conversa


async def test_agente_com_conversa_ativa_mostra():
    assert await _ia_vai_responder(_Db(status="active"), SimpleNamespace(modo="agente", agent_id=25), "x") is True


async def test_conversa_nova_mostra():
    assert await _ia_vai_responder(_Db(status=None), SimpleNamespace(modo="agente", agent_id=25), "x") is True


async def test_conversa_assumida_pela_equipe_nao_mostra():
    assert await _ia_vai_responder(_Db(status="handed_off"), SimpleNamespace(modo="agente", agent_id=25), "x") is False


async def test_erro_de_leitura_nao_mostra():
    assert await _ia_vai_responder(_Db(erro=True), SimpleNamespace(modo="agente", agent_id=25), "x") is False


async def test_conector_antigo_sem_modo_e_agente():
    assert await _ia_vai_responder(_Db(status="active"), SimpleNamespace(agent_id=25), "x") is True

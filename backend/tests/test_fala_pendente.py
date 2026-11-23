"""Fala do celular anterior à conversa — a guarda (23/11/2026). O fluxo inteiro, em Postgres de verdade:
`test_fala_antes_da_conversa.py`."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from services import agent_runtime, eco_envio, fala_pendente, wa_chave


class RedisDeMentira:
    def __init__(self):
        self.listas: dict[str, list[str]] = {}

    async def exists(self, *ks):
        return sum(1 for k in ks if self.listas.get(k))

    async def lrange(self, k, i, f):
        return list(self.listas.get(k, []))

    def pipeline(self, transaction=True):
        dono = self

        class _P:
            def __init__(self):
                self.ops = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def rpush(self, k, v):
                self.ops.append(("rpush", k, v, None))

            def ltrim(self, k, i, f):
                self.ops.append(("ltrim", k, i, f))

            def expire(self, k, s):
                pass

            async def execute(self):
                for op, k, a, b in self.ops:
                    lista = dono.listas.setdefault(k, [])
                    if op == "rpush":
                        lista.append(a)
                    else:
                        fim = len(lista) if b == -1 else b + 1
                        dono.listas[k] = lista[a:fim] if a >= 0 else lista[a:]

        return _P()


@pytest.fixture
def redis_falso(monkeypatch):
    r = RedisDeMentira()

    @asynccontextmanager
    async def _c():
        yield r

    monkeypatch.setattr(fala_pendente, "_cliente", _c)
    return r


def _rodar(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _item(i, em="2026-11-23T14:39:00"):
    return {"id": i, "remote_jid": "9@lid", "texto": f"fala {i}", "anexos": None, "em": em}


def test_acha_pelo_telefone_e_pelo_codigo_sem_repetir(redis_falso):
    async def caso():
        await fala_pendente.guardar(55, ["5511@s.whatsapp.net", "9@lid"], _item("B", "2026-11-23T14:39:05"))
        await fala_pendente.guardar(55, ["5511@s.whatsapp.net", "9@lid"], _item("A", "2026-11-23T14:39:01"))
        so_codigo, _ = await fala_pendente.ler(55, ["outro@s.whatsapp.net", "9@lid"])
        os_dois, _ = await fala_pendente.ler(55, ["5511@s.whatsapp.net", "9@lid"])
        return [f["id"] for f in so_codigo], [f["id"] for f in os_dois]

    assert _rodar(caso()) == (["A", "B"], ["A", "B"])  # em ordem de envio


def test_fala_de_um_numero_nao_vale_para_outro(redis_falso):
    async def caso():
        await fala_pendente.guardar(55, ["5511@s.whatsapp.net"], _item("A"))
        return await fala_pendente.ha(46, ["5511@s.whatsapp.net"])

    assert _rodar(caso()) is False


def test_apagar_tira_so_o_que_foi_lido(redis_falso):
    async def caso():
        await fala_pendente.guardar(55, ["5511@s.whatsapp.net"], _item("A"))
        _, lidas = await fala_pendente.ler(55, ["5511@s.whatsapp.net"])
        await fala_pendente.guardar(55, ["5511@s.whatsapp.net"], _item("B"))  # chegou no meio
        await fala_pendente.apagar(lidas)
        falas, _ = await fala_pendente.ler(55, ["5511@s.whatsapp.net"])
        return [f["id"] for f in falas]

    assert _rodar(caso()) == ["B"]


def test_redis_fora_nao_levanta(monkeypatch):
    @asynccontextmanager
    async def _quebrado():
        raise ConnectionError("redis fora")
        yield

    monkeypatch.setattr(fala_pendente, "_cliente", _quebrado)

    async def caso():
        return (
            await fala_pendente.guardar(55, ["5511@s.whatsapp.net"], _item("A")),
            await fala_pendente.ha(55, ["5511@s.whatsapp.net"]),
            await fala_pendente.ler(55, ["5511@s.whatsapp.net"]),
        )

    assert _rodar(caso()) == (False, False, ([], {}))


# ── registrar_fala_do_celular sem conversa ──────────────────────────────────

CONECTOR = SimpleNamespace(id=55, agent_id=25, member_id=18, modo="agente", kind="whatsapp")


def _fala(monkeypatch, *, eco, enviada_em=None, chave=None):
    async def _consumir(inst, texto):
        return eco

    async def _sem(db, **kw):
        return None

    monkeypatch.setattr(eco_envio, "consumir", _consumir)
    monkeypatch.setattr(agent_runtime, "conversa_em_curso", _sem)

    async def caso():
        wa_chave.definir(chave or {"id": "3EB0A", "remote_jid": "9@lid", "from_me": True}, "agent")
        return await agent_runtime.registrar_fala_do_celular(
            object(),
            CONECTOR,
            instance_id="inst",
            external_chat_id="5511@s.whatsapp.net",
            text_content="Aqui é Camilla da M7 Ambientes",
            attachments=None,
            enviada_em=enviada_em,
        )

    return _rodar(caso())


def test_sem_conversa_guarda_sob_telefone_e_codigo(redis_falso, monkeypatch):
    assert _fala(monkeypatch, eco=False)["status"] == "guardada"
    assert sorted(redis_falso.listas) == sorted(fala_pendente.chaves(55, ["5511@s.whatsapp.net", "9@lid"]))


def test_eco_da_ia_nao_e_guardado(redis_falso, monkeypatch):
    assert _fala(monkeypatch, eco=True)["status"] == "eco_do_envio"
    assert redis_falso.listas == {}


def test_redis_fora_no_eco_nao_guarda_o_que_pode_ser_da_ia(redis_falso, monkeypatch):
    assert _fala(monkeypatch, eco=None)["status"] == "sem_conversa"
    assert redis_falso.listas == {}


def test_historico_velho_do_repareamento_nao_vira_fala(redis_falso, monkeypatch):
    velha = datetime.utcnow() - timedelta(days=8)
    assert _fala(monkeypatch, eco=False, enviada_em=velha)["status"] == "sem_conversa"
    assert redis_falso.listas == {}


# ── absorver: onde NÃO age ──────────────────────────────────────────────────


@pytest.mark.parametrize("kind,modo", [("whatsapp_cloud", "agente"), ("whatsapp", "registro"), ("webchat", "agente")])
def test_so_age_no_numero_por_qr_com_ia(kind, modo):
    con = SimpleNamespace(id=1, member_id=None, modo=modo)
    assert _rodar(agent_runtime.absorver_fala_pendente(None, con, None, connector_kind=kind, jids=["x@lid"])) is False


# ── a hora do WhatsApp ──────────────────────────────────────────────────────


def test_hora_do_whatsapp_nos_tres_formatos():
    from routes.webhooks import _hora_do_whatsapp

    certo = datetime(2026, 11, 23, 14, 45, 3)
    for cru in (1795445103, "1795445103", {"low": 1795445103, "high": 0, "unsigned": True}):
        assert _hora_do_whatsapp(cru) == certo
    for ruim in (None, "", {}, "abc", 0):
        assert _hora_do_whatsapp(ruim) is None

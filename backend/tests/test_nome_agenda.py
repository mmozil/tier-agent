"""Nome da agenda do celular, lido do motor (09/11/2026, M7)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from core.encryption import encrypt
from services import nome_agenda as A


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _Db:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, _stmt):
        return _Res(self.rows)


def _conector(cid=40, cfg=None):
    cfg = cfg if cfg is not None else {"instance_id": "inst-1", "api_key": "twe_x"}
    return SimpleNamespace(id=cid, kind="whatsapp", config_json_enc=encrypt(json.dumps(cfg)))


@pytest.fixture(autouse=True)
def _limpa():
    A._cache.clear()
    A._pausado.clear()
    yield
    A._cache.clear()
    A._pausado.clear()


async def test_nome_e_telefone_do_codigo_oculto(monkeypatch):
    pedidos = []

    async def falso(inst, chave, jids):
        pedidos.append((inst, chave, sorted(jids)))
        return [
            {"jid": "248657685270679@lid", "nome": "Rebecca M7", "telefone": "5511974085742"},
            {"jid": "5511900000000@s.whatsapp.net", "nome": None, "telefone": "5511900000000"},
        ]

    monkeypatch.setattr(A, "_perguntar", falso)
    r = await A.agenda_das_conversas(
        _Db([_conector()]),
        [(40, "248657685270679@lid"), (40, "5511900000000@s.whatsapp.net"), (40, "120363@g.us"), (None, "1@lid")],
    )
    assert r["248657685270679@lid"] == {"nome": "Rebecca M7", "telefone": "5511974085742"}
    assert r["5511900000000@s.whatsapp.net"] == {"nome": None, "telefone": "5511900000000"}
    # grupo e conversa sem número não vão ao motor
    assert pedidos == [("inst-1", "twe_x", ["248657685270679@lid", "5511900000000@s.whatsapp.net"])]


async def test_guarda_a_resposta(monkeypatch):
    chamadas = 0

    async def falso(inst, chave, jids):
        nonlocal chamadas
        chamadas += 1
        return []

    monkeypatch.setattr(A, "_perguntar", falso)
    db = _Db([_conector()])
    assert await A.agenda_das_conversas(db, [(40, "5511900000000@s.whatsapp.net")]) == {}
    assert await A.agenda_das_conversas(db, [(40, "5511900000000@s.whatsapp.net")]) == {}
    assert chamadas == 1  # «não achou» também fica guardado


async def test_motor_sem_a_rota_pausa_o_numero(monkeypatch):
    chamadas = 0

    async def falso(inst, chave, jids):
        nonlocal chamadas
        chamadas += 1
        raise LookupError("rota ausente")

    monkeypatch.setattr(A, "_perguntar", falso)
    db = _Db([_conector()])
    assert await A.agenda_das_conversas(db, [(40, "1@lid")]) == {}
    assert await A.agenda_das_conversas(db, [(40, "2@lid")]) == {}
    assert chamadas == 1


async def test_motor_fora_do_ar_nao_derruba(monkeypatch):
    async def falso(inst, chave, jids):
        raise RuntimeError("timeout")

    monkeypatch.setattr(A, "_perguntar", falso)
    assert await A.agenda_das_conversas(_Db([_conector()]), [(40, "1@lid")]) == {}


async def test_numero_sem_chave_nao_pergunta(monkeypatch):
    async def nao_pode(*_):
        raise AssertionError("não devia chamar o motor")

    monkeypatch.setattr(A, "_perguntar", nao_pode)
    assert await A.agenda_das_conversas(_Db([_conector(cfg={"instance_id": "x"})]), [(40, "1@lid")]) == {}

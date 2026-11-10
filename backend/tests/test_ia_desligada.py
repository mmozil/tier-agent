"""Botão «IA ligada» do número (10/11/2026, M7): desligado = grava, abre card, não responde."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import agent_runtime as R


class _Db:
    def __init__(self, agent):
        self.agent = agent

    async def get(self, _model, _id):
        return self.agent


@pytest.fixture
def chamadas(monkeypatch):
    reg: dict[str, list] = {"log": [], "crm": [], "envio": [], "llm": []}

    async def _conv(_db, **kw):
        return SimpleNamespace(id=1194, status="active", crm_opportunity_id=None, **{"kw": kw})

    async def _log(_db, **kw):
        reg["log"].append(kw)

    async def _crm(_db, **kw):
        reg["crm"].append(kw)

    class _Impl:
        async def send(self, *_a, **_k):
            reg["envio"].append(_a)

    monkeypatch.setattr(R, "ensure_conversation", _conv)
    monkeypatch.setattr(R, "log_message", _log)
    monkeypatch.setattr(R, "_espelhar_no_crm", _crm)
    monkeypatch.setattr(R.registry, "get", lambda _k: _Impl())
    return reg


def _conector(ia_ligada):
    return SimpleNamespace(id=55, agent_id=25, modo="agente", ia_ligada=ia_ligada, config_json_enc="")


async def test_ia_desligada_grava_abre_card_e_nao_responde(monkeypatch, chamadas):
    async def _resolve(*_a, **_k):
        return _conector(False)

    monkeypatch.setattr(R, "resolve_connector_by_instance", _resolve)
    db = _Db(SimpleNamespace(id=25, active=True, tenant_id=18, template_kind="custom"))
    r = await R.handle_inbound_message(
        db, connector_kind="whatsapp", instance_id="i", external_chat_id="5511972603355@s.whatsapp.net",
        sender_name="Marcos Barros", text_content="Cadeira cavalleti", origem_canal={"canal": "site"},
    )
    assert r["status"] == "ia_desligada" and r["conversation_id"] == 1194
    assert len(chamadas["log"]) == 1 and chamadas["log"][0]["role"] == "user"
    assert chamadas["log"][0]["content"] == "Cadeira cavalleti"
    assert len(chamadas["crm"]) == 1 and chamadas["crm"][0]["agente_respondeu"] is False
    assert chamadas["crm"][0]["origem_canal"] == {"canal": "site"}
    assert chamadas["envio"] == []


async def test_conector_antigo_sem_campo_segue_com_ia(monkeypatch, chamadas):
    """Sem o atributo (linha antiga em memória) o padrão é IA ligada: não cai no atalho."""
    conn = SimpleNamespace(id=55, agent_id=25, modo="agente", config_json_enc="")
    assert getattr(conn, "ia_ligada", True) is True


# ─── Horário da IA do número (10/11/2026) ───
import json  # noqa: E402
from datetime import datetime  # noqa: E402

from services.agent_runtime import ia_no_horario, ia_responde_agora, validar_ia_horario  # noqa: E402

SEG_10, SEG_19, SAB_10, TER_07 = (
    datetime(2026, 11, 9, 10, 0), datetime(2026, 11, 9, 19, 0), datetime(2026, 11, 14, 10, 0), datetime(2026, 11, 10, 7, 0),
)


def _num(h, ligada=True):
    return SimpleNamespace(ia_ligada=ligada, ia_horario=json.dumps(h) if h else None)


def test_sem_horario_responde_sempre():
    for t in (SEG_10, SEG_19, SAB_10, TER_07):
        assert ia_no_horario(_num(None), t) is True


def test_so_dentro_do_horario():
    n = _num({"modo": "dentro", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"})
    assert [ia_no_horario(n, t) for t in (SEG_10, SEG_19, SAB_10, TER_07)] == [True, False, False, False]


def test_so_fora_do_horario_a_equipe_atende_no_expediente():
    n = _num({"modo": "fora", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"})
    assert [ia_no_horario(n, t) for t in (SEG_10, SEG_19, SAB_10, TER_07)] == [False, True, True, True]


def test_sabado_conta_quando_os_dias_incluem():
    n = _num({"modo": "dentro", "dias": "seg-sab", "inicio": "08:00", "fim": "17:00"})
    assert ia_no_horario(n, SAB_10) is True


def test_interruptor_desligado_vence_o_horario():
    n = _num({"modo": "dentro", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"}, ligada=False)
    assert ia_responde_agora(n, SEG_10) is False


def test_horario_ilegivel_nao_cala_o_agente():
    assert ia_no_horario(SimpleNamespace(ia_horario="{quebrado"), SEG_19) is True


def test_validacao():
    assert validar_ia_horario({"modo": "sempre"}) is None
    for ruim in (
        {"modo": "dentro", "dias": "seg-sex", "inicio": "17:00", "fim": "08:00"},
        {"modo": "dentro", "dias": "ter-qui", "inicio": "08:00", "fim": "17:00"},
        {"modo": "talvez", "dias": "seg-sex", "inicio": "08:00", "fim": "17:00"},
        {"modo": "fora", "dias": "seg-sex", "inicio": "8h", "fim": "17:00"},
    ):
        with pytest.raises(ValueError):
            validar_ia_horario(ruim)

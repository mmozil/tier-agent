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

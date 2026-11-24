"""Colega escrevendo de um número conectado da própria conta não vira lead (24/11/2026, M7 4149 e 4150)."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from services import agent_runtime, lead_capture, numeros

CONFIGS = [{"phone": "5511900004097"}, {"display_phone": "+55 11 3000-2040"}, {"label": "sem telefone"}]


@pytest.mark.parametrize(
    "contato",
    ["5511900004097@s.whatsapp.net", "5511900004097", "551100004097@s.whatsapp.net", "551130002040"],
)
def test_numero_conectado_e_da_casa(contato):
    assert numeros.mesmo_numero_da_casa(contato, "whatsapp", CONFIGS)


@pytest.mark.parametrize(
    "contato", ["5521900004097@s.whatsapp.net", "5511988887777", "5511900004097@lid", "", None]
)
def test_cliente_nao_e_da_casa(contato):
    assert not numeros.mesmo_numero_da_casa(contato, "whatsapp", CONFIGS)


def test_canal_que_nao_e_telefone_nao_casa():
    assert not numeros.mesmo_numero_da_casa("5511900004097", "telegram", CONFIGS)


class _Db:
    def __init__(self, configs):
        self.configs = configs

    async def execute(self, *_a, **_k):
        if isinstance(self.configs, Exception):
            raise self.configs
        dados = [json.dumps(c) for c in self.configs]
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: dados))


def _rodar(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_consulta_usa_os_numeros_da_conta(monkeypatch):
    monkeypatch.setattr(numeros, "decrypt", lambda s: s)
    assert _rodar(numeros.eh_numero_da_casa(_Db(CONFIGS), 18, "5511900004097"))
    assert not _rodar(numeros.eh_numero_da_casa(_Db(CONFIGS), 18, "5511911112222"))


def test_falha_nunca_segura_o_cliente():
    assert _rodar(numeros.eh_numero_da_casa(_Db(RuntimeError("banco")), 18, "5511900004097")) is False


def _espelhar(monkeypatch, *, da_casa, card=None):
    from core import config
    from services import erp_crm_client

    chamadas = []

    async def _envia(**kw):
        chamadas.append(kw)
        return {"oportunidade_id": 9}

    async def _casa(*_a, **_k):
        return da_casa

    async def _commit():
        return None

    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(tier_erp_auto_crm=True, tier_whatsapp_engine_url="x"))
    monkeypatch.setattr(erp_crm_client, "integracao_ativa", lambda: True)
    monkeypatch.setattr(erp_crm_client, "enviar_conversa_para_crm", _envia)
    monkeypatch.setattr(numeros, "eh_numero_da_casa", _casa)
    conv = SimpleNamespace(id=1, crm_opportunity_id=card)
    _rodar(agent_runtime._espelhar_no_crm(
        SimpleNamespace(commit=_commit), agent=SimpleNamespace(id=25, tenant_id=18), conv=conv, connector=None,
        connector_kind="whatsapp_cloud", external_chat_id="5511900004097", sender_name="Colega", text_content="Oi Isa",
        origem_canal=None, agente_respondeu=False,
    ))
    return chamadas


def test_colega_nao_vai_para_o_crm(monkeypatch):
    assert _espelhar(monkeypatch, da_casa=True) == []


def test_cliente_vai_para_o_crm(monkeypatch):
    assert len(_espelhar(monkeypatch, da_casa=False)) == 1


def test_conversa_que_ja_tem_card_segue_como_sempre(monkeypatch):
    assert len(_espelhar(monkeypatch, da_casa=True, card=31460)) == 1


def test_colega_nao_gera_alerta_de_lead(monkeypatch):
    async def _casa(*_a, **_k):
        return True

    monkeypatch.setattr(numeros, "eh_numero_da_casa", _casa)
    r = _rodar(lead_capture.maybe_capture_lead(
        SimpleNamespace(), tenant_id=18, agent_id=25, conversation_id=1, external_chat_id="5511900004097",
        sender_name="Colega", user_text="quero um orçamento",
    ))
    assert r is False

"""Nome do contato vindo do CRM (09/11/2026, M7): a conversa que só tinha o número."""

from __future__ import annotations

import pytest

from services import erp_crm_client
from services import nome_crm as N


@pytest.fixture(autouse=True)
def _limpa_cache(monkeypatch):
    N._cache.clear()
    N._conta_pausada.clear()
    monkeypatch.setattr(erp_crm_client, "integracao_ativa", lambda: True)
    yield
    N._cache.clear()
    N._conta_pausada.clear()


def test_telefone_da_conversa_so_para_numero_de_whatsapp():
    assert N.telefone_da_conversa("5511972603355@s.whatsapp.net") == "5511972603355"
    assert N.telefone_da_conversa("5511972603355") == "5511972603355"
    assert N.telefone_da_conversa("248657685270679@lid") is None  # sem telefone
    assert N.telefone_da_conversa("120363@g.us") is None  # grupo
    assert N.telefone_da_conversa("status@broadcast") is None
    assert N.telefone_da_conversa("123") is None
    assert N.telefone_da_conversa(None) is None


async def test_nome_do_crm_por_conversa_e_numero_repetido(monkeypatch):
    pedidos = []

    async def falso(*, agent_tenant_id, telefones, timeout=4.0):
        pedidos.append(list(telefones))
        return {"5511972603355": "Marcos Barros"}

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", falso)
    exts = ["5511972603355@s.whatsapp.net", "5511972603355@s.whatsapp.net", "5511900000000@s.whatsapp.net", "1@lid"]
    r = await N.nomes_do_crm(18, exts)
    assert r == {"5511972603355@s.whatsapp.net": "Marcos Barros"}
    # um número só vai uma vez ao ERP; o @lid nem vai
    assert pedidos == [["5511972603355", "5511900000000"]]


async def test_guarda_a_resposta_e_nao_pergunta_de_novo(monkeypatch):
    chamadas = 0

    async def falso(*, agent_tenant_id, telefones, timeout=4.0):
        nonlocal chamadas
        chamadas += 1
        return {}

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", falso)
    await N.nomes_do_crm(18, ["5511900000000@s.whatsapp.net"])
    await N.nomes_do_crm(18, ["5511900000000@s.whatsapp.net"])
    assert chamadas == 1  # «não achou» também fica guardado


async def test_conta_fora_do_crm_para_de_perguntar(monkeypatch):
    chamadas = 0

    async def falso(*, agent_tenant_id, telefones, timeout=4.0):
        nonlocal chamadas
        chamadas += 1
        raise erp_crm_client.ErpCrmError("Tenant do Agent nao vinculado a nenhuma conta.")

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", falso)
    assert await N.nomes_do_crm(99, ["5511900000000@s.whatsapp.net"]) == {}
    assert await N.nomes_do_crm(99, ["5511911111111@s.whatsapp.net"]) == {}
    assert chamadas == 1


async def test_erro_inesperado_nao_derruba_a_lista(monkeypatch):
    async def falso(*, agent_tenant_id, telefones, timeout=4.0):
        raise RuntimeError("boom")

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", falso)
    assert await N.nomes_do_crm(18, ["5511900000000@s.whatsapp.net"]) == {}


async def test_sem_integracao_nem_pergunta(monkeypatch):
    monkeypatch.setattr(erp_crm_client, "integracao_ativa", lambda: False)

    async def nao_pode(**_):
        raise AssertionError("não devia chamar o ERP")

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", nao_pode)
    assert await N.nomes_do_crm(18, ["5511900000000@s.whatsapp.net"]) == {}


async def test_numero_solto_da_conversa_nova(monkeypatch):
    # O ERP casa por DDD + 8 últimos e devolve a chave como recebeu (rota `nomes-dos-contatos`).
    async def falso(*, agent_tenant_id, telefones, timeout=4.0):
        return {t: "Marcos Barros" for t in telefones if t.endswith("972603355")}

    monkeypatch.setattr(erp_crm_client, "nomes_dos_contatos", falso)
    assert await N.nome_do_crm_por_telefone(18, "(11) 97260-3355") == "Marcos Barros"
    assert await N.nome_do_crm_por_telefone(18, "5511972603355") == "Marcos Barros"
    assert await N.nome_do_crm_por_telefone(18, "") is None

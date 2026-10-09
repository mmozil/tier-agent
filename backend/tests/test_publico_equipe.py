"""Fonte «só da equipe» (09/10/2026) — dado interno da empresa não chega a cliente.

Antes, toda ferramenta ligada a um agente ficava ao alcance de qualquer pessoa que falasse
com ele (WhatsApp, chat do site, link público). Com o Tier Emissor conectado, um cliente
poderia perguntar «para quem vocês emitiram nota?» e receber a resposta.
"""

import inspect
import os

from cryptography.fernet import Fernet

# Valores fictícios só para importar os módulos (que leem a configuração no import). Nenhum teste
# aqui abre banco nem decifra nada; em container os valores reais já existem e prevalecem.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@localhost:5432/teste")
os.environ.setdefault("JWT_SECRET", "teste-publico-equipe-" + "x" * 32)
os.environ.setdefault("FERNET_KEY", Fernet.generate_key().decode())

from services import pii_redactor, tier_engine, tool_provider_service  # noqa: E402
from services.oauth_connect import PRESETS  # noqa: E402


def _sql(q) -> str:
    return str(q.compile(compile_kwargs={"literal_binds": True}))


def test_cliente_nao_recebe_fonte_da_equipe():
    assert "publico != 'equipe'" in _sql(tool_provider_service.consulta_fontes(22, "cliente"))


def test_equipe_recebe_todas_as_fontes():
    assert "publico !=" not in _sql(tool_provider_service.consulta_fontes(22, "equipe"))


def test_audiencia_desconhecida_vale_como_cliente():
    assert "publico != 'equipe'" in _sql(tool_provider_service.consulta_fontes(22, "Equipe"))
    assert "publico != 'equipe'" in _sql(tool_provider_service.consulta_fontes(22, ""))


def test_padrao_do_motor_e_da_descoberta_e_cliente():
    # Quem esquecer de passar a audiência (WhatsApp, chat público, memória, estilo) cai no seguro.
    assert inspect.signature(tier_engine.send_message).parameters["audiencia"].default == "cliente"
    assert inspect.signature(tool_provider_service.discover_agent_tools).parameters["audiencia"].default == "cliente"
    assert inspect.signature(tool_provider_service.consulta_fontes).parameters["audiencia"].default == "cliente"


def test_emissor_nasce_so_para_a_equipe():
    p = PRESETS["tier-emissor"]
    assert p["publico"] == "equipe"
    assert p["scope"] == "nfe:read"
    # URL própria: a conexão é guardada por agente+URL e o cartão é reconhecido pelo prefixo.
    assert p["mcp_url"] != PRESETS["tier-erp"]["mcp_url"]
    assert not p["mcp_url"].startswith(PRESETS["tier-erp"]["mcp_url"])


def test_ferramenta_recebe_o_cnpj_de_verdade_e_nao_o_marcador():
    texto, mapa = pii_redactor.redact("notas para o CNPJ 24.254.165/0001-58")
    marcador = next(iter(mapa.items))
    assert marcador in texto
    args = {"busca": marcador, "filtros": [marcador], "limite": 5}
    restaurado = tier_engine._restaurar_pii(args, mapa)
    assert restaurado["busca"] == "24.254.165/0001-58"
    assert restaurado["filtros"] == ["24.254.165/0001-58"]
    assert restaurado["limite"] == 5
    assert args["busca"] == marcador  # o original (o que vai para o log) segue mascarado

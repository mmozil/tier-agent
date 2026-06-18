"""Config da suíte de eval do agente.

Garante TIER_EVAL_MODE=1 (a extração de memória não grava — anti-contaminação) ANTES de
qualquer import de serviço. A suíte é de INTEGRAÇÃO: roda contra o stack real (LLM + MCP do
Pet) dentro do container do tier-agent, usando o cliente/instância de teste configurados em
`eval_harness`. Por isso é marcada `live` e pulada por padrão sem o opt-in EVAL_LIVE=1
(evita rodar/gastar LLM sem querer num `pytest` genérico).
"""

from __future__ import annotations

import os

os.environ.setdefault("TIER_EVAL_MODE", "1")

import pytest


def pytest_configure(config):
    config.addinivalue_line("markers", "live: eval de integração (LLM+MCP reais); rode com EVAL_LIVE=1")


def pytest_collection_modifyitems(config, items):
    if os.getenv("EVAL_LIVE", "").strip().lower() in ("1", "true", "yes"):
        return
    skip_live = pytest.mark.skip(reason="eval de integração (LLM+MCP reais) — rode com EVAL_LIVE=1")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)

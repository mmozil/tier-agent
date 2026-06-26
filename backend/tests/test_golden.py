"""Driver pytest dos golden cases — asserts determinísticos sobre tool calls/freios.

Marcado `live`: roda o agente real (LLM + MCP do Pet). Pulado por padrão; rodar com:
    docker exec -e EVAL_LIVE=1 -e TIER_EVAL_MODE=1 <container> python -m pytest tests -q -s

UM único teste async itera TODOS os casos no MESMO event loop — o engine async do
SQLAlchemy (singleton de módulo) fica preso ao 1º loop que o usa; um teste async por caso
(loop por teste no pytest-asyncio) quebra com "Future attached to a different loop". Então
agregamos as falhas e damos um assert final com o resumo.
"""

from __future__ import annotations

import pytest

from tests import eval_harness as H
from tests.golden_cases import GOLDEN_CASES


def _check_case(case: dict, sig: dict) -> list[str]:
    """Roda os asserts de um caso; devolve lista de falhas (vazia = ok)."""
    fails: list[str] = []

    def _det() -> str:
        return f" | tools={sig['tool_names']} brakes={sig['brakes']}"

    for sub in case.get("must_call", []):
        if H.called(sig, sub) < 1:
            fails.append(f"esperava chamar '{sub}'{_det()}")
    for sub in case.get("must_not", []):
        if H.called(sig, sub) != 0:
            fails.append(f"NÃO devia chamar '{sub}'{_det()}")
    for sub, teto in (case.get("max_calls") or {}).items():
        n = H.called(sig, sub)
        if n > teto:
            fails.append(f"'{sub}' chamado {n}x (teto {teto}){_det()}")
    if H.called(sig, "criar_agendamento"):
        args = H._tool_args(sig, "criar_agendamento")
        if not any(a.get("confirmado") is True for a in args):
            fails.append(f"criar_agendamento sem confirmado:true{_det()}")
    # Regressão de PERSONA/idioma — asserts de TEXTO sobre as respostas do agente
    # (ex.: DevSecOps NUNCA pode dizer 'pet shop'). Checa todas as falas do assistant.
    _text = (sig.get("all_assistant") or sig.get("last_assistant") or "").lower()
    for sub in case.get("must_not_text", []):
        if sub.lower() in _text:
            fails.append(f"texto contém '{sub}' (proibido){_det()}")
    for sub in case.get("must_contain_text", []):
        if sub.lower() not in _text:
            fails.append(f"texto NÃO contém '{sub}' (esperado){_det()}")
    return fails


@pytest.mark.live
async def test_golden_suite():
    resultados: dict[str, list[str]] = {}
    for case in GOLDEN_CASES:
        kw: dict = {}
        if "agent_id" in case:
            kw["agent_id"] = case["agent_id"]
        if "instance" in case:
            kw["instance_id"] = case["instance"]
        if "chat" in case:
            kw["chat"] = case["chat"]
        if "connector" in case:
            kw["connector"] = case["connector"]
        sig = await H.run_conversation(case["turns"], **kw)
        fails = _check_case(case, sig)
        resultados[case["name"]] = fails
        status = "OK" if not fails else "FALHOU"
        print(f"\n=== {case['name']}: {status} ===")
        print(f"  tools: {sig['tool_names']}")
        print(f"  brakes: {sig['brakes']}")
        print(f"  last: {(sig['last_assistant'] or '')[:160]}")
        for f in fails:
            print(f"  ✗ {f}")

    com_falha = {k: v for k, v in resultados.items() if v}
    assert not com_falha, "Casos com falha: " + "; ".join(
        f"{k}: {' / '.join(v)}" for k, v in com_falha.items()
    )

"""Driver pytest dos golden cases — asserts determinísticos sobre tool calls/freios.

Marcado `live`: roda o agente real (LLM + MCP do Pet). Pulado por padrão; rodar com:
    docker exec -e EVAL_LIVE=1 -e TIER_EVAL_MODE=1 <container> python -m pytest tests -q -s
"""

from __future__ import annotations

import pytest

from tests import eval_harness as H
from tests.golden_cases import GOLDEN_CASES


@pytest.mark.live
@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["name"] for c in GOLDEN_CASES])
async def test_golden_case(case):
    sig = await H.run_conversation(case["turns"])

    detalhe = (
        f"\n  tools={sig['tool_names']}\n  brakes={sig['brakes']}"
        f"\n  last={(sig['last_assistant'] or '')[:200]}"
    )

    for sub in case.get("must_call", []):
        assert H.called(sig, sub) >= 1, f"[{case['name']}] esperava chamar '{sub}'.{detalhe}"

    for sub in case.get("must_not", []):
        assert H.called(sig, sub) == 0, f"[{case['name']}] NÃO devia chamar '{sub}'.{detalhe}"

    for sub, teto in (case.get("max_calls") or {}).items():
        n = H.called(sig, sub)
        assert n <= teto, f"[{case['name']}] '{sub}' chamado {n}x (teto {teto}).{detalhe}"

    # criar_agendamento, quando aparece, deve ter ido com confirmado:true em ao menos 1 chamada
    if H.called(sig, "criar_agendamento"):
        args = H._tool_args(sig, "criar_agendamento")
        assert any(a.get("confirmado") is True for a in args), (
            f"[{case['name']}] criar_agendamento sem confirmado:true.{detalhe}"
        )

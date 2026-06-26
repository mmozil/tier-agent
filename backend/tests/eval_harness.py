"""Harness de eval do agente — roda conversas reais contra `handle_inbound_message`.

Filosofia (igual ao que validamos manualmente com `_sim.py`): injeta turnos de cliente
no pipeline REAL do agente (LLM + federação MCP do Pet de verdade), neutraliza o envio de
WhatsApp (monkeypatch do connector), e depois LÊ os sinais determinísticos persistidos em
`ta_message_log` pelas colunas de observabilidade (P1a): `tool_calls_json` + `brakes_fired`.

Os asserts da suíte são sobre esses sinais (quais ferramentas foram chamadas, com quais
args, e quais freios dispararam) — robustos à variação de texto do LLM. NÃO depende do DB do
Pet (que vive noutro container); a validação de "1 agendamento só" é feita pelo padrão de
tool calls (criar 1x com confirmado:true / alterar em vez de 2º criar).

Como rodar (dentro do container do tier-agent, WORKDIR /app = backend/):
    docker exec -e EVAL_LIVE=1 -e TIER_EVAL_MODE=1 <container> python -m pytest tests -q -s
ou standalone (só imprime os sinais, sem asserts):
    docker exec -e TIER_EVAL_MODE=1 <container> python -m tests.eval_harness
Local: cd backend && EVAL_LIVE=1 python -m pytest tests -q

Config por env (defaults = setup de teste do PetduBem):
    EVAL_AGENT_ID (6), EVAL_INSTANCE, EVAL_CHAT (5511994964296@s.whatsapp.net), EVAL_NAME
"""

from __future__ import annotations

import json
import os

# TIER_EVAL_MODE garante que a extração de memória NÃO grava (anti-contaminação). Setar antes
# de qualquer import de serviço que possa cachear o valor.
os.environ.setdefault("TIER_EVAL_MODE", "1")

EVAL_AGENT_ID = int(os.getenv("EVAL_AGENT_ID", "6"))
EVAL_INSTANCE = os.getenv("EVAL_INSTANCE", "b008c371-615b-4b80-b8d5-56b5d99426a9")
EVAL_CHAT = os.getenv("EVAL_CHAT", "5511994964296@s.whatsapp.net")
EVAL_NAME = os.getenv("EVAL_NAME", "Cliente Eval")
EVAL_CONNECTOR = os.getenv("EVAL_CONNECTOR", "whatsapp")


_patched = False


def _patch_connector_noop(connector: str = EVAL_CONNECTOR) -> None:
    """Neutraliza o envio real do WhatsApp (não manda mensagem pro cliente no teste)."""
    global _patched
    if _patched:
        return
    from services.connectors.registry import registry

    async def _noop(*_a, **_k):
        return {"ok": True, "simulated": True}

    impl = registry.get(connector)
    impl.send = _noop  # type: ignore[method-assign]
    if hasattr(impl, "send_typing"):
        impl.send_typing = _noop  # type: ignore[method-assign]
    _patched = True


async def reset_conversation(agent_id: int = EVAL_AGENT_ID, chat: str = EVAL_CHAT) -> None:
    """Limpa a conversa do cliente de teste (tier-agent DB) — fresh start por caso.

    Apaga `ta_conversation` (cascade msgs) + `ta_contact_memory` do par (agent, chat).
    NÃO toca o DB do Pet (outro container); a suíte não depende do estado do Pet.
    """
    from sqlalchemy import text as sql_text

    from core.db import db_context

    async with db_context() as db:
        await db.execute(
            sql_text("DELETE FROM ta_contact_memory WHERE agent_id = :a AND external_chat_id = :c"),
            {"a": agent_id, "c": chat},
        )
        await db.execute(
            sql_text("DELETE FROM ta_conversation WHERE agent_id = :a AND external_id = :c"),
            {"a": agent_id, "c": chat},
        )
        await db.commit()


async def _collect_signals(agent_id: int = EVAL_AGENT_ID, chat: str = EVAL_CHAT) -> dict:
    """Lê os turnos assistant da conversa de teste e agrega tool_calls + brakes + texto."""
    from sqlalchemy import text as sql_text

    from core.db import db_context

    async with db_context() as db:
        rows = (
            await db.execute(
                sql_text(
                    "SELECT m.role, m.content, m.tool_calls_json, m.brakes_fired "
                    "FROM ta_message_log m JOIN ta_conversation c ON c.id = m.conversation_id "
                    "WHERE c.agent_id = :a AND c.external_id = :ch "
                    "ORDER BY m.id ASC"
                ),
                {"a": agent_id, "ch": chat},
            )
        ).all()

    tool_calls: list[dict] = []
    tool_names: list[str] = []
    brakes: list[str] = []
    last_assistant = ""
    all_assistant: list[str] = []
    for role, content, tcs, brk in rows:
        if role == "assistant":
            last_assistant = content or last_assistant
            if content:
                all_assistant.append(content)
        for tc in tcs or []:
            tool_calls.append(tc)
            # nome sem o prefixo de provider mN_ (ex.: m3_pet_criar_agendamento → pet_criar_agendamento)
            name = (tc.get("name") or "")
            name = name.split("_", 1)[1] if name[:1] == "m" and "_" in name and name[1:2].isdigit() else name
            tool_names.append(name)
        brakes.extend(brk or [])
    return {
        "tool_calls": tool_calls,
        "tool_names": tool_names,
        "brakes": brakes,
        "last_assistant": last_assistant,
        "all_assistant": "\n".join(all_assistant),
    }


async def run_conversation(
    turns: list[str],
    *,
    agent_id: int = EVAL_AGENT_ID,
    instance_id: str = EVAL_INSTANCE,
    chat: str = EVAL_CHAT,
    connector: str = EVAL_CONNECTOR,
) -> dict:
    """Roda uma conversa (lista de mensagens do cliente) e devolve os sinais agregados.

    Por padrão usa o agente de eval do PetduBem (env). Aceita override por caso
    (agent_id/instance_id/chat/connector) — usado nas regressões de persona por template.
    Retorna {tool_calls, tool_names, brakes, last_assistant, all_assistant}.
    """
    _patch_connector_noop(connector)
    await reset_conversation(agent_id, chat)

    from core.db import db_context
    from services import agent_runtime

    for msg in turns:
        async with db_context() as db:
            await agent_runtime.handle_inbound_message(
                db,
                connector_kind=connector,
                instance_id=instance_id,
                external_chat_id=chat,
                sender_name=EVAL_NAME,
                text_content=msg,
                attachments=[],
            )
    return await _collect_signals(agent_id, chat)


def _tool_args(signals: dict, tool_substr: str) -> list[dict]:
    """Args (já truncados) de todas as chamadas cujo nome contém tool_substr."""
    out = []
    for tc in signals["tool_calls"]:
        if tool_substr in (tc.get("name") or ""):
            raw = tc.get("args")
            try:
                out.append(json.loads(raw) if isinstance(raw, str) else (raw or {}))
            except Exception:
                out.append({"_raw": raw})
    return out


def called(signals: dict, tool_substr: str) -> int:
    """Quantas vezes uma tool (por substring do nome) foi chamada na conversa."""
    return sum(1 for n in signals["tool_names"] if tool_substr in n)


if __name__ == "__main__":  # execução standalone (sem pytest)
    import asyncio

    from tests.golden_cases import GOLDEN_CASES  # noqa: PLC0415

    async def _main():
        ok = 0
        for case in GOLDEN_CASES:
            sig = await run_conversation(case["turns"])
            print(f"\n=== {case['name']} ===")
            print("  tools:", sig["tool_names"])
            print("  brakes:", sig["brakes"])
            print("  last:", (sig["last_assistant"] or "")[:160])
            ok += 1
        print(f"\n{ok} casos rodados (asserts via pytest).")

    asyncio.run(_main())

"""«digitando…» mínimo antes da resposta da IA (13/11/2026, CCDA, agente 26).

Cobre: a leitura do param `digitando_minimo` (valores válidos, inválidos e teto), a conta pura do
alvo e da espera (só completa o que falta, nunca soma por cima de modelo lento; variação e extra
por tamanho com teto), a leitura no banco por agente, a espera de fato (acontece / não acontece /
falha = não espera), a ordem no runtime (espera ANTES do 1º balão; sem o relógio, nem consulta) e
os dois webhooks de WhatsApp passando o relógio.

🚨 Laço: `_rodar` reaproveita o laço global e cria outro se algum teste vizinho o deixou fechado;
nunca `asyncio.run()`, que fecha o laço global e quebra os vizinhos.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.db import Base
from models import TaRuntimeParam
from services import agent_runtime, digitando


def _rodar(coro):
    try:
        laco = asyncio.get_event_loop()
        if laco.is_closed():
            raise RuntimeError("laço fechado")
    except RuntimeError:
        laco = asyncio.new_event_loop()
        asyncio.set_event_loop(laco)
    return laco.run_until_complete(coro)


async def _nada(*_a, **_k):
    return None


# ─── 1. Leitura do param ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "valor, esperado",
    [
        (None, 0.0),
        ("", 0.0),
        ("5", 5.0),
        (" 5 ", 5.0),
        ("5.5", 5.5),
        ("5,5", 5.5),
        ('"5"', 5.0),
        (5, 5.0),
        ("0", 0.0),
        ("-3", 0.0),
        ("abc", 0.0),
        ("true", 0.0),
        ("NaN", 0.0),
        ("Infinity", 0.0),
        ('{"segundos": 5}', 0.0),
        ("60", digitando.MINIMO_MAX_S),
    ],
)
def test_ler_minimo(valor, esperado):
    assert digitando.ler_minimo(valor) == esperado


# ─── 2. Conta pura ───────────────────────────────────────────────────────────


def test_alvo_resposta_curta_fica_no_minimo_mais_ou_menos_um_segundo():
    assert digitando.alvo_digitando(5, 80, 0.0) == 5.0
    assert digitando.alvo_digitando(5, 80, 1.0) == 6.0
    assert digitando.alvo_digitando(5, 80, -1.0) == 4.0


def test_alvo_cresce_com_o_tamanho_e_tem_teto():
    assert digitando.alvo_digitando(5, 300, 0.0) == pytest.approx(6.0)  # +0,5 s a cada 100 além de 100
    assert digitando.alvo_digitando(5, 500, 0.0) == pytest.approx(7.0)  # extra no teto (+2 s)
    assert digitando.alvo_digitando(5, 4000, 1.0) == pytest.approx(8.0)  # teto = mínimo + 3 s
    assert digitando.alvo_digitando(5, 4000, 5.0) == pytest.approx(8.0)  # sorteio fora da faixa é cortado


def test_variacao_e_proporcional_em_minimo_curto():
    assert digitando.alvo_digitando(2, 0, 1.0) == pytest.approx(2.4)  # 20% de 2 s, não ± 1 s
    assert digitando.alvo_digitando(2, 0, -1.0) == pytest.approx(1.6)


def test_minimo_zero_e_desligado():
    assert digitando.alvo_digitando(0, 4000, 1.0) == 0.0
    assert digitando.calcular_espera(0, 0.1, 4000, 1.0) == 0.0


def test_espera_so_completa_o_que_falta():
    assert digitando.calcular_espera(5, 1.5, 80, 0.0) == pytest.approx(3.5)  # modelo rápido
    assert digitando.calcular_espera(5, 5.0, 80, 0.0) == 0.0
    assert digitando.calcular_espera(5, 9.0, 80, 0.0) == 0.0  # modelo lento: manda na hora
    assert digitando.calcular_espera(5, -2.0, 80, 0.0) == 5.0  # relógio estranho não aumenta a espera


# ─── 3. Leitura no banco, por agente ─────────────────────────────────────────


@pytest.fixture
def banco(monkeypatch):
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[TaRuntimeParam.__table__])
    with Session(motor, expire_on_commit=False) as s:
        s.add_all(
            [
                TaRuntimeParam(escopo="agent", escopo_id=26, key="digitando_minimo", value="5"),
                TaRuntimeParam(escopo="agent", escopo_id=26, key="agenda_slug", value="ccda"),
                TaRuntimeParam(escopo="tenant", escopo_id=18, key="digitando_minimo", value="9"),
            ]
        )
        s.commit()

        class _S:
            async def execute(self, q, *a, **k):
                return s.execute(q, *a, **k)

        @asynccontextmanager
        async def _ctx():
            yield _S()

        monkeypatch.setattr("core.db.db_context", _ctx)
        yield s
    motor.dispose()


def test_minimo_do_agente_le_so_o_param_do_proprio_agente(banco):
    assert _rodar(digitando.minimo_do_agente(26)) == 5.0
    # agente sem o param (a M7, por exemplo) = desligado; o param de TENANT 18 não vale como de agente
    assert _rodar(digitando.minimo_do_agente(18)) == 0.0
    assert _rodar(digitando.minimo_do_agente(25)) == 0.0


# ─── 4. A espera de fato ─────────────────────────────────────────────────────


@pytest.fixture
def relogio(monkeypatch):
    reg = {"dormiu": [], "consultou": []}

    async def _dormir(seg):
        reg["dormiu"].append(seg)

    monkeypatch.setattr(digitando, "_dormir", _dormir)
    monkeypatch.setattr(digitando, "_sortear", lambda: 0.0)
    return reg


def _minimo(reg, valor):
    async def _ler(agent_id):
        reg["consultou"].append(agent_id)
        if isinstance(valor, Exception):
            raise valor
        return valor

    return _ler


def test_espera_quando_o_modelo_foi_rapido(monkeypatch, relogio):
    monkeypatch.setattr(digitando, "minimo_do_agente", _minimo(relogio, 5.0))
    esperou = _rodar(digitando.aguardar(26, time.monotonic() - 1.0, "Oi! Tudo bem?"))
    assert relogio["consultou"] == [26]
    assert len(relogio["dormiu"]) == 1 and relogio["dormiu"][0] == pytest.approx(4.0, abs=0.2)
    assert esperou == relogio["dormiu"][0]


def test_nao_espera_quando_o_modelo_ja_demorou(monkeypatch, relogio):
    monkeypatch.setattr(digitando, "minimo_do_agente", _minimo(relogio, 5.0))
    assert _rodar(digitando.aguardar(26, time.monotonic() - 9.0, "Oi! Tudo bem?")) == 0.0
    assert relogio["dormiu"] == []


def test_agente_sem_param_nao_espera(monkeypatch, relogio):
    monkeypatch.setattr(digitando, "minimo_do_agente", _minimo(relogio, 0.0))
    assert _rodar(digitando.aguardar(18, time.monotonic(), "Oi")) == 0.0
    assert relogio["dormiu"] == []


def test_sem_relogio_nem_consulta_o_banco(monkeypatch, relogio):
    monkeypatch.setattr(digitando, "minimo_do_agente", _minimo(relogio, 5.0))
    assert _rodar(digitando.aguardar(26, None, "Oi")) == 0.0
    assert relogio["consultou"] == [] and relogio["dormiu"] == []


def test_falha_na_leitura_manda_sem_esperar(monkeypatch, relogio):
    monkeypatch.setattr(digitando, "minimo_do_agente", _minimo(relogio, RuntimeError("banco fora")))
    assert _rodar(digitando.aguardar(26, time.monotonic(), "Oi")) == 0.0
    assert relogio["dormiu"] == []


# ─── 5. No runtime: a espera vem ANTES do 1º balão ───────────────────────────


class _DbRuntime:
    def __init__(self, agente):
        self.agente = agente

    async def get(self, _modelo, _id):
        return self.agente


@pytest.fixture
def turno(monkeypatch):
    """`handle_inbound_message` inteiro até o envio, sem banco, sem modelo e sem rede."""
    eventos: list[tuple] = []
    R = agent_runtime
    conector = SimpleNamespace(id=56, agent_id=26, modo="agente", ia_ligada=True, config_json_enc="x")
    agente = SimpleNamespace(
        id=26, active=True, tenant_id=17, template_kind="custom", persona="", system_prompt="", nome="CCDA"
    )
    resposta = SimpleNamespace(
        text="Oi! A visita pode ser amanhã às 10h.",
        tokens_in=10,
        tokens_out=12,
        model_used="m",
        latency_ms=900,
        tool_calls_made=[],
        brakes_fired=[],
    )

    async def _resolve(*_a, **_k):
        return conector

    async def _conv(_db, **_k):
        return SimpleNamespace(id=900, status="active", msg_count=1, crm_opportunity_id=None)

    async def _falso(*_a, **_k):
        return False

    async def _vazio(*_a, **_k):
        return []

    async def _rag(*_a, **_k):
        return "", []

    async def _orcamento_ok(*_a, **_k):
        return {"status": "ok"}

    async def _llm(*_a, **_k):
        return resposta

    async def _custo(*_a, **_k):
        return 0

    async def _aguardar(agent_id, desde, texto):
        eventos.append(("aguardar", agent_id, desde, texto))
        return 0.0

    class _Impl:
        async def send(self, _cfg, msg):
            eventos.append(("envio", msg.content))

    @asynccontextmanager
    async def _ctx():
        yield SimpleNamespace()

    monkeypatch.setattr(R, "resolve_connector_by_instance", _resolve)
    monkeypatch.setattr(R, "ensure_conversation", _conv)
    monkeypatch.setattr(R, "log_message", _nada)
    monkeypatch.setattr(R, "_espelhar_no_crm", _nada)
    monkeypatch.setattr(R, "build_rag_block", _rag)
    monkeypatch.setattr(R, "load_history", _vazio)
    monkeypatch.setattr(R, "persona_efetiva", lambda *_a, **_k: "persona")
    monkeypatch.setattr(R, "build_contact_block", lambda **_k: "")
    monkeypatch.setattr(R, "build_base_directives", lambda *_a, **_k: "")
    monkeypatch.setattr(R, "decrypt", lambda _x: "{}")
    monkeypatch.setattr(R.registry, "get", lambda _k: _Impl())
    monkeypatch.setattr(R.tier_engine, "send_message", _llm)
    monkeypatch.setattr(R.playbook_router, "match_inbound_message", _nada)
    monkeypatch.setattr("services.csat.maybe_capture_csat", _nada)
    monkeypatch.setattr("services.budget_guard.check_and_enforce", _orcamento_ok)
    monkeypatch.setattr("services.guardrails.is_enabled_for_tenant", _falso)
    monkeypatch.setattr("services.content_moderation.is_enabled_for_tenant", _falso)
    monkeypatch.setattr("services.handoff.wants_human", lambda _t: False)
    monkeypatch.setattr("services.escalation.is_frustrated", lambda _t: False)
    monkeypatch.setattr("services.escalation.detect_loop", _falso)
    monkeypatch.setattr("services.memory_service.search", _vazio)
    monkeypatch.setattr("services.memory_service.add", _nada)
    monkeypatch.setattr("services.style_adapter.maybe_extract_style", _nada)
    monkeypatch.setattr("services.cost_calculator.calculate_cost_cents", _custo)
    monkeypatch.setattr("services.pet_mirror.mirror_recent_to_pet", _nada)
    monkeypatch.setattr("services.lead_capture.maybe_capture_lead", _nada)
    monkeypatch.setattr("services.erp_crm_client.integracao_ativa", lambda: False)
    monkeypatch.setattr("services.langfuse_client.trace_event", _nada)
    monkeypatch.setattr("core.db.db_context", _ctx)
    monkeypatch.setattr(digitando, "aguardar", _aguardar)

    def _executar(**extra):
        async def _tudo():
            r = await R.handle_inbound_message(
                _DbRuntime(agente),
                connector_kind="whatsapp_cloud",
                instance_id="pnid",
                external_chat_id="5511987654321",
                sender_name="Maria",
                text_content="Quero agendar visita",
                **extra,
            )
            await asyncio.sleep(0)  # deixa as tarefas de fundo (espelho, memória) terminarem
            return r

        return _rodar(_tudo())

    return SimpleNamespace(eventos=eventos, executar=_executar, resposta=resposta)


def test_runtime_espera_antes_do_primeiro_balao(turno):
    r = turno.executar(digitando_desde=123.0)
    assert r["status"] == "ok"
    assert turno.eventos == [
        ("aguardar", 26, 123.0, turno.resposta.text),
        ("envio", turno.resposta.text),
    ]


def test_runtime_sem_relogio_nao_chama_a_espera(turno):
    r = turno.executar()
    assert r["status"] == "ok"
    assert turno.eventos == [("envio", turno.resposta.text)]


# ─── 6. Os webhooks passam o relógio do «digitando…» ─────────────────────────


@pytest.fixture
def webhook(monkeypatch):
    from services.connectors.registry import registry as reg

    estado = {"ia": [], "digitou_em": [], "conector": SimpleNamespace(id=56, agent_id=26, config_json_enc="x")}

    async def _resolve(*_a, **_k):
        return estado["conector"]

    async def _ia(_db, **kw):
        estado["ia"].append(kw)
        return {"status": "ok", "agent_id": 26}

    async def _verdadeiro(*_a, **_k):
        return True

    class _Canal:
        async def mark_read_and_typing(self, _cfg, _mid):
            estado["digitou_em"].append(time.monotonic())

        async def send_typing(self, _cfg, _to, state="composing"):
            if state == "composing":
                estado["digitou_em"].append(time.monotonic())

    @asynccontextmanager
    async def _ctx():
        yield SimpleNamespace()

    monkeypatch.setattr("random.uniform", lambda _a, _b: 0.0)
    monkeypatch.setattr("core.db.db_context", _ctx)
    monkeypatch.setattr("core.encryption.decrypt", lambda _x: "{}")
    monkeypatch.setattr(reg, "get", lambda _k: _Canal())
    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    monkeypatch.setattr(agent_runtime, "handle_inbound_message", _ia)
    from routes import webhooks

    monkeypatch.setattr(webhooks, "_ia_vai_responder", _verdadeiro)
    return estado


def test_numero_oficial_passa_o_relogio_do_digitando(webhook):
    from routes import webhooks

    _rodar(
        webhooks._process_cloud_message_humanized(
            phone_number_id="pnid",
            mid="m1",
            from_id="5511987654321",
            sender_name="Maria",
            text_content="Oi",
            attachments=[],
        )
    )
    assert len(webhook["ia"]) == 1
    desde = webhook["ia"][0]["digitando_desde"]
    assert isinstance(desde, float) and desde >= webhook["digitou_em"][0]


def test_numero_oficial_sem_conector_nao_passa_relogio(webhook):
    from routes import webhooks

    webhook["conector"] = None
    _rodar(
        webhooks._process_cloud_message_humanized(
            phone_number_id="pnid",
            mid="m1",
            from_id="5511987654321",
            sender_name="Maria",
            text_content="Oi",
            attachments=[],
        )
    )
    assert webhook["ia"][0]["digitando_desde"] is None and webhook["digitou_em"] == []


def test_numero_qr_passa_o_relogio_do_digitando(webhook):
    from routes import webhooks

    _rodar(
        webhooks._process_engine_message(
            instance_id="inst",
            external_chat_id="5511987654321@s.whatsapp.net",
            sender_name="Maria",
            text_content="Oi",
            attachments=[],
        )
    )
    desde = webhook["ia"][0]["digitando_desde"]
    assert isinstance(desde, float) and desde >= webhook["digitou_em"][0]

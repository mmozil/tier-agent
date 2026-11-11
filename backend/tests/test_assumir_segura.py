"""«Assumir (pausar IA)» segura a IA quando o cliente escreve de novo (11/11/2026).

O «Assumir» grava `status = "handed_off"`, mas `ensure_conversation` só procurava conversa
`active`. Medido em produção: conversa 26 assumida → o cliente escreveu → nasceu a 28 ativa e a IA
respondeu 36 vezes por cima do atendente. O guarda `handed_off` de `handle_inbound_message` nunca
disparava, porque a conversa que ele recebia era sempre a nova.

Correção: a busca acha também a `handed_off` com mensagem nos últimos 7 dias — a mesma janela do
follow-up (`_sem_atendimento_humano` em scheduler.py). Mais velha que isso, abre conversa nova.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()`: o `run` fecha o laço
global e quebra os testes vizinhos que usam o mesmo padrão.
"""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from models import TaConversation
from services import agent_runtime

CONTATO = "5511961250350@s.whatsapp.net"


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _nada(*_a, **_k):
    return None


# ─── 1. A cláusula gerada ────────────────────────────────────────────────────


class _DbVazio:
    """Banco falso que não acha nada: só guarda a consulta para inspeção."""

    def __init__(self):
        self.consultas = []
        self.adicionados = []

    async def execute(self, q, *_a, **_k):
        self.consultas.append(q)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(first=lambda: None))

    def add(self, obj):
        self.adicionados.append(obj)

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None


def _sql_com_valores(q) -> tuple[str, dict]:
    """Compila para o Postgres e troca cada parâmetro pelo valor (datetime vira <LIMITE>)."""
    compilado = q.compile(dialect=postgresql.dialect())
    sql = str(compilado)
    for nome, valor in compilado.params.items():
        texto = "<LIMITE>" if isinstance(valor, datetime) else repr(valor)
        sql = sql.replace(f"%({nome})s", texto)
    return " ".join(sql.split()), compilado.params


def test_busca_aceita_assumida_com_limite_de_7_dias(monkeypatch):
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    db = _DbVazio()
    antes = datetime.utcnow()
    _rodar(
        agent_runtime.ensure_conversation(
            db, agent_id=8, connector_kind="whatsapp", external_id=CONTATO, connector_id=46, por_numero=True,
        )
    )
    depois = datetime.utcnow()

    sql, params = _sql_com_valores(db.consultas[-1])
    # active OU (handed_off E recente) — AND liga mais forte que OR, por isso sem parêntese interno
    assert (
        "(ta_conversation.status = 'active' OR ta_conversation.status = 'handed_off' "
        "AND ta_conversation.last_message_at >= <LIMITE>)"
    ) in sql, sql
    # o resto da busca não mudou: contato, número, mais nova primeiro, uma só
    assert "ta_conversation.external_id = '5511961250350@s.whatsapp.net'" in sql
    assert "ta_conversation.connector_id = 46" in sql
    assert "ORDER BY ta_conversation.id DESC" in sql and "LIMIT 1" in sql

    limite = next(v for v in params.values() if isinstance(v, datetime))
    assert antes - timedelta(days=7) <= limite <= depois - timedelta(days=7)


def test_janela_e_a_mesma_do_follow_up():
    """Se alguém mexer numa das duas janelas, as duas regras divergem: o follow-up calaria o bot
    e a IA responderia (ou o contrário). Mede a janela do scheduler pela consulta que ele monta."""
    import scheduler

    agora = datetime(2026, 11, 11, 12, 0)
    compilado = scheduler._sem_atendimento_humano(agora).compile(dialect=postgresql.dialect())
    limites = [v for v in compilado.params.values() if isinstance(v, datetime)]
    assert len(limites) == 1
    assert agora - limites[0] == agent_runtime.JANELA_CONVERSA_ASSUMIDA == timedelta(days=7)


# ─── 2. A cláusula rodando num banco de verdade (SQLite em memória) ─────────────


class _DbSqlite:
    """AsyncSession de mentira por cima de um SQLite em memória: a consulta roda de verdade."""

    def __init__(self, sessao, agente=None):
        self.s = sessao
        self.agente = agente

    async def execute(self, q, *_a, **_k):
        return self.s.execute(q)

    def add(self, obj):
        self.s.add(obj)

    async def commit(self):
        self.s.commit()

    async def refresh(self, obj):
        self.s.refresh(obj)

    async def get(self, _model, _id):
        return self.agente


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    TaConversation.__table__.create(motor)
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


def _semear(s, *linhas):
    agora = datetime.utcnow()
    for id_, status, idade, contato in linhas:
        s.add(
            TaConversation(
                id=id_, agent_id=8, connector_kind="whatsapp", external_id=contato, connector_id=46,
                status=status, msg_count=3, last_message_at=agora - idade,
            )
        )
    s.commit()


def _quem_casa(s, monkeypatch) -> list[int]:
    """Roda a cláusula de ensure_conversation SEM o limit: devolve todas as conversas que ela aceita."""
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    db = _DbVazio()
    _rodar(
        agent_runtime.ensure_conversation(
            db, agent_id=8, connector_kind="whatsapp", external_id=CONTATO, connector_id=46, por_numero=True,
        )
    )
    q = db.consultas[-1]
    return sorted(s.execute(select(TaConversation.id).where(q.whereclause)).scalars().all())


def test_clausula_aceita_ativa_e_assumida_recente_e_recusa_o_resto(sessao, monkeypatch):
    _semear(
        sessao,
        (1, "closed", timedelta(hours=1), CONTATO),  # encerrada: nunca volta
        (2, "handed_off", timedelta(days=8), CONTATO),  # assumida e parada há mais de 7 dias
        (3, "handed_off", timedelta(days=7, minutes=1), CONTATO),  # um minuto fora da janela
        (4, "handed_off", timedelta(days=6, hours=23), CONTATO),  # assumida dentro da janela
        (5, "active", timedelta(days=30), CONTATO),  # ativa vale com qualquer idade (como antes)
        (6, "handed_off", timedelta(hours=1), "5511900000000@s.whatsapp.net"),  # outro contato
    )
    assert _quem_casa(sessao, monkeypatch) == [4, 5]


def test_caso_26_28_cliente_volta_cai_na_assumida(sessao, monkeypatch):
    """A conversa 26 foi assumida há 2 horas; o cliente escreve: a mensagem entra na 26, nada nasce."""
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    _semear(sessao, (26, "handed_off", timedelta(hours=2), CONTATO))
    db = _DbSqlite(sessao)

    conv = _rodar(
        agent_runtime.ensure_conversation(
            db, agent_id=8, connector_kind="whatsapp", external_id=CONTATO, contact_name="Cecília",
            connector_id=46,
        )
    )
    assert conv.id == 26 and conv.status == "handed_off"
    assert conv.msg_count == 4  # contou a mensagem nova
    assert datetime.utcnow() - conv.last_message_at < timedelta(minutes=1)  # janela renovada
    assert sessao.execute(select(func.count()).select_from(TaConversation)).scalar() == 1


def test_assumida_parada_ha_mais_de_7_dias_abre_conversa_nova(sessao, monkeypatch):
    """Depois de uma semana sem mensagem, a IA volta: conversa nova, ativa."""
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    _semear(sessao, (26, "handed_off", timedelta(days=8), CONTATO))
    db = _DbSqlite(sessao)

    conv = _rodar(
        agent_runtime.ensure_conversation(
            db, agent_id=8, connector_kind="whatsapp", external_id=CONTATO, connector_id=46,
        )
    )
    assert conv.id != 26 and conv.status == "active"
    assert sessao.execute(select(func.count()).select_from(TaConversation)).scalar() == 2


# ─── 3. Ponta a ponta: a mensagem do cliente chega e a IA fica calada ───────────


def test_cliente_escreve_na_assumida_e_a_ia_nao_responde(sessao, monkeypatch):
    _semear(sessao, (26, "handed_off", timedelta(hours=2), CONTATO))
    conector = SimpleNamespace(id=46, agent_id=8, modo="agente", ia_ligada=True, config_json_enc="")
    agente = SimpleNamespace(id=8, active=True, tenant_id=18, template_kind="custom")
    db = _DbSqlite(sessao, agente)
    reg: dict[str, list] = {"log": [], "envio": [], "llm": []}

    async def _resolve(*_a, **_k):
        return conector

    async def _log(_db, **kw):
        reg["log"].append(kw)

    async def _falso(*_a, **_k):
        return False

    async def _sem_csat(*_a, **_k):
        return None

    async def _orcamento_ok(*_a, **_k):
        return {"status": "ok"}

    async def _llm(*_a, **_k):
        reg["llm"].append(_a)
        raise AssertionError("a IA não pode ser chamada numa conversa assumida")

    class _Impl:
        async def send(self, *_a, **_k):
            reg["envio"].append(_a)

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    monkeypatch.setattr(agent_runtime, "log_message", _log)
    monkeypatch.setattr(agent_runtime.registry, "get", lambda _k: _Impl())
    monkeypatch.setattr(agent_runtime.tier_engine, "send_message", _llm)
    monkeypatch.setattr("services.csat.maybe_capture_csat", _sem_csat)
    monkeypatch.setattr("services.budget_guard.check_and_enforce", _orcamento_ok)
    monkeypatch.setattr("services.guardrails.is_enabled_for_tenant", _falso)
    monkeypatch.setattr("services.content_moderation.is_enabled_for_tenant", _falso)

    r = _rodar(
        agent_runtime.handle_inbound_message(
            db, connector_kind="whatsapp", instance_id="i", external_chat_id=CONTATO,
            sender_name="Cecília", text_content="e o preço do integral?",
        )
    )
    assert r == {"status": "handed_off_paused", "agent_id": 8, "conversation_id": 26}
    assert [x["conversation_id"] for x in reg["log"]] == [26]  # a mensagem ficou na conversa assumida
    assert reg["envio"] == [] and reg["llm"] == []
    assert sessao.execute(select(func.count()).select_from(TaConversation)).scalar() == 1

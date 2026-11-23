"""A equipe escreve primeiro pelo celular e o cliente responde — o fluxo inteiro (23/11/2026, M7).

Entra pelas mesmas funções do webhook, num Postgres de verdade, com as mensagens do cliente chegando
JUNTAS (é como o Fabio respondeu: quatro em seguida). Só o modelo, o envio e o CRM são dublês.

Precisa de um Postgres VAZIO (o teste apaga tudo):
    TA_TESTE_PG_URL=postgresql+asyncpg://usuario:senha@host:porta/banco
Sem a variável, pula. Rode sozinho: o engine é criado no import.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime

import pytest

PG = os.getenv("TA_TESTE_PG_URL", "")
if not PG:
    pytest.skip("defina TA_TESTE_PG_URL (Postgres vazio)", allow_module_level=True)
if "core.db" in sys.modules:
    pytest.skip("rode este arquivo sozinho: o engine já foi criado por outro teste", allow_module_level=True)

from cryptography.fernet import Fernet  # noqa: E402

os.environ["DATABASE_URL"] = PG
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ["FERNET_KEY"] = Fernet.generate_key().decode()
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"
os.environ["TIER_WHATSAPP_ENGINE_URL"] = "http://127.0.0.1:9"
os.environ["TIER_ERP_API_URL"] = "http://127.0.0.1:9"
os.environ["TIER_PAY_API_URL"] = "http://127.0.0.1:9"
os.environ["ENVIRONMENT"] = "test"

from sqlalchemy import text  # noqa: E402

import main  # noqa: E402
from core.db import Base, SessionLocal, engine  # noqa: E402
from core.encryption import encrypt  # noqa: E402
from models import TaAgent, TaConnector, TaMember, TaTenant, TaUsageDaily  # noqa: E402
from services import agent_runtime, eco_envio, fala_pendente, tier_engine, wa_chave  # noqa: E402
from tests.test_fala_pendente import RedisDeMentira  # noqa: E402

LACO = asyncio.new_event_loop()
TEL, LID = "5511988887777@s.whatsapp.net", "69875292733455@lid"
C: dict = {}


def _rodar(coro):
    return LACO.run_until_complete(coro)


async def _preparar():
    async with engine.begin() as con:
        await con.run_sync(Base.metadata.create_all)
    for nome in [n for n in dir(main) if n.startswith("_ensure_")]:
        await getattr(main, nome)()


async def _limpar():
    async with engine.begin() as con:
        ts = (await con.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))).scalars().all()
        await con.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in ts) + " RESTART IDENTITY CASCADE"))
    async with SessionLocal() as db:
        t = TaTenant(nome="M7 de teste", email="dono@m7.teste", sku="pro", status="active")
        db.add(t)
        await db.flush()
        isa = TaMember(tenant_id=t.id, nome="Isabella", email="isa@m7.teste", role="atendente", status="active")
        ag = TaAgent(tenant_id=t.id, nome="Pré-atendimento", active=True, persona="Você é a Isa.")
        db.add_all([isa, ag])
        await db.flush()
        cfg = encrypt(json.dumps({"instance_id": "inst-9150", "api_key": "k", "phone": "551131329150"}))
        cn = TaConnector(
            agent_id=ag.id, kind="whatsapp", config_json_enc=cfg, enabled=True, modo="agente", member_id=isa.id
        )
        db.add(cn)
        # A 1ª mensagem do dia cria esta linha; várias juntas disputam a criação (corrida antiga de
        # `log_message`, fora do assunto daqui) e o teste ficaria instável.
        db.add(TaUsageDaily(tenant_id=t.id, day=datetime.utcnow().strftime("%Y-%m-%d"), messages=0))
        await db.commit()
        C.update(con=cn.id, isa=isa.id)


@pytest.fixture(scope="module", autouse=True)
def _banco():
    asyncio.set_event_loop(LACO)
    _rodar(_preparar())


@pytest.fixture
def mundo(monkeypatch):
    _rodar(_limpar())
    m = {"ia": [], "envios": [], "crm": [], "redis": RedisDeMentira()}

    async def _modelo(*a, **k):
        m["ia"].append(k.get("user_content") or (a[1] if len(a) > 1 else ""))
        await asyncio.sleep(0.3)
        return tier_engine.EngineReply(text="Boa tarde, tudo bem? Aqui é a Isa, da M7 Ambientes.", model_used="teste")

    class _Canal:
        async def send(self, cfg, msg):
            m["envios"].append(msg.content)
            return {"waMessageId": "X"}

        async def send_typing(self, *a, **k):
            pass

    async def _crm(db, **k):
        m["crm"].append((k["conv"].id, k["agente_respondeu"], k["text_content"]))

    async def _nao_e_eco(inst, texto):
        return False

    @asynccontextmanager
    async def _redis():
        yield m["redis"]

    monkeypatch.setattr(tier_engine, "send_message", _modelo)
    monkeypatch.setattr(agent_runtime.registry, "get", lambda kind: _Canal())
    monkeypatch.setattr(agent_runtime, "_espelhar_no_crm", _crm)
    monkeypatch.setattr(eco_envio, "consumir", _nao_e_eco)

    async def _sem_memoria(*a, **k):
        return []

    async def _sem_rag(*a, **k):
        return "", []

    from services import memory_service

    # memória e base de conhecimento usam pgvector, que o Postgres do teste pode não ter
    monkeypatch.setattr(memory_service, "search", _sem_memoria, raising=False)
    monkeypatch.setattr(agent_runtime, "build_rag_block", _sem_rag)
    monkeypatch.setattr(fala_pendente, "_cliente", _redis)
    return m


async def _equipe(texto, wid, *, chat=TEL, jid=LID, em=None):
    wa_chave.definir({"id": wid, "remote_jid": jid, "from_me": True}, "agent")
    async with SessionLocal() as db:
        con = await db.get(TaConnector, C["con"])
        return await agent_runtime.registrar_fala_do_celular(
            db, con, instance_id="inst-9150", external_chat_id=chat, text_content=texto, attachments=None, enviada_em=em
        )


async def _cliente(texto, wid, *, chat=TEL, jid=LID):
    wa_chave.definir({"id": wid, "remote_jid": jid, "from_me": False}, "user")
    async with SessionLocal() as db:
        return await agent_runtime.handle_inbound_message(
            db,
            connector_kind="whatsapp",
            instance_id="inst-9150",
            external_chat_id=chat,
            sender_name="Fabio",
            text_content=texto,
            attachments=[],
        )


async def _sql(q, **k):
    async with SessionLocal() as db:
        return (await db.execute(text(q), k)).mappings().all()


def _conversas():
    return _rodar(_sql("SELECT id, status, msg_count, assigned_member_id FROM ta_conversation ORDER BY id"))


def _mensagens():
    return _rodar(_sql("SELECT role, content, member_id, wa_from_me, created_at FROM ta_message_log ORDER BY id"))


def test_controle_sem_fala_da_equipe_a_ia_responde(mundo):
    _rodar(_cliente("Olá! Posso ter mais informações?", "C1"))
    assert len(mundo["ia"]) == 1 and mundo["envios"]
    assert mundo["crm"] and mundo["crm"][-1][1] is True


@pytest.mark.parametrize("lento", [None, "ler", "apagar"])
def test_equipe_primeiro_cliente_responde_quatro_juntas(mundo, monkeypatch, lento):
    """O caso do Fabio: quatro falas da Camilla, quatro respostas do cliente ao mesmo tempo."""
    falas = ["Olá Fábio, bom dia! Aqui é Camilla", "Tudo bem com você?", "Recebemos seu contato", "Já comprou?"]
    for i, f in enumerate(falas):
        assert _rodar(_equipe(f, f"E{i}"))["status"] == "guardada"
    assert _conversas() == []  # a fala da equipe não abre conversa
    if lento:  # alarga a janela entre ler, gravar e apagar: é onde uma mensagem passaria pela outra
        original = getattr(fala_pendente, lento)

        async def _devagar(*a, **k):
            r = await original(*a, **k) if lento == "ler" else None
            await asyncio.sleep(0.6)
            return r if lento == "ler" else await original(*a, **k)

        monkeypatch.setattr(fala_pendente, lento, _devagar)

    async def juntas():
        return await asyncio.gather(
            *(
                asyncio.create_task(_cliente(t, f"C{i}"))
                for i, t in enumerate(["ainda não", "bom dia", "sou uma empresa", "preços?"])
            )
        )

    _rodar(juntas())
    (conv,) = _conversas()
    assert conv["status"] == "handed_off"
    ms = _mensagens()
    assert [m["content"] for m in ms[:4]] == falas  # na ordem, acima do cliente
    assert all(m["role"] == "agent" and m["member_id"] == C["isa"] and m["wa_from_me"] for m in ms[:4])
    assert sorted(m["content"] for m in ms[4:]) == sorted(["ainda não", "bom dia", "sou uma empresa", "preços?"])
    assert len(ms) == 8  # nada em dobro
    assert mundo["ia"] == [] and mundo["envios"] == []  # a IA não falou por cima
    assert [c[1] for c in mundo["crm"]] == [False]  # o card nasce, uma vez, sem «agente respondeu»
    assert mundo["redis"].listas[fala_pendente.chaves(C["con"], [TEL])[0]] == []


def test_mensagens_chegando_escalonadas_no_meio_da_gravacao(mundo):
    """Uma a cada 80 ms: alguma cai depois de a fala ter sido lida e antes de o status estar gravado."""
    _rodar(_equipe("Aqui é Camilla", "E1"))
    _rodar(_equipe("Tudo bem?", "E2"))

    async def uma(i):
        await asyncio.sleep(i * 0.08)
        return await _cliente(f"m{i}", f"C{i}")

    async def todas():
        return await asyncio.gather(*(asyncio.create_task(uma(i)) for i in range(8)))

    _rodar(todas())
    assert len(_conversas()) == 1 and mundo["ia"] == []
    ms = [m["content"] for m in _mensagens()]
    assert ms[:2] == ["Aqui é Camilla", "Tudo bem?"] and len(ms) == 10
    assert len(mundo["crm"]) == 1


def test_fala_da_equipe_so_com_o_codigo_oculto(mundo):
    """14 de 121 no 9150: a fala sai só com o `@lid`; a resposta do cliente traz o telefone e o código."""
    _rodar(_equipe("Aqui é Camilla", "E1", chat=LID, jid=LID))
    _rodar(_cliente("oi", "C1"))
    assert _conversas()[0]["status"] == "handed_off" and mundo["ia"] == []
    assert len(mundo["crm"]) == 1


def test_conversa_ja_aberta_e_fala_da_equipe_so_com_o_codigo(mundo):
    """O buraco do caminho 1: a conversa existe pelo telefone e a fala não a encontra pelo código."""
    _rodar(_cliente("quero cadeiras", "C1"))
    assert len(mundo["ia"]) == 1
    assert _rodar(_equipe("Oi, aqui é a Camilla", "E1", chat=LID, jid=LID))["status"] == "guardada"
    _rodar(_cliente("sim", "C2"))
    assert len(mundo["ia"]) == 1 and _conversas()[0]["status"] == "handed_off"


def test_caminho_1_com_telefone_pausa_na_hora(mundo):
    _rodar(_cliente("quero cadeiras", "C1"))
    assert _rodar(_equipe("Oi, aqui é a Camilla", "E1"))["status"] == "gravada"
    _rodar(_cliente("sim", "C2"))
    assert len(mundo["ia"]) == 1


def test_devolvida_para_a_ia_ela_volta_a_responder(mundo):
    _rodar(_equipe("Aqui é Camilla", "E1"))
    _rodar(_cliente("oi", "C1"))
    _rodar(_devolver())
    _rodar(_cliente("e agora?", "C2"))
    assert len(mundo["ia"]) == 1


async def _devolver():
    async with SessionLocal() as db:
        await db.execute(text("UPDATE ta_conversation SET status='active'"))
        await db.commit()


def test_quem_ve_a_conversa_nao_muda_por_causa_da_fala(mundo):
    _rodar(_cliente("quero cadeiras", "C1"))
    antes = _conversas()[0]["assigned_member_id"]
    _rodar(_equipe("Oi", "E1"))
    assert _conversas()[0]["assigned_member_id"] == antes


def test_falha_no_meio_nao_perde_a_mensagem_do_cliente(mundo, monkeypatch):
    _rodar(_equipe("Aqui é Camilla", "E1"))

    async def _explode(*a, **k):
        raise RuntimeError("caiu")

    monkeypatch.setattr(fala_pendente, "ler", _explode)
    _rodar(_cliente("oi", "C1"))
    assert "oi" in [m["content"] for m in _mensagens()]
    assert mundo["crm"]  # e o card também


def test_gravacao_que_falha_nao_perde_a_fala_da_equipe(mundo, monkeypatch):
    """Só sai do Redis depois do commit: se o banco recusar, a próxima mensagem do cliente recupera."""
    import core.db as cdb

    _rodar(_equipe("Aqui é Camilla", "E1"))
    original = cdb.db_context

    @asynccontextmanager
    async def _commit_falha():
        async with original() as s:

            async def _recusa():
                raise RuntimeError("banco recusou")

            s.commit = _recusa
            yield s

    monkeypatch.setattr(cdb, "db_context", _commit_falha)
    _rodar(_cliente("oi", "C1"))
    monkeypatch.setattr(cdb, "db_context", original)
    _rodar(_cliente("alguém aí?", "C2"))
    assert "Aqui é Camilla" in [m["content"] for m in _mensagens()]
    assert _conversas()[0]["status"] == "handed_off"


def test_ia_desligada_no_numero_tambem_poe_a_fala_e_o_card(mundo, monkeypatch):
    monkeypatch.setattr(agent_runtime, "ia_responde_agora", lambda c, agora=None: False)
    _rodar(_equipe("Aqui é Camilla", "E1"))
    _rodar(_cliente("oi", "C1"))
    assert [m["content"] for m in _mensagens()] == ["Aqui é Camilla", "oi"]
    assert len(mundo["crm"]) == 1 and mundo["ia"] == []

"""Fala do celular no número com IA (18/11/2026).

M7: a Isa responde pelo WhatsApp do número principal (modo agente) e o Agent descartava todo
`fromMe` como «eco da IA» — 47 mensagens dela em 7 dias não existiam no Agent, e a conversa do card
30963 mostrava só a Marisa respondendo a uma pergunta invisível. Agora o adaptador anota cada envio
do sistema antes de postar, o eco consome a anotação, e o que sobra é a equipe no celular.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from services import agent_runtime, eco_envio

# ── a fila de anotações ─────────────────────────────────────────────────────


class _RedisDeMentira:
    def __init__(self):
        self.listas: dict[str, list[str]] = {}

    def pipeline(self, transaction=True):
        dono = self

        class _P:
            def __init__(self):
                self.ops = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            def rpush(self, k, v):
                self.ops.append(("rpush", k, v))

            def expire(self, k, s):
                self.ops.append(("expire", k, s))

            async def execute(self):
                for op, k, v in self.ops:
                    if op == "rpush":
                        dono.listas.setdefault(k, []).append(v)

        return _P()

    async def lpop(self, k):
        lista = self.listas.get(k) or []
        return lista.pop(0) if lista else None


@pytest.fixture
def redis_falso(monkeypatch):
    r = _RedisDeMentira()

    async def _c():
        return r

    monkeypatch.setattr(eco_envio, "_cliente", _c)
    return r


def _rodar(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_cada_envio_consome_uma_anotacao_e_a_terceira_igual_e_do_celular(redis_falso):
    """A IA manda «Olá, tudo bem?» duas vezes; a Isa digita a mesma frase uma terceira."""

    async def caso():
        await eco_envio.anotar("inst", "Olá, tudo bem?")
        await eco_envio.anotar("inst", "Olá, tudo bem?")
        return [await eco_envio.consumir("inst", "Olá, tudo bem?") for _ in range(3)]

    assert _rodar(caso()) == [True, True, False]


def test_espaco_nas_pontas_nao_separa_o_eco_do_envio(redis_falso):
    async def caso():
        await eco_envio.anotar("inst", "Bom dia!\n\nConsigo sim, Pedro ")
        return await eco_envio.consumir("inst", "Bom dia!  Consigo sim, Pedro")

    assert _rodar(caso()) is True


def test_anotacao_de_um_numero_nao_vale_para_outro(redis_falso):
    async def caso():
        await eco_envio.anotar("numero-principal", "te dou um help")
        return await eco_envio.consumir("celular-da-marisa", "te dou um help")

    assert _rodar(caso()) is False


def test_redis_fora_responde_nao_sei(monkeypatch):
    async def _quebrado():
        raise ConnectionError("redis fora")

    monkeypatch.setattr(eco_envio, "_cliente", _quebrado)

    async def caso():
        await eco_envio.anotar("inst", "oi")  # não levanta
        return await eco_envio.consumir("inst", "oi")

    assert _rodar(caso()) is None


# ── o adaptador anota ANTES de postar ───────────────────────────────────────


def test_adaptador_anota_antes_de_postar(monkeypatch):
    """O eco pode chegar antes de o POST devolver: se a anotação viesse depois, o eco seria lido
    como fala do celular e a resposta da IA apareceria duas vezes."""
    from services.connectors.adapters import whatsapp as ad
    from services.connectors.base import ConnectorAttachment, ConnectorConfig, OutboundMessage

    ordem: list[tuple] = []

    async def _anotar(inst, texto):
        ordem.append(("anotou", texto))

    class _Resp:
        status_code = 200

        def json(self):
            return {"waMessageId": "X"}

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            ordem.append(("postou", url.rsplit("/", 1)[-1]))
            return _Resp()

    monkeypatch.setattr(eco_envio, "anotar", _anotar)
    monkeypatch.setattr(ad.httpx, "AsyncClient", _Cli)
    cfg = ConnectorConfig(data={"instance_id": "inst", "api_key": "k"})
    c = ad.WhatsAppConnector()

    _rodar(c.send(cfg, OutboundMessage(external_chat_id="55@s.whatsapp.net", content="Olá")))
    _rodar(
        c.send(
            cfg,
            OutboundMessage(
                external_chat_id="55@s.whatsapp.net",
                content="",
                attachments=[ConnectorAttachment(kind="document", url="https://x/a.pdf", name="a.pdf")],
            ),
        )
    )
    assert ordem == [("anotou", "Olá"), ("postou", "text"), ("anotou", "[document]"), ("postou", "document")]


# ── o que entra na conversa ─────────────────────────────────────────────────


class _DbDeMentira:
    def __init__(self, recentes=()):
        self.recentes = list(recentes)
        self.commits = 0

    async def get(self, model, pk):
        return SimpleNamespace(id=pk, tenant_id=18)

    async def execute(self, *a, **k):
        recentes = self.recentes

        class _R:
            def scalars(self):
                return self

            def all(self):
                return recentes

        return _R()

    async def commit(self):
        self.commits += 1


CONECTOR = SimpleNamespace(id=55, agent_id=25, member_id=18, modo="agente")


@pytest.fixture
def ambiente(monkeypatch):
    estado = {"eco": False, "conv": SimpleNamespace(id=1865, msg_count=2, last_message_at=None, status="active", assigned_member_id=18), "gravadas": []}

    async def _consumir(inst, texto):
        return estado["eco"]

    async def _conversa(db, **kw):
        return estado["conv"]

    async def _log(db, **kw):
        estado["gravadas"].append(kw)

    monkeypatch.setattr(eco_envio, "consumir", _consumir)
    monkeypatch.setattr(agent_runtime, "conversa_em_curso", _conversa)
    monkeypatch.setattr(agent_runtime, "log_message", _log)
    return estado


def _fala(db, texto="te dou um help, má"):
    return _rodar(
        agent_runtime.registrar_fala_do_celular(
            db,
            CONECTOR,
            instance_id="inst",
            external_chat_id="5511911833528@s.whatsapp.net",
            text_content=texto,
            attachments=None,
        )
    )


def test_fala_do_celular_entra_como_da_equipe(ambiente):
    db = _DbDeMentira()
    r = _fala(db)
    assert r == {"status": "gravada", "conversation_id": 1865}
    (g,) = ambiente["gravadas"]
    assert g["role"] == "agent" and g["member_id"] == 18 and g["content"] == "te dou um help, má"
    assert ambiente["conv"].msg_count == 3 and db.commits == 1


def test_eco_do_envio_nao_entra(ambiente):
    ambiente["eco"] = True
    assert _fala(_DbDeMentira())["status"] == "eco_do_envio"
    assert ambiente["gravadas"] == []


def test_sem_conversa_nao_abre_uma(ambiente):
    """Abrir conversa pelo celular faria a IA atender quem a equipe procurou por fora (a Marisa
    virou lead exatamente assim)."""
    ambiente["conv"] = None
    assert _fala(_DbDeMentira())["status"] == "sem_conversa"
    assert ambiente["gravadas"] == []


def test_redis_fora_reconhece_o_pedaco_da_resposta_da_ia(ambiente):
    """A IA grava a resposta inteira e manda em balões: o eco é um pedaço dela."""
    ambiente["eco"] = None
    db = _DbDeMentira(recentes=["Olá, tudo bem?\n\nAqui é a Isa, da M7 Ambientes. Recebi o seu contato."])
    assert _fala(db, "Aqui é a Isa, da M7 Ambientes.")["status"] == "eco_por_conteudo"
    assert ambiente["gravadas"] == []


def test_redis_fora_e_texto_novo_entra(ambiente):
    ambiente["eco"] = None
    db = _DbDeMentira(recentes=["Olá, tudo bem?"])
    assert _fala(db, "má, posso mandar uma moça dona de uma clínica?")["status"] == "gravada"


# ── o webhook despacha pelo modo do número ──────────────────────────────────


def _webhook(monkeypatch, modo):
    import routes.webhooks as wh

    chamadas: list[str] = []

    async def _conn(db, kind, inst):
        return SimpleNamespace(id=55, agent_id=25, member_id=18, modo=modo)

    async def _celular(db, conn, **kw):
        chamadas.append("celular")
        return {"status": "gravada", "conversation_id": 1}

    async def _registro(db, conn, **kw):
        chamadas.append("registro")
        return {"conversation_id": 1}

    class _Ctx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *a):
            return False

    import core.db

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _conn)
    monkeypatch.setattr(agent_runtime, "registrar_fala_do_celular", _celular)
    monkeypatch.setattr(agent_runtime, "registrar_mensagem_sem_ia", _registro)
    monkeypatch.setattr(core.db, "db_context", lambda: _Ctx())
    _rodar(
        wh._process_engine_from_me(
            instance_id="inst", external_chat_id="55@s.whatsapp.net", text_content="oi", attachments=[]
        )
    )
    return chamadas


def test_webhook_numero_com_ia_vai_para_a_fala_do_celular(monkeypatch):
    assert _webhook(monkeypatch, "agente") == ["celular"]


def test_webhook_numero_em_registro_continua_como_estava(monkeypatch):
    assert _webhook(monkeypatch, "registro") == ["registro"]


# ── a fala do celular PAUSA a IA (23/11/2026) ───────────────────────────────


def test_fala_do_celular_pausa_a_ia_como_o_painel(ambiente):
    """M7, conversa 2159: a Camilla escreveu às 11:25 pelo celular e às 13:09 a IA abriu de novo."""
    _fala(_DbDeMentira(), "Para quando precisa que a entrega aconteça Marcelo?")
    assert ambiente["conv"].status == "handed_off"
    assert ambiente["conv"].assigned_member_id == 18  # quem vê a conversa não muda


def test_eco_da_propria_ia_nao_pausa_a_ia(ambiente):
    """Se o eco pausasse, a IA se calaria sozinha depois da 1ª resposta — em todo número."""
    ambiente["eco"] = True
    _fala(_DbDeMentira(), "Olá, tudo bem?")
    assert ambiente["conv"].status == "active"

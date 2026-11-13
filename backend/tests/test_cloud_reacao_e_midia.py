"""Número oficial (WhatsApp Cloud), 13/11/2026 — caso do CCDA relatado pelo Marcos.

A família reagiu com um emoji ao «tenha um ótimo dia» e a IA respondeu «não posso abrir anexos»:
a reação virava a mensagem «[reaction]». E foto/documento da família ficavam só «[image]» — ninguém
abria. Agora: reação marca o balão e não chama a IA; mídia baixa da Meta e vai para o armazenamento.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.db import Base
from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaTenant
from routes import webhooks
from services import agent_runtime

WA = "5511987654321"


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _Db:
    def __init__(self, s):
        self.s = s

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(
        motor, tables=[m.__table__ for m in (TaTenant, TaAgent, TaConnector, TaConversation, TaMessageLog)]
    )
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


def _webhook(monkeypatch, mensagens):
    """Roda o webhook com as mensagens dadas; devolve (o que foi para a IA, as reações agendadas)."""
    pedidos, reacoes = [], []

    async def _nao_visto(*_a, **_k):
        return False

    async def _proc(**kw):
        pedidos.append(kw)

    async def _reacao(**kw):
        reacoes.append(kw)

    monkeypatch.setattr(webhooks, "_verify_meta_signature", lambda *_a: True)
    monkeypatch.setattr(webhooks, "_record_idempotent", _nao_visto)
    monkeypatch.setattr(webhooks, "_process_cloud_message_humanized", _proc)
    monkeypatch.setattr(webhooks, "_registrar_reacao_cloud", _reacao)
    payload = {
        "object": "whatsapp_business_account",
        "entry": [{"changes": [{"value": {
            "metadata": {"phone_number_id": "pnid"},
            "contacts": [{"profile": {"name": "Maria"}, "wa_id": WA}],
            "messages": mensagens,
        }}]}],
    }

    class _Req:
        headers: dict = {}

        async def body(self):
            return json.dumps(payload).encode()

        async def json(self):
            return payload

    r = _rodar(webhooks.whatsapp_cloud_webhook(_Req(), db=SimpleNamespace()))
    _rodar(asyncio.sleep(0))
    return pedidos, reacoes, r


def test_reacao_nao_chama_a_ia_e_marca_o_balao(monkeypatch):
    pedidos, reacoes, r = _webhook(monkeypatch, [
        {"from": WA, "id": "m1", "type": "reaction", "reaction": {"message_id": "wamid.X", "emoji": "❤️"}},
    ])
    assert pedidos == []  # a IA não é chamada
    assert reacoes == [{"phone_number_id": "pnid", "from_id": WA, "alvo_id": "wamid.X", "emoji": "❤️"}]
    assert {"from": WA, "status": "reaction"} in r["processed"]


def test_texto_continua_indo_para_a_ia(monkeypatch):
    pedidos, reacoes, _ = _webhook(monkeypatch, [{"from": WA, "id": "m2", "type": "text", "text": {"body": "Obrigada"}}])
    assert [p["text_content"] for p in pedidos] == ["Obrigada"] and reacoes == []


def test_foto_documento_e_figurinha_vao_para_baixar(monkeypatch):
    pedidos, _, _ = _webhook(monkeypatch, [
        {"from": WA, "id": "m3", "type": "image", "image": {"id": "MID1", "mime_type": "image/jpeg", "caption": "boletim"}},
        {"from": WA, "id": "m4", "type": "document",
         "document": {"id": "MID2", "mime_type": "application/pdf", "filename": "rg.pdf"}},
        {"from": WA, "id": "m5", "type": "sticker", "sticker": {"id": "MID3", "mime_type": "image/webp"}},
        {"from": WA, "id": "m6", "type": "audio", "audio": {"id": "MID4", "mime_type": "audio/ogg"}},
    ])
    assert [(p["text_content"], p["midia"]) for p in pedidos] == [
        ("boletim", {"kind": "image", "id": "MID1", "mime": "image/jpeg", "name": None}),
        ("[document]", {"kind": "document", "id": "MID2", "mime": "application/pdf", "name": "rg.pdf"}),
        ("[image]", {"kind": "image", "id": "MID3", "mime": "image/webp", "name": None}),
        ("[audio]", None),  # áudio segue pelo caminho da transcrição
    ]
    assert pedidos[3]["audio_media_id"] == "MID4"


# ─── a reação grava no balão certo ─────────────────────────────────────────


def _cenario(sessao, monkeypatch):
    sessao.add(TaConversation(id=1, agent_id=26, connector_id=56, connector_kind="whatsapp_cloud", external_id=WA))
    sessao.add_all([
        TaMessageLog(id=10, conversation_id=1, role="agent", content="MODELO", wa_message_id=None),
        TaMessageLog(id=11, conversation_id=1, role="user", content="Obrigada"),
        TaMessageLog(id=12, conversation_id=1, role="assistant", content="Tenha um ótimo dia!", wa_message_id=None),
        TaMessageLog(id=13, conversation_id=1, role="user", content="ok"),
    ])
    sessao.commit()

    @asynccontextmanager
    async def _ctx():
        yield _Db(sessao)

    async def _conn(_db, kind, inst):
        return SimpleNamespace(id=56) if (kind, inst) == ("whatsapp_cloud", "pnid") else None

    monkeypatch.setattr("core.db.db_context", _ctx)
    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _conn)


def test_reacao_sem_wamid_vai_para_a_ultima_mensagem_nossa(sessao, monkeypatch):
    _cenario(sessao, monkeypatch)
    _rodar(webhooks._registrar_reacao_cloud(phone_number_id="pnid", from_id=WA, alvo_id="wamid.nao-guardado", emoji="❤️"))
    assert sessao.get(TaMessageLog, 12).reacoes_json["contato"]["emoji"] == "❤️"
    assert sessao.get(TaMessageLog, 13).reacoes_json is None  # nunca na mensagem da família


def test_reacao_pelo_wamid_e_tirar_a_reacao(sessao, monkeypatch):
    _cenario(sessao, monkeypatch)
    m = sessao.get(TaMessageLog, 10)
    m.wa_message_id = "wamid.MODELO"
    sessao.commit()
    _rodar(webhooks._registrar_reacao_cloud(phone_number_id="pnid", from_id=WA, alvo_id="wamid.MODELO", emoji="👍"))
    assert sessao.get(TaMessageLog, 10).reacoes_json["contato"]["emoji"] == "👍"
    _rodar(webhooks._registrar_reacao_cloud(phone_number_id="pnid", from_id=WA, alvo_id="wamid.MODELO", emoji=""))
    assert sessao.get(TaMessageLog, 10).reacoes_json is None


def test_reacao_de_outro_numero_nao_grava(sessao, monkeypatch):
    _cenario(sessao, monkeypatch)
    _rodar(webhooks._registrar_reacao_cloud(phone_number_id="outro", from_id=WA, alvo_id=None, emoji="❤️"))
    assert all(sessao.get(TaMessageLog, i).reacoes_json is None for i in (10, 11, 12, 13))


# ─── a mídia baixa e vai para o armazenamento ───────────────────────────────


def _midia_ambiente(monkeypatch, *, conteudo, url):
    async def _conn(_db, kind, inst):
        return SimpleNamespace(id=56, config_json_enc="x")

    class _Cloud:
        async def download_media(self, token, media_id):
            assert token == "TOKEN" and media_id == "MID1"
            return conteudo

    subidos = []

    def _upload(content, **kw):
        subidos.append((len(content), kw))
        return {"url": url, "storage": "r2" if url.startswith("http") else "filesystem"}

    import importlib

    import core.encryption as cripto
    from services import storage_service

    registro = importlib.import_module("services.connectors.registry")  # o pacote exporta o OBJETO com o mesmo nome

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _conn)
    monkeypatch.setattr(cripto, "decrypt", lambda _x: json.dumps({"token": "TOKEN"}))
    monkeypatch.setattr(registro.registry, "get", lambda _k: _Cloud())
    monkeypatch.setattr(storage_service.storage, "upload", _upload)
    return subidos


def test_foto_baixa_e_vira_anexo_que_abre(monkeypatch):
    subidos = _midia_ambiente(monkeypatch, conteudo=b"JPEG!", url="https://cdn.exemplo/inbound/whatsapp-cloud/a.jpeg")
    a = _rodar(webhooks._baixar_midia_cloud(None, "pnid", {"kind": "image", "id": "MID1", "mime": "image/jpeg", "name": None}))
    assert (a.kind, a.url, a.mime, a.size_bytes, a.erro) == (
        "image", "https://cdn.exemplo/inbound/whatsapp-cloud/a.jpeg", "image/jpeg", 5, None)
    assert subidos[0][1]["folder"] == "inbound/whatsapp-cloud"


def test_midia_que_nao_baixa_entra_marcada(monkeypatch):
    _midia_ambiente(monkeypatch, conteudo=None, url="")
    a = _rodar(webhooks._baixar_midia_cloud(None, "pnid", {"kind": "document", "id": "MID1", "mime": "application/pdf", "name": "rg.pdf"}))
    assert (a.kind, a.url, a.name, a.erro) == ("document", None, "rg.pdf", "nao_baixada")

"""A página de números mostra o estado REAL do WhatsApp (28/10/2026).

A lista lia o `status` gravado na última vez que alguém abriu o QR, e nada o
atualizava quando o número caía. Medido em 28/10: 2 números diziam «Conectado»
com o WhatsApp fora (um da M7 desde 25/10) — e o «Escanear QR» só aparece fora do
«connected». A Nathalia (CCDA) ia abrir a tela e não ter onde clicar.
"""

import asyncio
import json
from types import SimpleNamespace

from routes import connectors
from services import engine_client


class _Db:
    """`trocar` simula outra rota gravando o número enquanto o motor respondia (28/11/2026)."""

    def __init__(self, trocar=None):
        self.commits = 0
        self.travas = 0
        self.trocar = trocar or {}

    async def refresh(self, obj, attribute_names=None, with_for_update=None):
        assert with_for_update, "tem de reler TRAVADO"
        self.travas += 1
        if obj.id in self.trocar:
            obj.config_json_enc = json.dumps(self.trocar[obj.id])

    async def commit(self):
        self.commits += 1


def _conn(cid, kind="whatsapp", enabled=True, **cfg):
    base = {"instance_id": f"inst-{cid}", "api_key": "k", "status": "connected"}
    base.update(cfg)
    return SimpleNamespace(id=cid, kind=kind, enabled=enabled, config_json_enc=json.dumps(base))


def _motor(monkeypatch, respostas):
    monkeypatch.setattr(connectors, "decrypt", lambda s: s)
    monkeypatch.setattr(connectors, "encrypt", lambda s: s)

    async def _status(instance_id, api_key):
        r = respostas[instance_id]
        if isinstance(r, Exception):
            raise r
        return {"status": r}

    monkeypatch.setattr(engine_client, "get_status", _status)


def _st(c):
    return json.loads(c.config_json_enc)["status"]


def test_numero_que_caiu_deixa_de_dizer_conectado(monkeypatch):
    caiu, vivo = _conn(44), _conn(43)
    _motor(monkeypatch, {"inst-44": "qr", "inst-43": "connected"})
    db = _Db()
    asyncio.run(connectors._status_ao_vivo(db, [caiu, vivo]))
    assert _st(caiu) == "qr" and _st(vivo) == "connected"
    assert db.commits == 1


def test_logged_out_vira_caiu_na_tela(monkeypatch):
    c = _conn(9)
    _motor(monkeypatch, {"inst-9": "logged_out"})
    asyncio.run(connectors._status_ao_vivo(_Db(), [c]))
    assert _st(c) == "logged_out"


def test_instancia_que_o_motor_nao_conhece_vira_desconectado(monkeypatch):
    c = _conn(12)
    _motor(monkeypatch, {"inst-12": engine_client.EngineError("x", status=404)})
    asyncio.run(connectors._status_ao_vivo(_Db(), [c]))
    assert _st(c) == "disconnected"


def test_motor_fora_do_ar_mantem_o_gravado_e_nao_grava(monkeypatch):
    c = _conn(37)
    _motor(monkeypatch, {"inst-37": engine_client.EngineError("x", status=502)})
    db = _Db()
    asyncio.run(connectors._status_ao_vivo(db, [c]))
    assert _st(c) == "connected" and db.commits == 0


def test_sem_mudanca_nao_grava_e_cloud_nao_consulta(monkeypatch):
    vivo = _conn(43)
    cloud = _conn(50, kind="whatsapp_cloud")
    _motor(monkeypatch, {"inst-43": "connected"})  # cloud não está aqui: se consultar, KeyError
    db = _Db()
    asyncio.run(connectors._status_ao_vivo(db, [vivo, cloud]))
    assert db.commits == 0


def test_escanear_qr_no_meio_nao_volta_a_instancia_antiga(monkeypatch):
    """Revisão do APP-682 (28/11/2026): enquanto o motor respondia, o «Escanear QR» gravou uma
    instância nova e apagou a antiga (404 → «disconnected»). Gravar o JSON lido antes devolveria
    a instância antiga ao número, e o QR lido não conectaria nada."""
    c = _conn(44, status="logged_out")
    _motor(monkeypatch, {"inst-44": engine_client.EngineError("x", status=404)})
    nova = {"instance_id": "inst-44-nova", "api_key": "k2", "status": "pending"}
    db = _Db(trocar={44: nova})
    asyncio.run(connectors._status_ao_vivo(db, [c]))
    assert json.loads(c.config_json_enc) == nova  # intacto: nem instância antiga, nem status trocado
    assert db.travas == 1 and db.commits == 1  # a trava foi solta


def test_mudanca_grava_so_o_status_sobre_o_que_esta_no_banco(monkeypatch):
    c = _conn(45)
    _motor(monkeypatch, {"inst-45": "qr"})
    # outra rota gravou o telefone no meio; a leitura não pode apagar isso
    db = _Db(trocar={45: {"instance_id": "inst-45", "api_key": "k", "status": "connected", "phone": "5511"}})
    asyncio.run(connectors._status_ao_vivo(db, [c]))
    assert json.loads(c.config_json_enc) == {"instance_id": "inst-45", "api_key": "k", "status": "qr", "phone": "5511"}


def test_numero_desligado_nao_e_perguntado_ao_motor(monkeypatch):
    connectors._CONSULTADO_EM.clear()
    desligado = _conn(60, enabled=False)
    _motor(monkeypatch, {})  # se consultar, KeyError
    db = _Db()
    asyncio.run(connectors.status_ao_vivo_recente(db, [desligado]))
    assert db.commits == 0


def test_a_lista_so_consulta_o_motor_quando_pede():
    import inspect

    fonte = inspect.getsource(connectors.list_connectors)
    assert "ao_vivo: bool = False" in fonte and "if ao_vivo" in fonte

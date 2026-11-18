"""Disparo pelo WhatsApp NÃO oficial (número por QR, motor Baileys) — 18/11/2026.

Cobre: o texto ({{nome}} é a única variável), a criação (intervalo 30/10 s, limite 1.000, sem nome,
descadastrado), o envio de cada contato (confere se tem WhatsApp, manda para o endereço que o
WhatsApp devolveu, entra na conversa do número, carimba o eco no registro, status SEM conversa),
o que pausa o disparo (número desconectado, chave recusada, motor fora) e o que só falha o
contato (sem WhatsApp, recusa do motor), o «parar» depois do disparo, e as rotas da tela.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()` (ver test_disparo_lote).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@localhost/teste")
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ.setdefault("FERNET_KEY", "chave-so-de-teste-com-mais-de-32-caracteres")

import asyncio  # noqa: E402
import json  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from core.auth import CurrentUser  # noqa: E402
from core.db import Base  # noqa: E402
from models import (  # noqa: E402
    TaAgent,
    TaConnector,
    TaConversation,
    TaDisparoOficial,
    TaDisparoOficialEnvio,
    TaMember,
    TaMessageLog,
    TaRuntimeParam,
    TaTenant,
    TaUsageDaily,
    TaWaDescadastro,
    TaWaEnvioStatus,
)
from services import agent_runtime, disparo_lote, disparo_oficial, disparo_qr, proactive  # noqa: E402
from services.connectors.base import ConnectorError  # noqa: E402


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _nada(*_a, **_k):
    return None


class _Db:
    """AsyncSession de mentira por cima de um SQLite em memória: a consulta roda de verdade."""

    def __init__(self, sessao):
        self.s = sessao

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)

    def add(self, obj):
        self.s.add(obj)

    async def flush(self):
        self.s.flush()

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()

    async def refresh(self, obj):
        self.s.refresh(obj)

    async def get(self, modelo, id_, **kw):
        return self.s.get(modelo, id_, **kw)

    def get_bind(self):
        return self.s.get_bind()


TABELAS = [
    TaTenant,
    TaAgent,
    TaConnector,
    TaMember,
    TaConversation,
    TaMessageLog,
    TaUsageDaily,
    TaWaDescadastro,
    TaWaEnvioStatus,
    TaRuntimeParam,
    TaDisparoOficial,
    TaDisparoOficialEnvio,
]

REGISTRO, COM_IA, OFICIAL = 37, 55, 56


class _Motor:
    """O motor Baileys de mentira: guarda «digitando» e envios; um erro por chamada (None = ok)."""

    def __init__(self):
        self.enviados: list[tuple[str, str]] = []
        self.digitando: list[str] = []
        self.erros: list = []

    async def send_typing(self, cfg, to, state="composing"):
        self.digitando.append(to)

    async def send(self, cfg, msg):
        self.enviados.append((msg.external_chat_id, msg.content))
        erro = self.erros.pop(0) if self.erros else None
        if erro:
            raise erro
        return {"id": "inst", "waMessageId": f"3EB0{len(self.enviados):04d}"}


@pytest.fixture
def qr(monkeypatch):
    motor_sql = create_engine("sqlite://")
    Base.metadata.create_all(motor_sql, tables=[m.__table__ for m in TABELAS])
    s = Session(motor_sql, expire_on_commit=False)
    s.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaTenant(id=3, nome="Out", email="o@o")])
    s.add_all([TaAgent(id=20, tenant_id=17, nome="Registro (sem IA)"), TaAgent(id=25, tenant_id=17, nome="Nathalia")])
    s.add(TaMember(id=7, tenant_id=17, nome="Débora", email="debora@ccda"))
    s.flush()
    s.add_all(
        [
            TaConnector(id=REGISTRO, agent_id=20, kind="whatsapp", modo="registro", member_id=7, config_json_enc="x"),
            TaConnector(id=COM_IA, agent_id=25, kind="whatsapp", modo="agente", config_json_enc="x"),
            TaConnector(id=OFICIAL, agent_id=25, kind="whatsapp_cloud", config_json_enc="x"),
        ]
    )
    s.commit()

    from services.connectors.registry import registry

    motor = _Motor()
    monkeypatch.setattr(registry, "get", lambda _k: motor)
    monkeypatch.setattr(
        "core.encryption.decrypt",
        lambda _x: json.dumps({"instance_id": "i1", "api_key": "k", "phone": "5511999999480"}),
    )
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    monkeypatch.setattr(disparo_qr, "_esperar", _nada)

    # «tem WhatsApp?»: por padrão sim, com o endereço SEM o 9 (conta antiga) — prova que o envio e a
    # conversa usam o endereço que o WhatsApp devolve, não o da lista.
    numeros: dict[str, object] = {}

    async def _conferir(_cfg, numero):
        r = numeros.get(numero, "padrao")
        if isinstance(r, Exception):
            raise r
        if r == "padrao":
            return f"{numero[:4]}{numero[5:]}@s.whatsapp.net" if len(numero) == 13 else f"{numero}@s.whatsapp.net"
        return r

    monkeypatch.setattr(disparo_qr, "conferir_numero", _conferir)
    ecos: list = []

    async def _eco(_db, conn, res):
        ecos.append((conn.id, res))

    monkeypatch.setattr(proactive, "marcar_eco_do_envio", _eco)

    db = _Db(s)
    relogio = {"t": datetime.utcnow()}

    def criar(lista, texto="Olá {{nome}}, a visita ao CCDA é sábado. Podemos confirmar?", conn=REGISTRO, **kw):
        return _rodar(disparo_lote.criar_texto(db, tenant_id=17, connector_id=conn, texto=texto, lista=lista, **kw))

    def passo(did):
        relogio["t"] += timedelta(minutes=1)  # a VEZ (30 s) já venceu
        return _rodar(disparo_lote.processar_um(db, did, agora=relogio["t"]))

    yield SimpleNamespace(db=db, s=s, motor=motor, numeros=numeros, ecos=ecos, criar=criar, passo=passo)
    s.close()
    motor_sql.dispose()


def _envios(s, did):
    q = select(TaDisparoOficialEnvio).where(TaDisparoOficialEnvio.disparo_id == did).order_by(TaDisparoOficialEnvio.id)
    return s.execute(q.execution_options(populate_existing=True)).scalars().all()


def _disparo(s, did):
    return s.get(TaDisparoOficial, did, populate_existing=True)


# ─── 1. O texto ───────────────────────────────────────────────────────────────


def test_texto_valido_com_nome():
    t = disparo_qr.validar_texto("  Olá {{ Nome }}, tudo bem?\r\nAbraço  ")
    assert t == "Olá {{ Nome }}, tudo bem?\nAbraço"
    assert disparo_qr.usa_nome(t)
    assert disparo_qr.texto_do_contato(t, "Maria") == "Olá Maria, tudo bem?\nAbraço"
    assert disparo_qr.texto_do_contato(t, None) is None  # não inventa nome
    assert disparo_qr.texto_do_contato("Sem variável", None) == "Sem variável"


@pytest.mark.parametrize(
    ("texto", "trecho"),
    [
        ("   ", "Escreva a mensagem"),
        ("Olá {{1}}", "a única variável é {{nome}}"),
        ("Olá {{nome}}, sua aula é {{data}}", "«{{data}}» não existe"),
        ("x" * (disparo_qr.TEXTO_MAX + 1), "passa de 4.000"),
    ],
)
def test_texto_invalido_diz_por_que(texto, trecho):
    with pytest.raises(ValueError) as e:
        disparo_qr.validar_texto(texto)
    assert trecho in str(e.value)


# ─── 2. Criar ─────────────────────────────────────────────────────────────────


def test_criar_nasce_rascunho_de_texto_com_30s(qr):
    _rodar(disparo_oficial.registrar_descadastro(qr.db, tenant_id=17, connector_id=56, numero="21999998888", texto="x"))
    d = qr.criar("Maria Silva 11 98765-4321\n11 91234-5678\nJoão 21 99999-8888")
    assert (d.status, d.tipo, d.modelo, d.total, d.intervalo_ms, d.variacao_ms) == (
        "rascunho",
        "texto",
        "",
        3,
        30000,
        9000,
    )
    assert d.nome.startswith("Olá {{nome}}, a visita ao CCDA é sábado.")
    assert [(e.numero, e.status) for e in _envios(qr.s, d.id)] == [
        ("5511987654321", "pendente"),
        ("5511912345678", "sem_nome"),  # o texto usa {{nome}} e a lista não trouxe
        ("5521999998888", "descadastrado"),
    ]


def test_texto_sem_nome_todos_recebem(qr):
    d = qr.criar("11 91234-5678\n11 98765-4321", texto="Reunião de pais sábado às 9h.", nome="Reunião")
    assert {e.status for e in _envios(qr.s, d.id)} == {"pendente"}
    assert d.nome == "Reunião" and d.variaveis_json == []


@pytest.mark.parametrize(
    ("kw", "trecho"),
    [
        ({"intervalo_s": 5}, "mínimo entre envios é de 10 segundos"),
        ({"texto": "Olá {{2}}"}, "a única variável é {{nome}}"),
        ({"lista": "\n".join(f"11 9{i:04d}-{i:04d}" for i in range(1001))}, "o limite por disparo é 1.000"),
    ],
)
def test_criar_recusa(qr, kw, trecho):
    lista = kw.pop("lista", "Maria 11 98765-4321")
    with pytest.raises(disparo_lote.ErroDoDisparo) as e:
        qr.criar(lista, **kw)
    assert trecho in str(e.value)


# ─── 3. O envio de cada contato ───────────────────────────────────────────────


def test_envia_pelo_endereco_do_whatsapp_e_entra_na_conversa_do_numero(qr):
    d = qr.criar("Maria Silva 11 98765-4321", nome="Visita de sábado")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "enviado"
    jid = "551187654321@s.whatsapp.net"  # sem o 9: o endereço que o WhatsApp devolveu
    assert qr.motor.digitando == [jid]
    assert qr.motor.enviados == [(jid, "Olá Maria, a visita ao CCDA é sábado. Podemos confirmar?")]
    (e,) = _envios(qr.s, d.id)
    assert (e.status, e.wamid, e.wa_id, e.erro) == ("enviado", "3EB00001", jid, None)
    conv = qr.s.get(TaConversation, e.conversation_id)
    assert (conv.connector_kind, conv.external_id, conv.connector_id, conv.contact_name) == (
        "whatsapp",
        jid,
        REGISTRO,
        "Maria Silva",
    )
    (m,) = qr.s.execute(select(TaMessageLog).where(TaMessageLog.conversation_id == conv.id)).scalars().all()
    assert (m.role, m.member_id, m.model_used, m.wa_message_id, m.wa_from_me) == (
        "agent",
        None,
        "Disparo · Visita de sábado",
        "3EB00001",
        True,
    )
    assert qr.ecos == [(REGISTRO, {"id": "inst", "waMessageId": "3EB00001"})]  # o eco do registro é carimbado
    st = qr.s.execute(select(TaWaEnvioStatus)).scalars().one()
    # SEM conversa: o histórico do card no CRM escreve «WhatsApp oficial» (ver disparo_qr.py)
    assert (st.wamid, st.status, st.connector_id, st.conversation_id) == ("3EB00001", "accepted", REGISTRO, None)
    assert disparo_lote.situacao(e.status, st.status) == "enviado"
    assert _disparo(qr.s, d.id).status == "concluido"  # o último contato saiu: termina na hora


def test_resposta_da_familia_conta_como_respondeu(qr):
    d = qr.criar("Maria 11 98765-4321")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    qr.passo(d.id)
    (e,) = _envios(qr.s, d.id)
    qr.s.add(
        TaMessageLog(
            conversation_id=e.conversation_id,
            role="user",
            content="Oi, quero sim",
            created_at=e.enviado_em + timedelta(minutes=3),
        )
    )
    qr.s.commit()
    assert _rodar(disparo_lote.contagens(qr.db, [d.id]))[d.id]["respondidos"] == 1


def test_numero_sem_whatsapp_falha_so_o_contato(qr):
    qr.numeros["5511987654321"] = None
    d = qr.criar("Maria 11 98765-4321\nJoão 11 91234-5678")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "falhou"
    assert qr.motor.enviados == [] and qr.motor.digitando == []  # nada para quem não tem WhatsApp
    assert _disparo(qr.s, d.id).status == "em_andamento"  # o disparo segue para os outros
    assert qr.passo(d.id) == "enviado"
    assert [(e.status, e.erro) for e in _envios(qr.s, d.id)] == [
        ("falhou", "Este número não tem WhatsApp"),
        ("enviado", None),
    ]


@pytest.mark.parametrize(
    "erro",
    [
        disparo_qr.ErroDoEnvio("O número está desconectado do WhatsApp — reconecte em Canais e retome", conta=True),
        disparo_qr.ErroDoEnvio("O motor do WhatsApp não respondeu (ConnectTimeout)", conta=True),
    ],
)
def test_numero_fora_do_ar_pausa_e_o_contato_volta(qr, erro):
    qr.numeros["5511987654321"] = erro
    d = qr.criar("Maria 11 98765-4321")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "pausou_conta"
    dd = _disparo(qr.s, d.id)
    assert (dd.status, dd.motivo_pausa) == ("pausado", str(erro))
    (e,) = _envios(qr.s, d.id)
    assert (e.status, e.tentativas) == ("pendente", 0)


@pytest.mark.parametrize(
    ("erro", "resultado", "status"),
    [
        (
            ConnectorError(
                'Tier Engine retornou 409: {"error":"Instância não está conectada ao WhatsApp"}',
                kind="whatsapp",
                status_code=409,
            ),
            "pausou_conta",
            "pendente",
        ),
        (
            ConnectorError('Tier Engine retornou 401: {"error":"invalid key"}', kind="whatsapp", status_code=401),
            "pausou_conta",
            "pendente",
        ),
        (
            ConnectorError('Tier Engine retornou 409: {"error":"Bad MAC"}', kind="whatsapp", status_code=409),
            "falhou",
            "falhou",
        ),
        (TimeoutError("lento"), "falhou", "falhou"),
    ],
)
def test_recusa_do_motor_no_envio(qr, erro, resultado, status):
    qr.motor.erros = [erro]
    d = qr.criar("Maria 11 98765-4321\nJoão 11 91234-5678")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == resultado
    assert _envios(qr.s, d.id)[0].status == status
    if isinstance(erro, TimeoutError):
        assert "pode ter saído" in _envios(qr.s, d.id)[0].erro  # não reenvia: duplicaria


@pytest.mark.parametrize(
    ("status", "corpo", "conta", "trecho"),
    [
        (401, "", True, "chave"),
        (403, "", True, "chave"),
        (404, "", True, "não acha este número"),
        (409, '{"error":"Instância não está em execução. Chame /connect primeiro."}', True, "desconectado"),
        (409, '{"error":"Instância não está conectada ao WhatsApp"}', True, "desconectado"),
        (502, "bad gateway", True, "falhou (502)"),
        (409, '{"error":"Bad MAC"}', False, "Bad MAC"),
        (422, '{"error":"validation_error"}', False, "validation_error"),
    ],
)
def test_classifica_a_recusa_do_motor(status, corpo, conta, trecho):
    e = disparo_qr._erro_http(status, corpo)
    assert e.conta is conta and trecho in e.mensagem


def test_numero_do_disparo_trocado_para_oficial_pausa(qr):
    d = qr.criar("Maria 11 98765-4321")
    qr.s.get(TaDisparoOficial, d.id).connector_id = OFICIAL  # o número do disparo não é mais por QR
    qr.s.commit()
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "pausou_numero"
    assert _disparo(qr.s, d.id).motivo_pausa == "O número não oficial deste disparo não existe mais"
    assert qr.motor.enviados == []


def test_numero_desligado_em_canais_pausa(qr):
    d = qr.criar("Maria 11 98765-4321")
    qr.s.get(TaConnector, REGISTRO).enabled = False
    qr.s.commit()
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "pausou_numero"
    assert "desconectado" in _disparo(qr.s, d.id).motivo_pausa


def test_quem_pediu_para_sair_depois_de_criado_nao_recebe(qr):
    d = qr.criar("Maria 11 98765-4321")
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    _rodar(disparo_oficial.registrar_descadastro(qr.db, tenant_id=17, connector_id=56, numero="11987654321", texto="x"))
    assert qr.passo(d.id) == "descadastrado"
    assert qr.motor.enviados == []


def test_numero_com_ia_conversa_do_agente(qr):
    d = qr.criar("Maria 11 98765-4321", conn=COM_IA)
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    assert qr.passo(d.id) == "enviado"
    conv = qr.s.get(TaConversation, _envios(qr.s, d.id)[0].conversation_id)
    assert (conv.agent_id, conv.connector_id) == (25, COM_IA)


# ─── 4. «parar» depois do disparo ─────────────────────────────────────────────


def _disparou(qr, conn):
    d = qr.criar("Maria 11 98765-4321", conn=conn)
    _rodar(disparo_lote.iniciar(qr.db, d.id))
    qr.passo(d.id)
    return "551187654321@s.whatsapp.net"


def _na_lista(qr) -> bool:
    return _rodar(disparo_oficial.esta_descadastrado(qr.db, 17, "5511987654321"))


def test_parar_no_registro_entra_na_lista_e_segue_para_o_inbox(qr):
    jid = _disparou(qr, REGISTRO)
    conn = qr.s.get(TaConnector, REGISTRO)
    out = _rodar(
        disparo_qr.descadastro_depois_do_disparo(qr.db, conn, external_chat_id=jid, sender_name="Maria", texto="Parar")
    )
    assert out is None  # a mensagem segue o caminho do registro: a consultora vê
    assert _na_lista(qr)
    assert len(qr.motor.enviados) == 1  # ninguém responde pelo celular dela


def test_parar_no_numero_com_ia_confirma_uma_vez(qr):
    jid = _disparou(qr, COM_IA)
    conn = qr.s.get(TaConnector, COM_IA)
    out = _rodar(
        disparo_qr.descadastro_depois_do_disparo(qr.db, conn, external_chat_id=jid, sender_name="Maria", texto="sair")
    )
    assert out["status"] == "descadastro" and out["confirmou"]
    assert _na_lista(qr)
    assert qr.motor.enviados[-1] == (jid, disparo_oficial.CONFIRMACAO_DESCADASTRO)
    falas = qr.s.execute(
        select(TaMessageLog.role, TaMessageLog.content)
        .where(TaMessageLog.conversation_id == out["conversation_id"])
        .order_by(TaMessageLog.id)
    ).all()
    assert [f[0] for f in falas] == ["agent", "user", "assistant"]


@pytest.mark.parametrize("texto", ["quero parar de pagar a mensalidade", "Oi", "", None])
def test_frase_comum_nao_e_pedido_de_sair(qr, texto):
    jid = _disparou(qr, COM_IA)
    conn = qr.s.get(TaConnector, COM_IA)
    assert (
        _rodar(
            disparo_qr.descadastro_depois_do_disparo(qr.db, conn, external_chat_id=jid, sender_name=None, texto=texto)
        )
        is None
    )
    assert not _na_lista(qr)


def test_parar_sem_disparo_antes_e_conversa_comum(qr):
    jid = _disparou(qr, COM_IA)
    conv = qr.s.execute(select(TaConversation)).scalars().one()
    qr.s.add(TaMessageLog(conversation_id=conv.id, role="assistant", content="Quer continuar ou parar?"))
    qr.s.commit()
    conn = qr.s.get(TaConnector, COM_IA)
    assert (
        _rodar(
            disparo_qr.descadastro_depois_do_disparo(qr.db, conn, external_chat_id=jid, sender_name=None, texto="parar")
        )
        is None
    )
    assert not _na_lista(qr)


# ─── 5. Rotas da tela ─────────────────────────────────────────────────────────


def _dono():
    return CurrentUser(1, "dono@ccda", tenant_id=17, role="owner")


def _atendente():
    return CurrentUser(1, "debora@ccda", tenant_id=17, member_id=7, member_name="Débora", role="atendente")


@pytest.fixture
def rotas(qr, monkeypatch):
    from routes import disparos_oficiais as r
    from services import visao_conversas

    async def _meus(_db, _t, member_id):
        return [REGISTRO] if member_id == 7 else []

    monkeypatch.setattr(visao_conversas, "conectores_do_membro", _meus)
    monkeypatch.setattr(r, "decrypt", lambda _x: json.dumps({"phone": "5511999999480"}))
    return SimpleNamespace(r=r, req=SimpleNamespace(state=SimpleNamespace()), **vars(qr))


def test_rota_numeros_lista_os_dois_tipos(rotas):
    out = _rodar(rotas.r.numeros(_dono(), rotas.db))
    assert [(n["id"], n["tipo"], n["modo"], n["dono"]) for n in out["numeros"]] == [
        (OFICIAL, "oficial", "agente", None),
        (COM_IA, "nao_oficial", "agente", None),
        (REGISTRO, "nao_oficial", "registro", "Débora"),
    ]
    assert out["pode_criar"] and out["nao_oficial"]["intervalo_padrao_s"] == 30
    so_dela = _rodar(rotas.r.numeros(_atendente(), rotas.db))
    assert [n["id"] for n in so_dela["numeros"]] == [REGISTRO] and not so_dela["pode_criar"]


def test_rota_cria_texto_inicia_e_lista(rotas):
    r, db = rotas.r, rotas.db
    body = r.CriarIn(connector_id=REGISTRO, texto="Olá {{nome}}!", lista="Maria 11 98765-4321\n11 91234-5678")
    out = _rodar(r.criar(body, rotas.req, _dono(), db))
    assert (out["status"], out["tipo"], out["texto"], out["intervalo_s"], out["dono"]) == (
        "rascunho",
        "texto",
        "Olá {{nome}}!",
        30,
        "Débora",
    )
    assert out["contagens"]["sem_nome"] == 1
    assert rotas.req.state.atividade["alvo"] == f"disparo #{out['id']} · texto (não oficial) · 2 contatos"
    assert _rodar(r.iniciar(out["id"], rotas.req, _dono(), db))["status"] == "em_andamento"
    assert [d["tipo"] for d in _rodar(r.listar(_dono(), db, limite=100))["disparos"]] == ["texto"]


def test_rota_texto_vazio_e_atendente_nao_cria(rotas):
    r, db = rotas.r, rotas.db
    with pytest.raises(HTTPException) as e:
        _rodar(r.criar(r.CriarIn(connector_id=REGISTRO, texto="  ", lista="11987654321"), rotas.req, _dono(), db))
    assert (e.value.status_code, e.value.detail) == (422, "Escreva a mensagem")
    with pytest.raises(HTTPException) as e:
        _rodar(r.criar(r.CriarIn(connector_id=REGISTRO, texto="Oi", lista="11987654321"), rotas.req, _atendente(), db))
    assert e.value.status_code == 403


def test_rota_ler_lista_usa_o_limite_do_tipo(rotas):
    r = rotas.r
    lista = "\n".join(f"11 9{i:04d}-{i:04d}" for i in range(1001))
    assert _rodar(r.ler_lista(r.LerListaIn(texto=lista, tipo="texto"), _dono(), rotas.db))["acima_do_limite"]
    assert not _rodar(r.ler_lista(r.LerListaIn(texto=lista), _dono(), rotas.db))["acima_do_limite"]

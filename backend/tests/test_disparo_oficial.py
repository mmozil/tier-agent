"""Disparo em lote pelo WhatsApp oficial — o lado do Agent (11/11/2026).

Cobre: descadastro (botão «Parar Mensagem» e palavra curta sozinha; frase longa NÃO), chave
tolerante ao 9º dígito, 409 no send-template para quem pediu para parar, 502 com o erro da
Meta classificado (do número × do contato), o modelo renderizado entrando na conversa (sem
mudar o status da assumida), o cache do modelo, o status de entrega que nunca regride e a
rota de status filtrada por tenant.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()`: o `run` fecha o laço
global e quebra os testes vizinhos que usam o mesmo padrão.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from core.db import Base
from models import (
    TaAgent,
    TaConnector,
    TaConversation,
    TaMember,
    TaMessageLog,
    TaRuntimeParam,
    TaTenant,
    TaUsageDaily,
    TaWaDescadastro,
    TaWaEnvioStatus,
)
from services import agent_runtime, disparo_oficial
from services.connectors.base import ConnectorError

WA = "5511987654321"
MODELO_META = {
    "id": "1",
    "name": "retomada_de_atendimento",
    "language": "pt_BR",
    "status": "APPROVED",
    "category": "MARKETING",
    "components": [
        {"type": "BODY", "text": "Olá {{1}}, aqui é a Cinthia do CCDA. Podemos retomar seu atendimento?"},
        {"type": "FOOTER", "text": "CCDA Diadema"},
        {
            "type": "BUTTONS",
            "buttons": [
                {"type": "QUICK_REPLY", "text": "Falar conosco"},
                {"type": "QUICK_REPLY", "text": "Parar Mensagem"},
            ],
        },
    ],
}
TEXTO_ESPERADO = (
    "Olá Maria, aqui é a Cinthia do CCDA. Podemos retomar seu atendimento?\n\nCCDA Diadema\n\n"
    "[Botões: Falar conosco · Parar Mensagem]"
)
COMPS = [{"type": "body", "parameters": [{"type": "text", "text": "Maria"}]}]


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

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()

    async def refresh(self, obj):
        self.s.refresh(obj)

    async def get(self, modelo, id_):
        return self.s.get(modelo, id_)

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
]


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[m.__table__ for m in TABELAS])
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


@pytest.fixture(autouse=True)
def _limpa_caches():
    disparo_oficial._cache_modelos.clear()
    disparo_oficial._cache_numeros.clear()
    disparo_oficial._lista_buscada_ate.clear()
    yield
    disparo_oficial._cache_modelos.clear()
    disparo_oficial._cache_numeros.clear()
    disparo_oficial._lista_buscada_ate.clear()


# ─── 1. Descadastro: o que é e o que NÃO é ───────────────────────────────────


@pytest.mark.parametrize(
    "texto",
    [
        "Parar Mensagem",
        "PARAR MENSAGENS",
        "parar",
        "Sair",
        "STOP!",
        "Descadastrar",
        "Não quero receber",
        "Parar Mensagem 🛑",
    ],
)
def test_botao_de_descadastro(texto):
    assert disparo_oficial.eh_descadastro(texto, de_botao=True)


@pytest.mark.parametrize("texto", ["parar", "  Sair. ", "Stop", "DESCADASTRAR!!", "Parar?"])
def test_palavra_curta_sozinha_e_descadastro(texto):
    assert disparo_oficial.eh_descadastro(texto, de_botao=False)


@pytest.mark.parametrize(
    "texto",
    [
        "quero parar de pagar a mensalidade",  # frase longa: é assunto, não descadastro
        "parar mensagem",  # só vale como BOTÃO; escrito, segue para a IA
        "não quero receber",  # idem
        "sair hoje mais cedo",
        "pode parar de me ligar?",
        "",
        None,
    ],
)
def test_texto_livre_que_nao_e_descadastro(texto):
    assert not disparo_oficial.eh_descadastro(texto, de_botao=False)


def test_outro_botao_nao_e_descadastro():
    assert not disparo_oficial.eh_descadastro("Falar conosco", de_botao=True)


# ─── 2. Chave tolerante ao 9º dígito ─────────────────────────────────────────


def test_chave_tolerante_ao_nono_digito():
    c = disparo_oficial.chave_tolerante
    assert c("5511987654321") == c("551187654321") == c("11987654321") == c("1187654321") == "1187654321"
    assert c("5511987654321@s.whatsapp.net") == "1187654321"
    assert c("5521987654321") != c("5511987654321")  # DDD diferente = outra pessoa
    assert c("351912345678") == "351912345678"  # estrangeiro: dígitos inteiros
    assert c("") == ""


# ─── 3. Erro da Meta: do número/conta × do contato ───────────────────────────


@pytest.mark.parametrize("code", [190, 10, 200, 250, 131031, 131042, 131048, 130429, 80007, 368, 0, 4, 132015])
def test_erro_da_conta_para_o_disparo(code):
    assert disparo_oficial.erro_e_da_conta(code)


@pytest.mark.parametrize("code", [131026, 131047, 131049, 131050, 131053, 131056, 130403, 132000, 100, 131000])
def test_erro_do_destinatario_segue_o_disparo(code):
    assert not disparo_oficial.erro_e_da_conta(code)


def test_erro_sem_codigo_decide_pelo_http():
    assert disparo_oficial.erro_e_da_conta(None, 401)
    assert disparo_oficial.erro_e_da_conta(None, 403)
    assert not disparo_oficial.erro_e_da_conta(None, 500)


def test_adaptador_expoe_o_codigo_da_meta_sem_mudar_a_mensagem(monkeypatch):
    from services.connectors.adapters import whatsapp_cloud
    from services.connectors.base import ConnectorConfig

    corpo = {"error": {"code": 131048, "message": "(#131048) Spam rate limit hit", "error_data": {"details": "Limite"}}}
    real = httpx.AsyncClient

    def _cliente(**kw):
        return real(transport=httpx.MockTransport(lambda _req: httpx.Response(400, json=corpo)), **kw)

    monkeypatch.setattr(whatsapp_cloud.httpx, "AsyncClient", _cliente)
    cfg = ConnectorConfig(data={"phone_number_id": "1", "token": "t"})
    with pytest.raises(ConnectorError) as e:
        _rodar(whatsapp_cloud.WhatsAppCloudConnector().send_template(cfg, WA, "x"))
    assert e.value.meta_code == 131048 and e.value.detalhe == "Limite" and e.value.status_code == 400
    assert str(e.value).startswith("Cloud API template 400: ")  # quem lia o texto continua igual


# ─── 4. O texto do modelo como o contato vê ──────────────────────────────────


def test_texto_do_disparo_com_variavel_rodape_e_botoes():
    from routes.whatsapp_oficial import resumo_do_modelo

    assert disparo_oficial.texto_do_disparo(resumo_do_modelo(MODELO_META), "x", COMPS) == TEXTO_ESPERADO


def test_texto_do_disparo_cabecalho_e_variavel_nomeada():
    modelo = {
        "corpo": "Oi {{nome}}, sua visita é {{2}}.",
        "rodape": "",
        "cabecalho": "Aviso de {{1}}",
        "botoes": [],
    }
    comps = [
        {"type": "header", "parameters": [{"type": "text", "text": "matrícula"}]},
        {
            "type": "body",
            "parameters": [
                {"type": "text", "parameter_name": "nome", "text": "Ana"},
                {"type": "text", "text": "amanhã"},
            ],
        },
    ]
    # nomeado entra pelo nome; o posicional segue a ordem dos posicionais
    assert disparo_oficial.texto_do_disparo(modelo, "x", comps) == "Aviso de matrícula\n\nOi Ana, sua visita é {{2}}."


def test_texto_do_disparo_sem_modelo_e_com_midia():
    assert disparo_oficial.texto_do_disparo(None, "boas_vindas", COMPS) == "[Modelo «boas_vindas» enviado]\nMaria"
    midia = {"corpo": "Veja o folheto.", "rodape": None, "cabecalho": None, "cabecalho_midia": "IMAGE", "botoes": []}
    assert disparo_oficial.texto_do_disparo(midia, "x", None) == "[Imagem]\n\nVeja o folheto."


# ─── 5. Cache do modelo ──────────────────────────────────────────────────────


def test_cache_do_modelo_busca_a_meta_uma_vez(monkeypatch):
    chamadas = []

    async def _buscar(cfg):
        chamadas.append(cfg)
        return [MODELO_META, {**MODELO_META, "name": "outro"}]

    monkeypatch.setattr(disparo_oficial, "_buscar_modelos", _buscar)
    for _ in range(50):
        m = _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR"))
    assert m["botoes"] == ["Falar conosco", "Parar Mensagem"]
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "outro", "pt_BR"))["nome"] == "outro"  # veio na mesma busca
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "nao_existe", "pt_BR")) is None  # «não existe» guardado
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "nao_existe", "pt_BR")) is None
    assert len(chamadas) == 1
    _rodar(disparo_oficial.modelo_do_cache(57, {}, "retomada_de_atendimento", "pt_BR"))  # outro número
    assert len(chamadas) == 2


def test_cache_do_modelo_vence_e_falha_da_meta_nao_martela(monkeypatch):
    relogio = {"t": 1000.0}
    monkeypatch.setattr(disparo_oficial.time, "monotonic", lambda: relogio["t"])
    chamadas = []

    async def _buscar(_cfg):
        chamadas.append(1)
        if len(chamadas) == 1:
            raise RuntimeError("Meta fora")
        return [MODELO_META]

    monkeypatch.setattr(disparo_oficial, "_buscar_modelos", _buscar)
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR")) is None
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR")) is None
    assert len(chamadas) == 1  # falha guardada por TTL_FALHA_S
    relogio["t"] += disparo_oficial.TTL_FALHA_S + 1
    assert _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR"))["nome"]
    relogio["t"] += disparo_oficial.TTL_MODELO_S - 5
    _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR"))
    assert len(chamadas) == 2  # ainda válido
    relogio["t"] += 10
    _rodar(disparo_oficial.modelo_do_cache(56, {}, "retomada_de_atendimento", "pt_BR"))
    assert len(chamadas) == 3  # venceu: 10 min


# ─── 6. send-template: 409, 502 e a gravação na conversa ─────────────────────


class _Impl:
    def __init__(self, erro=None):
        self.enviados = []
        self.erro = erro

    async def send_template(self, cfg, to, nome, lang, comps):
        self.enviados.append((to, nome, lang, comps))
        if self.erro:
            raise self.erro
        return {
            "contacts": [{"input": to, "wa_id": WA}],
            "messages": [{"id": "wamid.ABC", "message_status": "accepted"}],
        }


@pytest.fixture
def rota(monkeypatch, sessao):
    from routes import integrations_tier

    conn = SimpleNamespace(id=56, agent_id=26, config_json_enc="cifrado")
    impl = _Impl()

    async def _conector(*_a, **_k):
        return conn

    async def _buscar(_cfg):
        return [MODELO_META]

    monkeypatch.setattr(integrations_tier, "_check_secret", lambda _s: None)
    monkeypatch.setattr(integrations_tier, "_resolve_cloud_connector", _conector)
    monkeypatch.setattr(
        integrations_tier, "decrypt", lambda _x: json.dumps({"phone_number_id": "1", "token": "t", "waba_id": "w"})
    )
    monkeypatch.setattr(integrations_tier.registry, "get", lambda _k: impl)
    monkeypatch.setattr(disparo_oficial, "_buscar_modelos", _buscar)
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    db = _Db(sessao)

    def _enviar(to=WA, **extra):
        body = integrations_tier.CloudSendTemplateIn(
            tenant_id=17, to=to, template_name="retomada_de_atendimento", components=COMPS, **extra
        )
        return _rodar(integrations_tier.cloud_send_template(body, x_tier_integration_secret="s", db=db))

    return SimpleNamespace(enviar=_enviar, impl=impl, db=db, s=sessao)


def test_send_template_de_descadastrado_da_409_e_nao_envia(rota):
    # pediu para parar SEM o 9º dígito; o disparo vem COM: é a mesma pessoa
    _rodar(
        disparo_oficial.registrar_descadastro(
            rota.db, tenant_id=17, connector_id=56, numero="551187654321", texto="Parar"
        )
    )
    with pytest.raises(HTTPException) as e:
        rota.enviar(to="5511987654321@s.whatsapp.net")
    assert e.value.status_code == 409
    assert e.value.detail == {"codigo": "opt_out", "mensagem": "O contato pediu para não receber mensagens"}
    assert rota.impl.enviados == []


def test_descadastro_e_por_tenant(rota):
    _rodar(disparo_oficial.registrar_descadastro(rota.db, tenant_id=99, connector_id=1, numero=WA, texto="Parar"))
    assert rota.enviar()["ok"]  # outro tenant pediu; este colégio ainda pode mandar


def test_send_template_grava_o_modelo_na_conversa_e_o_status(rota):
    r = rota.enviar()
    assert r["ok"] and r["message_id"] == "wamid.ABC" and r["wa_id"] == WA and r["conversation_id"]
    conv = rota.s.get(TaConversation, r["conversation_id"])
    assert conv.external_id == WA and conv.connector_id == 56 and conv.status == "active"
    msg = rota.s.execute(select(TaMessageLog).where(TaMessageLog.conversation_id == conv.id)).scalars().one()
    assert msg.role == "agent" and msg.member_id is None and msg.content == TEXTO_ESPERADO
    assert msg.model_used == "Disparo · retomada_de_atendimento"
    st = rota.s.execute(select(TaWaEnvioStatus)).scalars().one()
    assert (st.wamid, st.status, st.tenant_id, st.connector_id, st.conversation_id) == (
        "wamid.ABC",
        "accepted",
        17,
        56,
        conv.id,
    )


def test_send_template_nao_muda_o_status_da_conversa_assumida(rota):
    rota.s.add(
        TaConversation(
            id=40,
            agent_id=26,
            connector_kind="whatsapp_cloud",
            external_id=WA,
            connector_id=56,
            status="handed_off",
            msg_count=3,
            last_message_at=datetime.utcnow() - timedelta(hours=2),
        )
    )
    rota.s.commit()
    r = rota.enviar()
    assert r["conversation_id"] == 40
    assert rota.s.get(TaConversation, 40).status == "handed_off"


def test_falha_ao_gravar_na_conversa_nao_desfaz_o_envio(rota, monkeypatch):
    async def _quebra(*_a, **_k):
        raise RuntimeError("banco caiu")

    monkeypatch.setattr(disparo_oficial, "gravar_disparo_na_conversa", _quebra)
    r = rota.enviar()
    assert r["ok"] and r["message_id"] == "wamid.ABC" and r["conversation_id"] is None
    assert len(rota.impl.enviados) == 1
    assert rota.s.execute(select(TaWaEnvioStatus.status)).scalar() == "accepted"  # o status nasce assim mesmo


@pytest.mark.parametrize(("code", "conta"), [(131048, True), (190, True), (131026, False), (131047, False)])
def test_meta_recusou_devolve_502_estruturado(rota, code, conta):
    rota.impl.erro = ConnectorError(
        f"Cloud API template 400: (#{code})",
        kind="whatsapp_cloud",
        status_code=400,
        meta_code=code,
        detalhe=f"erro {code}",
    )
    with pytest.raises(HTTPException) as e:
        rota.enviar()
    assert e.value.status_code == 502
    assert e.value.detail == {"codigo": "meta_error", "meta_code": code, "conta": conta, "mensagem": f"erro {code}"}
    assert rota.s.execute(select(TaMessageLog)).first() is None  # nada entra na conversa


def test_config_sem_token_e_da_conta_e_timeout_nao(rota):
    rota.impl.erro = ConnectorError("Config Cloud API incompleta", kind="whatsapp_cloud")
    with pytest.raises(HTTPException) as e:
        rota.enviar()
    assert e.value.detail["conta"] is True and e.value.detail["meta_code"] is None
    rota.impl.erro = httpx.ReadTimeout("demorou")
    with pytest.raises(HTTPException) as e:
        rota.enviar()
    assert e.value.detail["conta"] is False


# ─── 7. iniciar-conversa: não bloqueia, só avisa ─────────────────────────────


def test_iniciar_conversa_envia_e_avisa_descadastrado(monkeypatch, sessao):
    from routes import whatsapp_oficial

    db = _Db(sessao)
    impl = _Impl()
    conn = SimpleNamespace(id=56, agent_id=26, enabled=True)
    agente = SimpleNamespace(id=26, tenant_id=17, nome="Cinthia")

    async def _numero(*_a, **_k):
        return conn, agente, {"waba_id": "w", "token": "t"}

    async def _modelos(_cfg):
        return [MODELO_META]

    monkeypatch.setattr(whatsapp_oficial, "_numero", _numero)
    monkeypatch.setattr(whatsapp_oficial, "_modelos_da_meta", _modelos)
    monkeypatch.setattr(whatsapp_oficial.registry, "get", lambda _k: impl)
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    _rodar(
        disparo_oficial.registrar_descadastro(db, tenant_id=17, connector_id=56, numero="551187654321", texto="Parar")
    )

    body = whatsapp_oficial.IniciarIn(
        connector_id=56, telefone="11987654321", modelo="retomada_de_atendimento", variaveis=["Maria"]
    )
    req = SimpleNamespace(state=SimpleNamespace())
    user = SimpleNamespace(member_id=None, member_name=None)
    r = _rodar(whatsapp_oficial.iniciar_conversa(body, req, user=user, db=db))
    assert r["descadastrado"] is True and r["message_id"] == "wamid.ABC"
    assert len(impl.enviados) == 1  # enviou mesmo assim: é a equipe escolhendo falar
    # a linha do modelo ganha a marca «Modelo» (não «Disparo»: a pessoa abordou, conta nas métricas)
    msg = (
        sessao.execute(select(TaMessageLog).where(TaMessageLog.conversation_id == r["conversation_id"])).scalars().one()
    )
    assert msg.role == "agent" and msg.model_used == "Modelo · retomada_de_atendimento"
    from services import metricas_atendimento as met

    assert not met.e_disparo(msg.role, msg.model_used)


# ─── 8. Status de entrega: nunca regride, failed é final ─────────────────────


def test_status_so_avanca(sessao):
    db = _Db(sessao)

    def _st(status, **kw):
        _rodar(disparo_oficial.registrar_status(db, wamid="wamid.1", status=status, **kw))
        return sessao.execute(select(TaWaEnvioStatus)).scalars().one()

    assert _st("accepted", tenant_id=17, connector_id=56).status == "accepted"
    assert _st("delivered").status == "delivered"
    assert _st("sent").status == "delivered"  # chegou atrasado: não volta
    assert _st("read").status == "read"
    assert _st("delivered").status == "read"
    assert _st("read").status == "read"  # repetido: idempotente
    st = _st("failed", erro_codigo=131026, erro="Message undeliverable")
    assert (st.status, st.erro_codigo, st.erro) == ("failed", 131026, "Message undeliverable")
    assert _st("read").status == "failed"  # final
    assert _st("banana").status == "failed"  # desconhecido é ignorado
    assert sessao.execute(select(TaWaEnvioStatus)).scalars().one().tenant_id == 17


def test_webhook_antes_do_envio_e_o_envio_completa_a_conversa(sessao):
    """O aviso `sent` chega antes do `accepted` do envio: o accepted não regride, mas preenche a conversa."""
    db = _Db(sessao)
    _rodar(disparo_oficial.registrar_status(db, wamid="wamid.2", status="sent", tenant_id=17, connector_id=56))
    _rodar(disparo_oficial.registrar_status(db, wamid="wamid.2", status="accepted", conversation_id=40, destino=WA))
    st = sessao.execute(select(TaWaEnvioStatus)).scalars().one()
    assert (st.status, st.conversation_id, st.destino) == ("sent", 40, WA)


def test_statuses_do_webhook(sessao, monkeypatch):
    db = _Db(sessao)

    async def _alvo(_db, pnid):
        return (56, 17) if pnid == "pnid-ccda" else None

    monkeypatch.setattr(disparo_oficial, "conector_do_numero", _alvo)
    statuses = [
        {"id": "wamid.A", "status": "delivered", "timestamp": "1762898400", "recipient_id": WA},
        {
            "id": "wamid.B",
            "status": "failed",
            "timestamp": "1762898400",
            "recipient_id": WA,
            "errors": [{"code": 131026, "title": "Message undeliverable"}],
        },
        "lixo",
    ]
    assert _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", statuses)) == 2
    assert _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-outro", statuses)) == 0
    linhas = {s.wamid: s for s in sessao.execute(select(TaWaEnvioStatus)).scalars()}
    assert linhas["wamid.A"].status == "delivered" and linhas["wamid.A"].status_em == datetime(2025, 11, 11, 22, 0)
    assert (linhas["wamid.B"].erro_codigo, linhas["wamid.B"].erro) == (131026, "Message undeliverable")


def test_rota_de_status_so_devolve_ids_do_tenant(sessao, monkeypatch):
    from routes import integrations_tier

    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaTenant(id=3, nome="Out", email="o@o")])
    sessao.add_all([TaAgent(id=26, tenant_id=17, nome="Cinthia"), TaAgent(id=2, tenant_id=3, nome="Maria")])
    sessao.add_all(
        [
            TaConnector(id=56, agent_id=26, kind="whatsapp_cloud", config_json_enc="x"),
            TaConnector(id=9, agent_id=2, kind="whatsapp_cloud", config_json_enc="x"),
        ]
    )
    sessao.commit()
    db = _Db(sessao)
    _rodar(disparo_oficial.registrar_status(db, wamid="w.ccda", status="read", tenant_id=17, connector_id=56))
    _rodar(disparo_oficial.registrar_status(db, wamid="w.out", status="read", tenant_id=3, connector_id=9))
    monkeypatch.setattr(integrations_tier, "_check_secret", lambda _s: None)

    body = integrations_tier.CloudStatusIn(tenant_id=17, message_ids=["w.ccda", "w.out", "w.nao_existe"])
    r = _rodar(integrations_tier.cloud_status(body, x_tier_integration_secret="s", db=db))
    assert list(r["status"]) == ["w.ccda"]
    item = r["status"]["w.ccda"]
    assert (
        item["status"] == "read" and item["erro_codigo"] is None and item["erro"] is None and item["em"].endswith("Z")
    )

    with pytest.raises(HTTPException) as e:
        _rodar(
            integrations_tier.cloud_status(
                integrations_tier.CloudStatusIn(tenant_id=17, message_ids=[f"w{i}" for i in range(501)]),
                x_tier_integration_secret="s",
                db=db,
            )
        )
    assert e.value.status_code == 422


# ─── 9. Descadastro que CHEGA: grava, confirma uma vez, sem IA ───────────────


def test_tratar_descadastro(sessao, monkeypatch):
    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaAgent(id=26, tenant_id=17, nome="Cinthia")])
    sessao.commit()
    db = _Db(sessao)
    conn = SimpleNamespace(id=56, agent_id=26, config_json_enc="cifrado")
    enviados = []

    class _Cloud:
        async def send(self, _cfg, msg):
            enviados.append((msg.external_chat_id, msg.content))

    async def _resolve(*_a, **_k):
        return conn

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    monkeypatch.setattr("core.encryption.decrypt", lambda _x: json.dumps({"phone_number_id": "1", "token": "t"}))
    from services.connectors.registry import registry

    monkeypatch.setattr(registry, "get", lambda _k: _Cloud())

    r = _rodar(
        disparo_oficial.tratar_descadastro(
            db, phone_number_id="1", from_id=WA, sender_name="Maria", texto="Parar Mensagem"
        )
    )
    assert r["gravou"] and r["confirmou"]
    assert _rodar(disparo_oficial.esta_descadastrado(db, 17, "551187654321"))
    assert disparo_oficial.CONFIRMACAO_DESCADASTRO == (
        "Pronto! Tiramos seu número da nossa lista de envios. Se precisar de algo, é só escrever aqui."
    )
    assert enviados == [(WA, disparo_oficial.CONFIRMACAO_DESCADASTRO)]
    msgs = sessao.execute(select(TaMessageLog.role, TaMessageLog.content).order_by(TaMessageLog.id)).all()
    assert msgs == [("user", "Parar Mensagem"), ("assistant", disparo_oficial.CONFIRMACAO_DESCADASTRO)]

    # apertou de novo: não duplica a linha da lista
    _rodar(disparo_oficial.tratar_descadastro(db, phone_number_id="1", from_id=WA, sender_name="Maria", texto="Parar"))
    assert len(sessao.execute(select(TaWaDescadastro)).scalars().all()) == 1


def test_processamento_cloud_com_descadastro_nao_chama_a_ia(monkeypatch):
    from routes import webhooks

    chamadas = {"descadastro": [], "ia": []}
    depois_de_modelo = {"v": False}

    async def _ultima(_db, **_k):
        return depois_de_modelo["v"]

    @asynccontextmanager
    async def _ctx():
        yield SimpleNamespace()

    async def _resolve(*_a, **_k):
        return None

    async def _desc(_db, **kw):
        chamadas["descadastro"].append(kw)

    async def _ia(_db, **kw):
        chamadas["ia"].append(kw)

    monkeypatch.setattr("random.uniform", lambda _a, _b: 0.0)
    monkeypatch.setattr("core.db.db_context", _ctx)
    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    monkeypatch.setattr(disparo_oficial, "tratar_descadastro", _desc)
    monkeypatch.setattr(disparo_oficial, "ultima_nossa_foi_modelo", _ultima)
    monkeypatch.setattr(agent_runtime, "handle_inbound_message", _ia)

    base = {"phone_number_id": "1", "mid": "m1", "from_id": WA, "sender_name": "Maria", "attachments": []}
    # botão: vale sempre, sem olhar a última mensagem
    _rodar(
        webhooks._process_cloud_message_humanized(
            **base, text_content="Parar Mensagem", descadastro=True, descadastro_de_botao=True
        )
    )
    assert len(chamadas["descadastro"]) == 1 and chamadas["ia"] == []
    _rodar(webhooks._process_cloud_message_humanized(**base, text_content="Falar conosco"))
    assert len(chamadas["ia"]) == 1 and len(chamadas["descadastro"]) == 1
    # «parar» escrito numa conversa comum: vai para a IA
    _rodar(webhooks._process_cloud_message_humanized(**base, text_content="parar", descadastro=True))
    assert len(chamadas["ia"]) == 2 and len(chamadas["descadastro"]) == 1
    # «parar» escrito logo depois de um modelo: descadastro, sem IA
    depois_de_modelo["v"] = True
    _rodar(webhooks._process_cloud_message_humanized(**base, text_content="parar", descadastro=True))
    assert len(chamadas["ia"]) == 2 and len(chamadas["descadastro"]) == 2


def test_webhook_detecta_descadastro_e_entrega_os_statuses(monkeypatch):
    from routes import webhooks

    pedidos = []
    statuses_recebidos = []

    def _proc(**kw):
        pedidos.append(kw)
        return _nada()

    async def _nao_visto(*_a, **_k):
        return False

    async def _statuses(_db, pnid, statuses):
        statuses_recebidos.append((pnid, statuses))
        return len(statuses)

    monkeypatch.setattr(webhooks, "_verify_meta_signature", lambda *_a: True)
    monkeypatch.setattr(webhooks, "_record_idempotent", _nao_visto)
    monkeypatch.setattr(webhooks, "_process_cloud_message_humanized", _proc)
    monkeypatch.setattr(disparo_oficial, "registrar_statuses_do_webhook", _statuses)

    def _msg(i, tipo, texto):
        corpo = {"text": {"body": texto}} if tipo == "text" else {"button": {"text": texto, "payload": texto}}
        return {"from": WA, "id": f"m{i}", "type": tipo, **corpo}

    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "pnid"},
                            "contacts": [{"profile": {"name": "Maria"}, "wa_id": WA}],
                            "messages": [
                                _msg(1, "button", "Parar Mensagem"),
                                _msg(2, "button", "Falar conosco"),
                                _msg(3, "text", "Parar"),
                                _msg(4, "text", "quero parar de pagar a mensalidade"),
                            ],
                            "statuses": [{"id": "wamid.X", "status": "read", "timestamp": "1"}],
                        }
                    }
                ]
            }
        ],
    }

    class _Req:
        headers: dict = {}

        async def body(self):
            return json.dumps(payload).encode()

        async def json(self):
            return payload

    r = _rodar(webhooks.whatsapp_cloud_webhook(_Req(), db=SimpleNamespace()))
    _rodar(asyncio.sleep(0))  # deixa as tarefas de fundo (falsas) terminarem
    assert [p["descadastro"] for p in pedidos] == [True, False, True, False]
    assert [p["descadastro_de_botao"] for p in pedidos] == [True, True, False, False]
    assert statuses_recebidos == [("pnid", [{"id": "wamid.X", "status": "read", "timestamp": "1"}])]
    assert {"statuses": 1, "gravados": 1} in r["processed"]


# ─── 10. A IA lê o modelo disparado; as métricas não o contam como humano ────


def test_historico_da_ia_inclui_o_disparo_como_fala_nossa(sessao):
    sessao.add(TaConversation(id=1, agent_id=26, connector_kind="whatsapp_cloud", external_id=WA, msg_count=3))
    sessao.add_all(
        [
            TaMessageLog(conversation_id=1, role="agent", content="MODELO", model_used="Disparo · retomada"),
            TaMessageLog(conversation_id=1, role="agent", content="resposta da secretaria pelo painel"),
            TaMessageLog(conversation_id=1, role="note", content="nota interna"),
            TaMessageLog(conversation_id=1, role="user", content="Falar conosco"),  # turno atual
        ]
    )
    sessao.commit()
    hist = _rodar(agent_runtime.load_history(_Db(sessao), 1))
    assert hist == [{"role": "assistant", "content": "MODELO"}]


def test_metricas_nao_contam_disparo_como_abordagem(sessao, monkeypatch):
    from services import metricas_atendimento as met

    agora = datetime.utcnow()
    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaAgent(id=26, tenant_id=17, nome="Cinthia")])
    sessao.add(
        TaConversation(
            id=1,
            agent_id=26,
            connector_kind="whatsapp_cloud",
            external_id=WA,
            msg_count=2,
            connector_id=56,
            started_at=agora - timedelta(hours=1),
        )
    )
    sessao.add_all(
        [
            TaMessageLog(
                conversation_id=1,
                role="agent",
                content="MODELO",
                model_used="Disparo · retomada",
                created_at=agora - timedelta(minutes=50),
            ),
            TaMessageLog(
                conversation_id=1, role="user", content="Falar conosco", created_at=agora - timedelta(minutes=40)
            ),
        ]
    )
    sessao.commit()

    async def _sem_numeros(*_a, **_k):
        return []

    monkeypatch.setattr("services.numeros.numeros_do_tenant", _sem_numeros)
    r = _rodar(met.calcular(_Db(sessao), 17, 7))
    assert r["totais"]["conversas"] == 1
    assert r["totais"]["abordagens"] == 0 and r["totais"]["atendimentos"] == 0
    assert met.e_disparo("agent", "Disparo · x") and not met.e_disparo("agent", None)
    assert not met.e_disparo("assistant", "Disparo · x")


# ─── 11. «parar» escrito só é descadastro depois de um modelo ────────────────


def _conversa_com(sessao, *linhas):
    sessao.add(TaConversation(id=1, agent_id=26, connector_kind="whatsapp_cloud", external_id=WA, msg_count=5))
    sessao.add_all([TaMessageLog(conversation_id=1, role=r, content=c, model_used=m) for r, c, m in linhas])
    sessao.commit()


@pytest.mark.parametrize(
    ("linhas", "esperado"),
    [
        # disparo do ERP e o contato respondeu «parar»
        ([("agent", "MODELO", "Disparo · retomada"), ("user", "parar", None)], True),
        # modelo do iniciar-conversa
        ([("agent", "MODELO", "Modelo · boas_vindas"), ("user", "parar", None)], True),
        # nota interna depois do disparo não é mensagem «nossa» para o contato
        ([("agent", "MODELO", "Disparo · retomada"), ("note", "ligar amanhã", None)], True),
        # a IA perguntou «quer continuar ou parar?» depois do disparo: conversa normal
        ([("agent", "MODELO", "Disparo · retomada"), ("assistant", "Quer continuar ou parar?", "gpt-4o")], False),
        # a secretaria respondeu pelo painel (sem marca): conversa normal
        ([("agent", "MODELO", "Disparo · retomada"), ("agent", "Oi, tudo bem?", None)], False),
        # nunca mandamos modelo
        ([("user", "oi", None), ("assistant", "Olá! Como posso ajudar?", "gpt-4o")], False),
        ([], False),
    ],
)
def test_ultima_nossa_foi_modelo(sessao, monkeypatch, linhas, esperado):
    async def _resolve(*_a, **_k):
        return SimpleNamespace(id=56, agent_id=26)

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    _conversa_com(sessao, *linhas)
    assert _rodar(disparo_oficial.ultima_nossa_foi_modelo(_Db(sessao), phone_number_id="1", from_id=WA)) is esperado


def test_ultima_nossa_foi_modelo_e_por_contato(sessao, monkeypatch):
    async def _resolve(*_a, **_k):
        return SimpleNamespace(id=56, agent_id=26)

    monkeypatch.setattr(agent_runtime, "resolve_connector_by_instance", _resolve)
    _conversa_com(sessao, ("agent", "MODELO", "Disparo · retomada"))
    assert not _rodar(
        disparo_oficial.ultima_nossa_foi_modelo(_Db(sessao), phone_number_id="1", from_id="5511900000000")
    )


# ─── 12. 131050: o contato parou de receber marketing → lista do tenant ──────


def test_131050_no_envio_entra_na_lista_e_o_proximo_da_409(rota):
    rota.impl.erro = ConnectorError(
        "Cloud API template 400", kind="whatsapp_cloud", status_code=400, meta_code=131050, detalhe="opted out"
    )
    with pytest.raises(HTTPException) as e:
        rota.enviar()
    assert e.value.status_code == 502 and e.value.detail["conta"] is False and e.value.detail["meta_code"] == 131050
    linha = rota.s.execute(select(TaWaDescadastro)).scalars().one()
    assert (linha.tenant_id, linha.chave, linha.texto, linha.connector_id) == (17, "1187654321", "Meta 131050", 56)
    rota.impl.erro = None
    with pytest.raises(HTTPException) as e:
        rota.enviar()
    assert e.value.status_code == 409 and len(rota.impl.enviados) == 1  # o segundo nem saiu


def test_outro_erro_do_contato_nao_entra_na_lista(rota):
    rota.impl.erro = ConnectorError(
        "x", kind="whatsapp_cloud", status_code=400, meta_code=131026, detalhe="sem WhatsApp"
    )
    with pytest.raises(HTTPException):
        rota.enviar()
    assert rota.s.execute(select(TaWaDescadastro)).first() is None


def test_131050_no_webhook_entra_na_lista(sessao, monkeypatch):
    db = _Db(sessao)

    async def _alvo(_db, _pnid):
        return (56, 17)

    monkeypatch.setattr(disparo_oficial, "conector_do_numero", _alvo)
    # sem recipient_id: o número sai do destino gravado no envio
    _rodar(
        disparo_oficial.registrar_status(db, wamid="wamid.C", status="accepted", tenant_id=17, destino="5521912345678")
    )
    statuses = [
        {"id": "wamid.A", "status": "failed", "recipient_id": WA, "errors": [{"code": 131050, "title": "opted out"}]},
        {"id": "wamid.B", "status": "failed", "recipient_id": "5511900000001", "errors": [{"code": 131026}]},
        {"id": "wamid.C", "status": "failed", "errors": [{"code": "131050"}]},
    ]
    assert _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid", statuses)) == 3
    lista = {(d.chave, d.texto) for d in sessao.execute(select(TaWaDescadastro)).scalars()}
    assert lista == {("1187654321", "Meta 131050"), ("2112345678", "Meta 131050")}  # 131026 ficou de fora


# ─── 13. Follow-up: WhatsApp oficial só dentro da janela de 24 h do contato ──


def _semear_followup(sessao, agora):
    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaAgent(id=26, tenant_id=17, nome="Cinthia")])
    convs = [
        # 1: aberta por disparo, o contato nunca escreveu
        (1, "whatsapp_cloud", [("agent", "MODELO", "Disparo · retomada", 3)]),
        # 2: o contato escreveu há 2 h
        (2, "whatsapp_cloud", [("user", "oi", None, 2), ("assistant", "Olá!", "gpt", 1.9)]),
        # 3: o contato escreveu há 30 h (a IA falou depois, mas a janela é do CONTATO)
        (3, "whatsapp_cloud", [("user", "oi", None, 30), ("assistant", "Olá!", "gpt", 1.6)]),
        # 4: WhatsApp por QR (Baileys): a regra não vale
        (4, "whatsapp", [("agent", "Oi, aqui é a secretaria", None, 3)]),
    ]
    for cid, kind, msgs in convs:
        sessao.add(
            TaConversation(
                id=cid,
                agent_id=26,
                connector_kind=kind,
                external_id=f"55119000000{cid:02d}",
                msg_count=len(msgs),
                status="active",
                last_message_at=agora - timedelta(minutes=90),
            )
        )
        sessao.add_all(
            [
                TaMessageLog(
                    conversation_id=cid, role=r, content=c, model_used=m, created_at=agora - timedelta(hours=h)
                )
                for r, c, m, h in msgs
            ]
        )
    sessao.commit()


def test_clausula_da_janela_do_whatsapp_oficial(sessao):
    import scheduler

    agora = datetime.utcnow()
    _semear_followup(sessao, agora)
    ids = sessao.execute(select(TaConversation.id).where(scheduler._janela_cloud_aberta(agora))).scalars().all()
    assert sorted(ids) == [2, 4]


@pytest.mark.parametrize("modo", ["legado", "cadencia"])
def test_followup_pula_conversa_do_oficial_sem_janela(sessao, monkeypatch, caplog, modo):
    import logging

    import scheduler

    # quarta-feira, 12h em São Paulo: dentro do horário comercial da cadência
    fixo = datetime(2026, 11, 11, 15, 0)

    class _Relogio(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixo.replace(tzinfo=scheduler.UTC).astimezone(tz) if tz else fixo

    monkeypatch.setattr(scheduler, "datetime", _Relogio)
    _semear_followup(sessao, fixo)
    params = [TaRuntimeParam(escopo="tenant", escopo_id=17, key="followup_enabled", value="true")]
    if modo == "legado":
        params.append(TaRuntimeParam(escopo="tenant", escopo_id=17, key="followup_hours", value="1"))
    else:
        cadencia = json.dumps([{"h": 1, "msg": "Oi {nome}"}])
        params.append(TaRuntimeParam(escopo="tenant", escopo_id=17, key="followup_cadence", value=cadencia))
    sessao.add_all(params)
    sessao.commit()
    enviados = []

    @asynccontextmanager
    async def _ctx():
        yield _Db(sessao)

    async def _envia(_db, conv, _texto):
        enviados.append(conv.id)
        return True

    async def _sim(*_a, **_k):
        return True

    monkeypatch.setattr(scheduler, "db_context", _ctx)
    monkeypatch.setattr(scheduler, "_send_proactive", _envia)
    monkeypatch.setattr(scheduler, "_no_horario_da_ia", _sim)
    monkeypatch.setattr(scheduler, "_cascatas_ligadas", lambda _t: False)

    with caplog.at_level(logging.INFO, logger="tier-agent.scheduler"):
        _rodar(scheduler.followup_inactivity_job())
    assert sorted(enviados) == [2, 4]  # 1 (disparo sem resposta) e 3 (janela de 30 h) ficaram de fora
    assert any("2 conversa(s) do WhatsApp oficial" in r.getMessage() for r in caplog.records)

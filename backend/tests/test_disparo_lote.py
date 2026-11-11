"""Página «Disparos» — disparo em lote pelo WhatsApp oficial, pela tela do Agent (11/11/2026).

Cobre: leitura da lista colada (formatos, duplicado pelo 9º dígito, linhas inválidas, nome),
variáveis (primeiro nome × texto fixo × «sem nome»), o que o disparo daqui consegue mandar
(bloqueio do modelo), a reserva atômica (vez do disparo + contato), o envio preso que volta, as
pausas automáticas (erro do número e taxa de falha, com a falha tardia do webhook entrando na
conta), o descadastro, o ciclo de status e quem vê / quem mexe.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()`: o `run` fecha o laço
global e quebra os testes vizinhos que usam o mesmo padrão.
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
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from core.auth import CurrentUser, create_token  # noqa: E402
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
from services import agent_runtime, disparo_lote, disparo_oficial  # noqa: E402
from services import registro_atividade as ra  # noqa: E402
from services.connectors.base import ConnectorError  # noqa: E402

MODELO_META = {
    "id": "1",
    "name": "convite_visita",
    "language": "pt_BR",
    "status": "APPROVED",
    "category": "MARKETING",
    "components": [
        {"type": "BODY", "text": "Olá {{1}}, a visita ao CCDA é {{2}}. Podemos confirmar?"},
        {"type": "FOOTER", "text": "CCDA Diadema"},
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Parar Mensagem"}]},
    ],
}
VARS = [{"fonte": "nome"}, {"fonte": "fixo", "valor": "sábado às 9h"}]


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


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[m.__table__ for m in TABELAS])
    with Session(motor, expire_on_commit=False) as s:
        s.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaTenant(id=3, nome="Out", email="o@o")])
        s.add_all([TaAgent(id=26, tenant_id=17, nome="Cinthia"), TaAgent(id=2, tenant_id=3, nome="Maria")])
        s.flush()
        s.add_all(
            [
                TaConnector(id=56, agent_id=26, kind="whatsapp_cloud", config_json_enc="x"),
                TaConnector(id=57, agent_id=26, kind="whatsapp_cloud", config_json_enc="x"),
                TaConnector(id=9, agent_id=2, kind="whatsapp_cloud", config_json_enc="x"),
            ]
        )
        s.commit()
        yield s
    motor.dispose()


@pytest.fixture(autouse=True)
def _limpa_caches():
    disparo_oficial._cache_modelos.clear()
    disparo_oficial._cache_numeros.clear()
    disparo_oficial._lista_buscada_ate.clear()
    yield


class _Impl:
    """A Cloud API de mentira: guarda o que foi enviado e devolve wamids diferentes."""

    def __init__(self):
        self.enviados = []
        self.erros = []  # um por chamada; None = sucesso

    async def send_template(self, cfg, to, nome, lang, comps):
        self.enviados.append((to, nome, lang, comps))
        erro = self.erros.pop(0) if self.erros else None
        if erro:
            raise erro
        n = len(self.enviados)
        return {"contacts": [{"input": to, "wa_id": to}], "messages": [{"id": f"wamid.{n}"}]}


@pytest.fixture
def worker(monkeypatch, sessao):
    """O worker com a Meta trocada pela `_Impl` e o número decifrado."""
    from services.connectors.registry import registry

    impl = _Impl()
    monkeypatch.setattr(registry, "get", lambda _k: impl)
    monkeypatch.setattr("core.encryption.decrypt", lambda _x: json.dumps({"phone_number_id": "1", "token": "t"}))
    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    db = _Db(sessao)
    relogio = {"t": datetime.utcnow()}

    def criar(lista, variaveis=VARS, **kw):
        return _rodar(
            disparo_lote.criar(
                db, tenant_id=17, connector_id=56, modelo_meta=MODELO_META, variaveis=variaveis, lista=lista, **kw
            )
        )

    def passo(did):
        # Cada passo 1 min depois do anterior: a VEZ (intervalo de segundos) já venceu.
        relogio["t"] += timedelta(minutes=1)
        return _rodar(disparo_lote.processar_um(db, did, agora=relogio["t"]))

    return SimpleNamespace(db=db, s=sessao, impl=impl, criar=criar, passo=passo, relogio=relogio)


def _envios(s, did):
    q = select(TaDisparoOficialEnvio).where(TaDisparoOficialEnvio.disparo_id == did).order_by(TaDisparoOficialEnvio.id)
    return s.execute(q.execution_options(populate_existing=True)).scalars().all()


def _lista(n, com_nome=True, inicio=0):
    return "\n".join(
        f"{'Pessoa' + str(i) + ' ' if com_nome else ''}11 9{i:04d}-{i:04d}" for i in range(inicio, inicio + n)
    )


# ─── 1. Leitura da lista ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("linha", "numero", "nome"),
    [
        ("Maria Silva 11 98765-4321", "5511987654321", "Maria Silva"),
        ("Maria Silva\t11987654321\t12/05/1990", "5511987654321", "Maria Silva"),
        ("11987654321", "5511987654321", None),
        ("+55 (11) 98765-4321", "5511987654321", None),
        ("João;(11) 3456-7890;joao@ccda.com.br", "551134567890", "João"),
        ("Maria 10/11/2026 11987654321", "5511987654321", "Maria"),  # a data não gruda no telefone
        ("Maria 2026 11987654321", "5511987654321", "Maria"),  # o ano também não
        ("0 11 98765-4321", "5511987654321", None),  # 0 de interurbano
        ("MARIA DA SILVA, 21 99999 8888", "5521999998888", "MARIA DA SILVA"),
        ("Maria:11987654321", "5511987654321", "Maria"),
        ("+1 555 123 4567", "15551234567", None),  # outro país só com «+»
    ],
)
def test_le_cada_formato_de_linha(linha, numero, nome):
    assert disparo_lote.ler_linha(linha)[:2] == (numero, nome)


@pytest.mark.parametrize(
    ("linha", "motivo"),
    [("Nome;Telefone", "sem número"), ("98765-4321", "número inválido"), ("202611987654321", "número inválido")],
)
def test_linha_invalida_diz_por_que(linha, motivo):
    assert disparo_lote.ler_linha(linha) == (None, None, motivo)


def test_lista_remove_duplicado_pelo_nono_digito_e_aproveita_o_nome():
    leitura = disparo_lote.ler_lista("11987654321\nMaria 551187654321\n\nJoão 11 98765-4321\nx\n21 99999-8888")
    assert [(c.numero, c.nome) for c in leitura.contatos] == [("5511987654321", "Maria"), ("5521999998888", None)]
    assert leitura.duplicados == 2
    assert leitura.invalidas == [{"linha": 5, "texto": "x", "motivo": "sem número"}]


@pytest.mark.parametrize(
    ("nome", "primeiro"),
    [
        ("MARIA DA SILVA", "Maria"),
        ("dr joão pereira", "João"),
        ("ana-maria souza", "Ana-Maria"),
        ("Íris", "Íris"),
        (None, None),
        ("J", None),
    ],
)
def test_primeiro_nome(nome, primeiro):
    assert disparo_lote.primeiro_nome(nome) == primeiro


# ─── 2. Variáveis ──────────────────────────────────────────────────────────────


def test_variaveis_nome_e_fixo():
    assert disparo_lote.valores_do_contato(VARS, "MARIA silva") == ["Maria", "sábado às 9h"]
    assert disparo_lote.componentes(["Maria", "sábado às 9h"]) == [
        {"type": "body", "parameters": [{"type": "text", "text": "Maria"}, {"type": "text", "text": "sábado às 9h"}]}
    ]
    assert disparo_lote.componentes([]) is None


def test_sem_nome_na_lista_e_variavel_de_nome_nao_inventa():
    assert disparo_lote.valores_do_contato(VARS, None) is None
    assert disparo_lote.valores_do_contato([{"fonte": "fixo", "valor": "oi"}], None) == ["oi"]


@pytest.mark.parametrize(
    ("variaveis", "quantas", "trecho"),
    [
        ([{"fonte": "nome"}], 2, "2 variáveis"),
        ([{"fonte": "nome"}, {"fonte": "fixo", "valor": "  "}], 2, "escreva o texto fixo"),
        ([{"fonte": "fixo", "valor": "linha 1\nlinha 2"}], 1, "quebra de linha"),
        ([{"fonte": "planilha"}], 1, "primeiro nome da lista"),
    ],
)
def test_variaveis_invalidas(variaveis, quantas, trecho):
    with pytest.raises(ValueError) as e:
        disparo_lote.validar_variaveis(variaveis, quantas)
    assert trecho in str(e.value)


# ─── 3. O que o disparo daqui consegue mandar ──────────────────────────────────


def _modelo(*comps, status="APPROVED", category="MARKETING"):
    return {"name": "m", "language": "pt_BR", "status": status, "category": category, "components": list(comps)}


@pytest.mark.parametrize(
    ("modelo", "trecho"),
    [
        (_modelo({"type": "BODY", "text": "oi"}, status="PENDING"), "Em análise"),
        (_modelo({"type": "BODY", "text": "seu código"}, category="AUTHENTICATION"), "autenticação"),
        (_modelo({"type": "HEADER", "format": "IMAGE"}, {"type": "BODY", "text": "oi"}), "imagem"),
        (_modelo({"type": "HEADER", "format": "TEXT", "text": "Oi {{1}}"}, {"type": "BODY", "text": "x"}), "título"),
        (_modelo({"type": "BODY", "text": "Olá {{nome}}, tudo bem?"}), "por nome"),
        (
            _modelo(
                {"type": "BODY", "text": "oi"},
                {"type": "BUTTONS", "buttons": [{"type": "URL", "url": "https://x/{{1}}"}]},
            ),
            "link variável",
        ),
        (_modelo({"type": "BODY", "text": "oi"}, {"type": "BUTTONS", "buttons": [{"type": "COPY_CODE"}]}), "COPY_CODE"),
        (_modelo({"type": "CAROUSEL", "cards": []}), "carousel"),
    ],
)
def test_modelo_que_o_disparo_nao_manda(modelo, trecho):
    assert trecho in (disparo_lote.bloqueio_do_modelo(modelo) or "")


def test_modelo_que_o_disparo_manda():
    assert disparo_lote.bloqueio_do_modelo(MODELO_META) is None
    estatico = _modelo(
        {"type": "HEADER", "format": "TEXT", "text": "Convite"},
        {"type": "BODY", "text": "Olá {{1}}!"},
        {"type": "BUTTONS", "buttons": [{"type": "URL", "url": "https://ccda.com.br"}, {"type": "PHONE_NUMBER"}]},
    )
    assert disparo_lote.bloqueio_do_modelo(estatico) is None


# ─── 4. Criar: rascunho, sem nome, descadastrado, limites ──────────────────────


def test_criar_nasce_rascunho_com_um_envio_por_contato(worker):
    _rodar(
        disparo_oficial.registrar_descadastro(
            worker.db, tenant_id=17, connector_id=56, numero="5521999998888", texto="Parar"
        )
    )
    d = worker.criar("Maria Silva 11 98765-4321\n11 91234-5678\nJoão 21 99999-8888", nome="Visita de sábado")
    assert (d.status, d.total, d.nome, d.modelo, d.categoria) == (
        "rascunho",
        3,
        "Visita de sábado",
        "convite_visita",
        "MARKETING",
    )
    assert d.intervalo_ms == 8000 and d.variacao_ms == 2000
    estados = {e.numero: (e.status, e.nome) for e in _envios(worker.s, d.id)}
    assert estados == {
        "5511987654321": ("pendente", "Maria Silva"),
        "5511912345678": ("sem_nome", None),  # o modelo usa o nome e a linha não trouxe
        "5521999998888": ("descadastrado", "João"),  # pediu para parar antes
    }
    assert worker.impl.enviados == []  # nada sai antes de iniciar


@pytest.mark.parametrize(
    ("kw", "trecho"),
    [
        ({"lista": "abc\nNome;Telefone"}, "nenhum número válido"),
        ({"lista": _lista(5001)}, "limite por disparo é 5.000"),
        ({"lista": "11987654321", "intervalo_s": 1}, "mínimo"),
        ({"lista": "11987654321", "agendar_para": datetime.utcnow() - timedelta(hours=1)}, "já passou"),
        ({"lista": "11987654321", "variaveis": [{"fonte": "nome"}]}, "2 variáveis"),
    ],
)
def test_criar_recusa(worker, kw, trecho):
    with pytest.raises(disparo_lote.ErroDoDisparo) as e:
        worker.criar(**kw)
    assert trecho in str(e.value)
    assert worker.s.execute(select(TaDisparoOficial)).first() is None


def test_criar_recusa_modelo_que_nao_manda(worker):
    with pytest.raises(disparo_lote.ErroDoDisparo):
        _rodar(
            disparo_lote.criar(
                worker.db,
                tenant_id=17,
                connector_id=56,
                modelo_meta=_modelo({"type": "HEADER", "format": "VIDEO"}, {"type": "BODY", "text": "x"}),
                variaveis=[],
                lista="11987654321",
            )
        )


# ─── 5. Reserva atômica e envio preso ──────────────────────────────────────────


def test_vez_do_disparo_so_um_processo_ganha(worker):
    d = worker.criar(_lista(3))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    agora = datetime.utcnow()
    assert _rodar(disparo_lote.reservar_vez(worker.db, d.id, agora)) is True
    assert _rodar(disparo_lote.reservar_vez(worker.db, d.id, agora)) is False  # o 2º processo não passa
    assert (
        _rodar(disparo_lote.reservar_vez(worker.db, d.id, agora + timedelta(minutes=4))) is True
    )  # processo morto libera


def test_reserva_do_contato_nunca_pega_o_mesmo(worker):
    d = worker.criar(_lista(3))
    agora = datetime.utcnow()
    a = _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora))
    b = _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora))
    c = _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora))
    assert len({a.id, b.id, c.id}) == 3 and a.status == "enviando" and a.tentativas == 1
    assert _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora)) is None


def test_envio_preso_volta_em_10_min_e_vira_falha_na_terceira(worker):
    d = worker.criar(_lista(1))
    agora = datetime.utcnow()
    e = _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora))
    assert _rodar(disparo_lote.devolver_travados(worker.db, d.id, agora + timedelta(minutes=9))) == 0
    assert _rodar(disparo_lote.devolver_travados(worker.db, d.id, agora + timedelta(minutes=11))) == 1
    worker.s.refresh(e)
    assert e.status == "pendente"
    for _ in range(2):
        _rodar(disparo_lote.reservar_envio(worker.db, d.id, agora))
        _rodar(disparo_lote.devolver_travados(worker.db, d.id, agora + timedelta(minutes=11)))
    worker.s.refresh(e)
    assert (e.status, e.tentativas) == ("falhou", 3) and "interrompido 3 vezes" in e.erro


# ─── 6. O worker: envio, conversa, status ──────────────────────────────────────


def test_envio_entra_na_conversa_com_status_e_ritmo(worker):
    d = worker.criar("Maria Silva 11 98765-4321\nJoão 11 91234-5678")
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    assert worker.passo(d.id) == "enviado"
    to, nome, lang, comps = worker.impl.enviados[0]
    assert (to, nome, lang) == ("5511987654321", "convite_visita", "pt_BR")
    assert comps[0]["parameters"] == [{"type": "text", "text": "Maria"}, {"type": "text", "text": "sábado às 9h"}]
    e = _envios(worker.s, d.id)[0]
    assert (e.status, e.wamid, e.tentativas) == ("enviado", "wamid.1", 1) and e.conversation_id
    conv = worker.s.get(TaConversation, e.conversation_id)
    assert (conv.connector_id, conv.contact_name) == (56, "Maria Silva")  # o nome da lista entra na conversa
    msg = worker.s.execute(select(TaMessageLog).where(TaMessageLog.conversation_id == conv.id)).scalars().one()
    assert msg.content.startswith("Olá Maria, a visita ao CCDA é sábado às 9h.")
    assert msg.model_used == "Disparo · convite_visita" and msg.member_id is None
    assert worker.s.execute(select(TaWaEnvioStatus.status)).scalar() == "accepted"
    # A vez foi devolvida com o ritmo (8 s ± 2 s), não liberada na hora.
    worker.s.refresh(worker.s.get(TaDisparoOficial, d.id))
    prox = worker.s.get(TaDisparoOficial, d.id).proximo_envio_em
    assert timedelta(seconds=5) < prox - datetime.utcnow() < timedelta(seconds=11)
    assert worker.passo(d.id) == "enviado"  # o último: o disparo conclui no mesmo passo
    assert worker.s.get(TaDisparoOficial, d.id, populate_existing=True).status == "concluido"
    assert worker.passo(d.id) == "nao_e_a_vez" and len(worker.impl.enviados) == 2


def test_descadastro_depois_de_criado_e_pulado_sem_chamar_a_meta(worker):
    d = worker.criar("Maria 11 98765-4321")
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    _rodar(
        disparo_oficial.registrar_descadastro(
            worker.db, tenant_id=17, connector_id=56, numero="551187654321", texto="Sair"
        )
    )
    assert worker.passo(d.id) == "descadastrado"
    assert worker.impl.enviados == []
    assert worker.s.get(TaDisparoOficial, d.id, populate_existing=True).status == "concluido"


def test_131050_vira_descadastrado_e_entra_na_lista(worker):
    d = worker.criar("Maria 11 98765-4321")
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    worker.impl.erros = [
        ConnectorError("x", kind="whatsapp_cloud", status_code=400, meta_code=131050, detalhe="opted out")
    ]
    assert worker.passo(d.id) == "descadastrado"
    assert worker.s.execute(select(TaWaDescadastro.chave)).scalar() == "1187654321"


def test_erro_do_numero_pausa_e_o_contato_volta_para_a_fila(worker):
    d = worker.criar(_lista(3))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    worker.impl.erros = [
        ConnectorError("x", kind="whatsapp_cloud", status_code=400, meta_code=131048, detalhe="spam rate limit")
    ]
    assert worker.passo(d.id) == "pausou_conta"
    disp = worker.s.get(TaDisparoOficial, d.id, populate_existing=True)
    assert disp.status == "pausado" and "spam rate limit (código 131048)" in disp.motivo_pausa
    primeiro = _envios(worker.s, d.id)[0]
    assert (primeiro.status, primeiro.tentativas) == ("pendente", 0)  # não gastou tentativa
    assert worker.passo(d.id) == "nao_e_a_vez" and len(worker.impl.enviados) == 1  # pausado não envia
    _rodar(disparo_lote.retomar(worker.db, d.id))
    worker.relogio["t"] += timedelta(minutes=5)  # a vez presa venceu
    assert worker.passo(d.id) == "enviado"


def test_erro_do_contato_falha_so_ele(worker):
    d = worker.criar(_lista(2))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    worker.impl.erros = [
        ConnectorError("x", kind="whatsapp_cloud", status_code=400, meta_code=131026, detalhe="sem WhatsApp")
    ]
    assert worker.passo(d.id) == "falhou"
    assert worker.passo(d.id) == "enviado"
    e = _envios(worker.s, d.id)[0]
    assert (e.status, e.erro_codigo, e.erro) == ("falhou", 131026, "sem WhatsApp (código 131026)")


def test_numero_desconectado_pausa_sem_queimar_a_lista(worker):
    d = worker.criar(_lista(2))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    worker.s.get(TaConnector, 56).enabled = False
    worker.s.commit()
    assert worker.passo(d.id) == "pausou_numero"
    assert worker.impl.enviados == []
    assert "desconectado" in worker.s.get(TaDisparoOficial, d.id, populate_existing=True).motivo_pausa
    assert {e.status for e in _envios(worker.s, d.id)} == {"pendente"}


def _erro_contato():
    return ConnectorError("x", kind="whatsapp_cloud", status_code=400, meta_code=131026, detalhe="sem WhatsApp")


def test_pausa_por_taxa_so_depois_de_20(worker):
    d = worker.criar(_lista(25))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    worker.impl.erros = [None] * 14 + [_erro_contato()] * 6 + [_erro_contato()]
    for _ in range(20):
        worker.passo(d.id)
    disp = worker.s.get(TaDisparoOficial, d.id, populate_existing=True)
    assert disp.status == "em_andamento"  # 6 de 20 = 30 %: no limite, segue
    worker.passo(d.id)
    disp = worker.s.get(TaDisparoOficial, d.id, populate_existing=True)
    assert disp.status == "pausado" and disp.motivo_pausa.startswith("Muitas falhas (7 de 21)")
    # Retomar zera a régua: as falhas antigas não pausam de novo no próximo envio.
    _rodar(disparo_lote.retomar(worker.db, d.id))
    assert worker.passo(d.id) == "enviado"
    assert worker.s.get(TaDisparoOficial, d.id, populate_existing=True).status == "em_andamento"


def test_falha_tardia_do_webhook_conta_na_taxa_e_nas_contagens(worker):
    d = worker.criar(_lista(21))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    for _ in range(20):
        assert worker.passo(d.id) == "enviado"
    # A Meta aceitou e depois não entregou 7 deles; 5 entregues, 3 lidos.
    for i in range(1, 8):
        _rodar(
            disparo_oficial.registrar_status(
                worker.db, wamid=f"wamid.{i}", status="failed", erro="Undeliverable", erro_codigo=131026
            )
        )
    for i in range(8, 13):
        _rodar(disparo_oficial.registrar_status(worker.db, wamid=f"wamid.{i}", status="delivered"))
    for i in range(13, 16):
        _rodar(disparo_oficial.registrar_status(worker.db, wamid=f"wamid.{i}", status="read"))
    c = _rodar(disparo_lote.contagens(worker.db, [d.id]))[d.id]
    assert (c["enviados"], c["entregues"], c["lidos"], c["falhas"], c["pendentes"]) == (13, 8, 3, 7, 1)
    assert worker.passo(d.id) == "enviado"  # o 21º sai e a taxa (7 de 21) pausa
    assert worker.s.get(TaDisparoOficial, d.id, populate_existing=True).status == "pausado"


# ─── 7. Ciclo de status ────────────────────────────────────────────────────────


def test_ciclo_iniciar_pausar_retomar_cancelar(worker):
    d = worker.criar(_lista(4))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    with pytest.raises(disparo_lote.ErroDoDisparo):
        _rodar(disparo_lote.iniciar(worker.db, d.id))  # já começou
    with pytest.raises(disparo_lote.ErroDoDisparo):
        _rodar(disparo_lote.retomar(worker.db, d.id))  # não está pausado
    assert worker.passo(d.id) == "enviado"
    _rodar(disparo_lote.pausar(worker.db, d.id, quem="Augusto"))
    disp = worker.s.get(TaDisparoOficial, d.id, populate_existing=True)
    assert (disp.status, disp.motivo_pausa) == ("pausado", "Pausado por Augusto")
    _rodar(disparo_lote.retomar(worker.db, d.id))
    _rodar(disparo_lote.cancelar(worker.db, d.id))
    _rodar(disparo_lote.cancelar(worker.db, d.id))  # idempotente
    assert worker.s.get(TaDisparoOficial, d.id, populate_existing=True).status == "cancelado"
    assert sorted(e.status for e in _envios(worker.s, d.id)) == ["cancelado"] * 3 + ["enviado"]
    assert worker.passo(d.id) == "nao_e_a_vez"
    with pytest.raises(disparo_lote.ErroDoDisparo):
        _rodar(disparo_lote.excluir_rascunho(worker.db, d.id))  # iniciado fica no histórico


def test_agendado_so_comeca_na_hora(worker):
    quando = datetime.utcnow() + timedelta(hours=2)
    d = worker.criar(_lista(1), agendar_para=quando)
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    assert worker.passo(d.id) == "nao_e_a_vez"  # 1 min depois: ainda não
    worker.relogio["t"] = quando
    assert worker.passo(d.id) == "enviado"


def test_iniciar_sem_ninguem_para_enviar(worker):
    d = worker.criar("11 98765-4321")  # sem nome e o modelo usa o nome
    with pytest.raises(disparo_lote.ErroDoDisparo) as e:
        _rodar(disparo_lote.iniciar(worker.db, d.id))
    assert e.value.http == 409
    _rodar(disparo_lote.excluir_rascunho(worker.db, d.id))
    assert worker.s.execute(select(TaDisparoOficialEnvio)).first() is None


def test_cancelado_no_meio_o_contato_reservado_nao_sai(worker, monkeypatch):
    d = worker.criar(_lista(2))
    _rodar(disparo_lote.iniciar(worker.db, d.id))
    reservar = disparo_lote.reservar_envio

    async def _reserva_e_cancela(db, did, agora):
        envio = await reservar(db, did, agora)
        await disparo_lote.cancelar(db, did)  # alguém cancelou entre a vez e o contato
        return envio

    monkeypatch.setattr(disparo_lote, "reservar_envio", _reserva_e_cancela)
    assert worker.passo(d.id) == "parou_no_meio"
    assert worker.impl.enviados == []
    assert {e.status for e in _envios(worker.s, d.id)} == {"cancelado"}


# ─── 8. Quem vê, quem mexe (rotas) ─────────────────────────────────────────────


def _dono():
    return CurrentUser(1, "dono@ccda", tenant_id=17, role="owner")


def _atendente(member_id=7):
    return CurrentUser(1, "nathalia@ccda", tenant_id=17, member_id=member_id, member_name="Nathalia", role="atendente")


@pytest.fixture
def rotas(worker, monkeypatch):
    from routes import disparos_oficiais as r
    from services import visao_conversas

    async def _meus(_db, _t, member_id):
        return [57] if member_id == 7 else []

    monkeypatch.setattr(visao_conversas, "conectores_do_membro", _meus)
    monkeypatch.setattr(r, "decrypt", lambda _x: json.dumps({"phone": "5511923362467"}))

    async def _numero(db, connector_id, user, *, gestor=False):
        if gestor:
            visao_conversas.exigir_gestor(user, "x")
        conn = worker.s.get(TaConnector, connector_id)
        return conn, worker.s.get(TaAgent, conn.agent_id), {"waba_id": "w", "token": "t"}

    async def _modelos(_cfg):
        return [MODELO_META, {**MODELO_META, "name": "rascunho_meta", "status": "PENDING"}]

    monkeypatch.setattr(r, "_numero", _numero)
    monkeypatch.setattr(r, "_modelos_da_meta", _modelos)
    req = SimpleNamespace(state=SimpleNamespace())
    return SimpleNamespace(r=r, req=req, **vars(worker))


def test_rota_criar_iniciar_e_ver_contato_a_contato(rotas):
    r, db = rotas.r, rotas.db
    body = r.CriarIn(
        connector_id=56,
        modelo="convite_visita",
        variaveis=[r.VariavelIn(fonte="nome"), r.VariavelIn(fonte="fixo", valor="sábado às 9h")],
        lista="Maria 11 98765-4321\n11 91234-5678\nNome;Telefone",
    )
    out = _rodar(r.criar(body, rotas.req, _dono(), db))
    assert (out["status"], out["total"], out["telefone"], out["agente"]) == ("rascunho", 2, "5511923362467", "Cinthia")
    assert out["contagens"]["pendentes"] == 1 and out["contagens"]["sem_nome"] == 1
    assert rotas.req.state.atividade["alvo"].startswith(f"disparo #{out['id']} · modelo convite_visita · 2 contatos")
    out = _rodar(r.iniciar(out["id"], rotas.req, _dono(), db))
    assert out["status"] == "em_andamento"
    rotas.passo(out["id"])
    so_sem_nome = _rodar(r.envios(out["id"], _dono(), db, situacao="sem_nome", busca=None, offset=0, limite=100))
    assert so_sem_nome["total"] == 1 and so_sem_nome["envios"][0]["motivo"] == disparo_lote.MOTIVO_SEM_NOME
    _rodar(disparo_oficial.registrar_status(db, wamid="wamid.1", status="read"))
    lidos = _rodar(r.envios(out["id"], _dono(), db, situacao="lido", busca="maria", offset=0, limite=100))
    assert [e["numero"] for e in lidos["envios"]] == ["5511987654321"] and lidos["envios"][0]["conversation_id"]


def test_rota_modelos_so_aprovados_com_o_motivo(rotas):
    out = _rodar(rotas.r.modelos(_dono(), rotas.db, connector_id=56))
    assert [(m["nome"], m["bloqueio"]) for m in out["modelos"]] == [("convite_visita", None)]


def test_ler_lista_conta_e_marca_descadastrado(rotas):
    _rodar(
        disparo_oficial.registrar_descadastro(rotas.db, tenant_id=17, connector_id=56, numero="11912345678", texto="x")
    )
    r = rotas.r
    out = _rodar(
        r.ler_lista(r.LerListaIn(texto="Maria 11 98765-4321\n11 91234-5678\n11987654321\nabc"), _dono(), rotas.db)
    )
    assert (out["validos"], out["duplicados"], out["total_invalidas"], out["com_nome"], out["descadastrados"]) == (
        2,
        1,
        1,
        1,
        1,
    )
    assert out["descadastrados_sem_nome"] == 1  # o 11 91234-5678 está nas duas situações
    assert out["amostra"][0] == {
        "numero": "5511987654321",
        "nome": "Maria",
        "primeiro_nome": "Maria",
        "descadastrado": False,
    }


def test_atendente_ve_so_os_do_numero_dele_e_nao_mexe(rotas):
    r, db = rotas.r, rotas.db
    meu = _rodar(
        disparo_lote.criar(db, tenant_id=17, connector_id=57, modelo_meta=MODELO_META, variaveis=VARS, lista=_lista(1))
    )
    outro = rotas.criar(_lista(1))  # número 56, de outra pessoa
    alheio = _rodar(
        disparo_lote.criar(db, tenant_id=3, connector_id=9, modelo_meta=MODELO_META, variaveis=VARS, lista=_lista(1))
    )
    assert [d["id"] for d in _rodar(r.listar(_atendente(), db, limite=100))["disparos"]] == [meu.id]
    assert {d["id"] for d in _rodar(r.listar(_dono(), db, limite=100))["disparos"]} == {
        meu.id,
        outro.id,
    }  # sem o de outro tenant
    assert _rodar(r.detalhe(meu.id, _atendente(), db))["id"] == meu.id
    for did in (outro.id, alheio.id):
        with pytest.raises(HTTPException) as e:
            _rodar(r.detalhe(did, _atendente(), db))
        assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        _rodar(r.detalhe(alheio.id, _dono(), db))  # dono de outro tenant também não
    assert e.value.status_code == 404
    for acao in (r.iniciar, r.pausar, r.retomar, r.cancelar):
        with pytest.raises(HTTPException) as e:
            _rodar(acao(meu.id, rotas.req, _atendente(), db))
        assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _rodar(r.ler_lista(r.LerListaIn(texto="11987654321"), _atendente(), db))
    assert e.value.status_code == 403
    assert _rodar(r.listar(_atendente(member_id=99), db, limite=100)) == {"disparos": [], "pode_criar": False}


# ─── 9. Registro de atividades ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("metodo", "rota", "esperado"),
    [
        ("POST", "/disparos-oficiais", "Criou disparo (oficial)"),
        ("POST", "/disparos-oficiais/12/iniciar", "Iniciou disparo (oficial)"),
        ("POST", "/disparos-oficiais/12/pausar", "Pausou disparo (oficial)"),
        ("POST", "/disparos-oficiais/12/retomar", "Retomou disparo (oficial)"),
        ("POST", "/disparos-oficiais/12/cancelar", "Cancelou disparo (oficial)"),
        ("DELETE", "/disparos-oficiais/12", "Apagou rascunho de disparo (oficial)"),
    ],
)
def test_rotulo_das_acoes_do_disparo(metodo, rota, esperado):
    assert ra.rotulo(metodo, rota) == esperado
    assert ra.recurso_e_id(rota)[0] == "disparo"


def test_previa_da_lista_nao_entra_no_registro_e_iniciar_entra(monkeypatch):
    eventos: list[dict] = []
    monkeypatch.setattr(ra, "registrar", lambda ev: eventos.append(ev))
    app = FastAPI()
    app.add_middleware(ra.RegistroDeAtividade)

    @app.post("/api/v1/disparos-oficiais/ler-lista")
    async def previa():
        return {"validos": 1}

    @app.post("/api/v1/disparos-oficiais/{did}/iniciar")
    async def comecar(did: int, request: Request):
        request.state.atividade = {"alvo": f"disparo #{did} · Visita"}
        return {"ok": True}

    cli = TestClient(app)
    tok = create_token("17", {"tenant_id": 17, "email": "augusto@ccda.com.br", "role": "owner"})
    h = {"Authorization": f"Bearer {tok}"}
    cli.post("/api/v1/disparos-oficiais/ler-lista", json={"texto": "11987654321"}, headers=h)
    assert eventos == []
    cli.post("/api/v1/disparos-oficiais/12/iniciar", headers=h)
    assert [(e["acao"], e["alvo"]) for e in eventos] == [("Iniciou disparo (oficial)", "disparo #12 · Visita")]

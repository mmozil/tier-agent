"""Relatório «WhatsApp oficial» — cobrança da Meta por mensagem (12/11/2026).

Cobre: o `pricing` do webhook de status gravado (payloads da doc oficial), sem regredir o status e
sem apagar o que já veio; as agregações (pagas × grátis, por tipo e categoria, funil, motivos de
falha, chegadas por anúncio, franquia de serviço do mês); o custo estimado só das pagas para +55;
o isolamento por tenant e o filtro de número; e o número da própria Meta (`pricing_analytics`) com
cache e falha que não derruba a tela.

Payloads — doc oficial da Meta, lida em 11/11/2026:
- status: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
  (exemplos «marketing message successfully sent», «v24.0 sent» e «failed»)
- pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
  (blocos «Service message in the free monthly tier», «Service message that is charged» e paid_exempt)
- analytics: https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#pricing-analytics
  (resposta de exemplo do `pricing_analytics`)
- referral: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
  (exemplo «Click to WhatsApp ad»)

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()`.
"""

import asyncio
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, require_gestor
from core.db import Base
from models import (
    TaAgent,
    TaConnector,
    TaConversation,
    TaMessageLog,
    TaTenant,
    TaWaEnvioStatus,
    TaWebhookEvent,
)
from services import disparo_oficial
from services import relatorio_whatsapp_oficial as rel


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _Db:
    """AsyncSession de mentira sobre SQLite em memória (mesmo molde de test_disparo_oficial)."""

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

    async def get(self, modelo, id_):
        return self.s.get(modelo, id_)


TABELAS = [TaTenant, TaAgent, TaConnector, TaConversation, TaMessageLog, TaWaEnvioStatus, TaWebhookEvent]


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[m.__table__ for m in TABELAS])
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


@pytest.fixture(autouse=True)
def _limpa_caches():
    disparo_oficial._cache_numeros.clear()
    rel._cache_meta.clear()
    yield
    disparo_oficial._cache_numeros.clear()
    rel._cache_meta.clear()


# ─── payloads da doc ─────────────────────────────────────────────────────────

# «This example webhook describes a marketing message that has been successfully sent» (status doc).
DOC_MARKETING_SENT = {
    "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
    "status": "sent",
    "timestamp": "1750030073",
    "recipient_id": "16505551234",
    "recipient_user_id": "US.13491208655302741918",
    "conversation": {
        "id": "72b14d6bd5407799e66f64d1b338e567",
        "expiration_timestamp": "1750116480",
        "origin": {"type": "marketing"},
    },
    "pricing": {"billable": True, "pricing_model": "PMP", "type": "regular", "category": "marketing"},
}
# «This example v24.0 webhook … the pricing object is omitted because it happened to be displayed in
# an associated delivered status messages webhook» (status doc).
DOC_V24_SENT_SEM_PRICING = {
    "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
    "status": "sent",
    "timestamp": "1750030073",
    "recipient_id": "16505551234",
}
# «This example describes a message that failed to be sent» (status doc) — sem `pricing`.
DOC_FAILED = {
    "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI0QUQ2MjA4NEYyRkExNjMyREUA",
    "status": "failed",
    "timestamp": "1751142888",
    "recipient_id": "16505551234",
    "errors": [
        {
            "code": 131049,
            "title": "This message was not delivered to maintain healthy ecosystem engagement.",
            "message": "This message was not delivered to maintain healthy ecosystem engagement.",
            "error_data": {
                "details": "In order to maintain a healthy ecosystem engagement, the message failed to be delivered."
            },
            "href": "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes",
        }
    ],
}
# Blocos `pricing` da página de preços («free monthly tier», «charged», «paid_exempt»).
DOC_SERVICO_FRANQUIA = {
    "billable": False,
    "pricing_model": "PMP",
    "type": "free_customer_service",
    "category": "service",
}
DOC_SERVICO_PAGO = {"billable": True, "pricing_model": "PMP", "type": "regular", "category": "service"}
DOC_PAID_EXEMPT = {
    "billable": False,
    "pricing_model": "PMP",
    "category": "service",
    "type": "free_customer_service",
    "subtype": "paid_exempt",
}
# Janela de anúncio: a doc NÃO traz exemplo pronto; montado com os valores documentados
# (`type = free_entry_point`, `category`/`origin.type = referral_conversion`).
FEP = {"billable": False, "pricing_model": "PMP", "type": "free_entry_point", "category": "referral_conversion"}


# ─── 1. pricing do webhook: o que é gravado ──────────────────────────────────


def test_preco_do_status_payload_da_doc():
    assert disparo_oficial.preco_do_status(DOC_MARKETING_SENT) == {
        "cobravel": True,
        "tipo_preco": "regular",
        "categoria_preco": "marketing",
        "modelo_preco": "PMP",
        "origem_conversa": "marketing",
    }
    assert disparo_oficial.preco_do_status({"pricing": DOC_PAID_EXEMPT}) == {
        "cobravel": False,
        "tipo_preco": "free_customer_service",
        "categoria_preco": "service",
        "subtipo_preco": "paid_exempt",
        "modelo_preco": "PMP",
    }


@pytest.mark.parametrize("s", [DOC_V24_SENT_SEM_PRICING, DOC_FAILED, {}, None, "lixo", {"pricing": "x"}])
def test_sem_pricing_nao_inventa_nada(s):
    assert disparo_oficial.preco_do_status(s) == {}


def _alvo(_db, pnid):
    async def _f():
        return (56, 17) if pnid == "pnid-ccda" else None

    return _f()


def test_webhook_grava_o_pricing_e_nao_regride(sessao, monkeypatch):
    db = _Db(sessao)
    monkeypatch.setattr(disparo_oficial, "conector_do_numero", _alvo)
    W = "wamid.X"

    def _linha():
        return sessao.execute(select(TaWaEnvioStatus).where(TaWaEnvioStatus.wamid == W)).scalars().one()

    # delivered chega primeiro, sem pricing
    _rodar(
        disparo_oficial.registrar_statuses_do_webhook(
            db, "pnid-ccda", [{"id": W, "status": "delivered", "recipient_id": "5511999990000"}]
        )
    )
    assert (_linha().status, _linha().tipo_preco) == ("delivered", None)
    # o sent ATRASADO traz o pricing: o status não volta, mas a cobrança entra
    sent = {**DOC_MARKETING_SENT, "id": W, "recipient_id": "5511999990000"}
    _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", [sent]))
    sessao.expire_all()
    ln = _linha()
    assert (ln.status, ln.cobravel, ln.tipo_preco, ln.categoria_preco, ln.modelo_preco, ln.origem_conversa) == (
        "delivered",
        True,
        "regular",
        "marketing",
        "PMP",
        "marketing",
    )
    # read sem pricing não apaga a cobrança
    _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", [{"id": W, "status": "read"}]))
    sessao.expire_all()
    ln = _linha()
    assert (ln.status, ln.tipo_preco, ln.categoria_preco) == ("read", "regular", "marketing")
    # repetido: idempotente
    _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", [sent]))
    assert len(sessao.execute(select(TaWaEnvioStatus)).scalars().all()) == 1


def test_pricing_na_primeira_linha_e_no_accepted_do_disparo(sessao, monkeypatch):
    """Linha nova direto do webhook já nasce com a cobrança; o `accepted` do disparo completa depois."""
    db = _Db(sessao)
    monkeypatch.setattr(disparo_oficial, "conector_do_numero", _alvo)
    st = {"id": "wamid.Y", "status": "sent", "recipient_id": "5511988887777", "pricing": DOC_SERVICO_FRANQUIA}
    _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", [st]))
    _rodar(disparo_oficial.registrar_status(db, wamid="wamid.Y", status="accepted", conversation_id=9))
    sessao.expire_all()
    ln = sessao.execute(select(TaWaEnvioStatus)).scalars().one()
    assert (ln.status, ln.tipo_preco, ln.categoria_preco, ln.cobravel, ln.conversation_id, ln.tenant_id) == (
        "sent",
        "free_customer_service",
        "service",
        False,
        9,
        17,
    )


def test_failed_nao_ganha_cobranca(sessao, monkeypatch):
    db = _Db(sessao)
    monkeypatch.setattr(disparo_oficial, "conector_do_numero", _alvo)
    _rodar(disparo_oficial.registrar_statuses_do_webhook(db, "pnid-ccda", [DOC_FAILED]))
    ln = sessao.execute(select(TaWaEnvioStatus)).scalars().one()
    assert (ln.status, ln.erro_codigo, ln.tipo_preco, ln.cobravel) == ("failed", 131049, None, None)


# ─── 2. regras puras ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tipo,cob,esperado",
    [
        ("regular", None, True),
        ("regular", False, True),  # o tipo manda (billable vai ser aposentado pela Meta)
        ("free_customer_service", True, False),
        ("free_entry_point", None, False),
        (None, True, True),
        (None, False, False),
        (None, None, None),
    ],
)
def test_e_paga(tipo, cob, esperado):
    assert rel.e_paga(tipo, cob) is esperado


def test_custo_estimado_so_brasil_e_com_tarifa():
    assert rel.custo_estimado("marketing", True) == Decimal("0.3217")
    assert rel.custo_estimado("service", True) == Decimal("0.0350")
    assert rel.custo_estimado("marketing", False) is None  # fora do Brasil
    assert rel.custo_estimado("marketing_lite", True) is None  # preço por lance, sem tabela


def test_periodo_em_brasilia():
    # 11/11/2026 01:30 UTC = 10/11 22:30 em Brasília: «hoje» lá ainda é dia 10
    desde, ate, de, ate_local = rel.periodo(7, datetime(2026, 11, 11, 1, 30))
    assert (de, ate_local) == ("2026-11-04", "2026-11-10")
    assert desde == datetime(2026, 11, 4, 3, 0)  # 00:00 de Brasília = 03:00 UTC
    assert ate == datetime(2026, 11, 11, 1, 30)


def test_referral_da_mensagem_payload_da_doc():
    msg = {
        "referral": {
            "source_url": "https://fb.me/3cr4Wqqkv",
            "source_id": "120226305854810726",
            "source_type": "ad",
            "body": "Summer Succulents are here!",
            "headline": "Chat with us",
            "media_type": "image",
            "ctwa_clid": "Aff-n8ZTODiE79d22KtAwQKj9e",
            "welcome_message": {"text": "Hi there! Let us know how we can help!"},
        },
        "from": "16505551234",
        "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUQ0N0VFMDA2MTQ0RkJFNkNDNAA=",
        "timestamp": "1750275992",
        "text": {"body": "Can I get more info about this?"},
        "type": "text",
    }
    wa, ref = rel.referral_da_mensagem(msg)
    assert wa == "16505551234" and ref["source_id"] == "120226305854810726"
    assert rel.referral_da_mensagem({"from": "1", "text": {"body": "oi"}}) == (None, None)
    assert rel.referral_da_mensagem("não é json") == (None, None)


# ─── 3. agregação no banco ───────────────────────────────────────────────────

BR, BR2, EUA = "5511911110000", "5511922220000", "16505551234"


def _cenario(sessao):
    """Tenant 17 (CCDA) com o número 56 e tenant 3 (Tier) com o número 10."""
    agora = datetime.utcnow()
    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaTenant(id=3, nome="Tier", email="t@t")])
    sessao.add_all([TaAgent(id=26, tenant_id=17, nome="Cinthia"), TaAgent(id=2, tenant_id=3, nome="Maria")])
    sessao.add_all(
        [
            TaConnector(id=56, agent_id=26, kind="whatsapp_cloud", config_json_enc="x"),
            TaConnector(id=10, agent_id=2, kind="whatsapp_cloud", config_json_enc="x"),
        ]
    )
    sessao.add_all(
        [
            TaConversation(id=1, agent_id=26, connector_kind="whatsapp_cloud", external_id=BR, connector_id=56),
            TaConversation(id=2, agent_id=26, connector_kind="whatsapp_cloud", external_id=BR2, connector_id=56),
            TaConversation(
                id=3, agent_id=2, connector_kind="whatsapp_cloud", external_id="5521900000000", connector_id=10
            ),
        ]
    )
    recente = agora - timedelta(minutes=5)
    velha = agora - timedelta(days=60)
    sessao.add_all(
        [
            TaMessageLog(conversation_id=1, role="user", content="oi", created_at=recente),
            TaMessageLog(conversation_id=1, role="assistant", content="olá", created_at=recente),
            TaMessageLog(
                conversation_id=1, role="agent", content="[modelo]", model_used="Disparo · x", created_at=recente
            ),
            TaMessageLog(conversation_id=1, role="note", content="nota interna", created_at=recente),
            TaMessageLog(conversation_id=2, role="user", content="oi", created_at=recente),
            TaMessageLog(conversation_id=2, role="assistant", content="velha", created_at=velha),  # fora do período
            TaMessageLog(conversation_id=3, role="assistant", content="do outro tenant", created_at=recente),
        ]
    )

    def st(w, status, cid=56, destino=BR, preco=None, cod=None, erro=None, quando=recente):
        sessao.add(
            TaWaEnvioStatus(
                wamid=w,
                tenant_id=17 if cid == 56 else 3,
                connector_id=cid,
                destino=destino,
                status=status,
                ordem=disparo_oficial.ORDEM_STATUS[status],
                erro_codigo=cod,
                erro=erro,
                criado_em=quando,
                atualizado_em=quando,
                **disparo_oficial.preco_do_status({"pricing": preco} if preco else {}),
            )
        )

    st("m1", "read", preco=DOC_MARKETING_SENT["pricing"])
    st("m2", "delivered", destino=BR2, preco=DOC_MARKETING_SENT["pricing"])
    st("m3", "delivered", destino=EUA, preco=DOC_MARKETING_SENT["pricing"])  # paga, sem estimativa
    st("s1", "read", preco=DOC_SERVICO_FRANQUIA)
    st("s2", "delivered", preco=DOC_SERVICO_PAGO)
    st("f1", "read", destino=BR2, preco=FEP)
    st("f2", "sent", destino=BR2, preco=FEP)
    st("x1", "failed", cod=131026, erro="Message undeliverable")
    st("x2", "failed", cod=131026, erro="Message undeliverable")
    st("x3", "failed", cod=131049, erro="This message was not delivered to maintain healthy ecosystem engagement.")
    st("a1", "accepted")  # disparo sem retorno ainda
    st("v1", "read", preco=DOC_MARKETING_SENT["pricing"], quando=velha)  # fora do período
    st("o1", "read", cid=10, destino="5521900000000", preco=DOC_MARKETING_SENT["pricing"])  # outro tenant
    # chegadas: uma por anúncio (contato do tenant 17), uma sem anúncio, uma de anúncio de contato SEM conversa aqui
    ref = {"source_id": "120226305854810726", "source_type": "ad", "headline": "Matrículas 2027", "ctwa_clid": "Aff"}
    sessao.add_all(
        [
            TaWebhookEvent(
                source="whatsapp-cloud",
                event_id="in1",
                payload_json={"from": BR2, "referral": ref, "type": "text"},
                processed_at=recente,
            ),
            TaWebhookEvent(
                source="whatsapp-cloud", event_id="in2", payload_json={"from": BR, "type": "text"}, processed_at=recente
            ),
            TaWebhookEvent(
                source="whatsapp-cloud",
                event_id="in3",
                payload_json={"from": "5599999999999", "referral": ref},
                processed_at=recente,
            ),
            TaWebhookEvent(
                source="whatsapp", event_id="in4", payload_json={"from": BR, "referral": ref}, processed_at=recente
            ),
        ]
    )
    sessao.commit()


def test_relatorio_agrega_pago_gratis_tipo_categoria_e_custo(sessao):
    _cenario(sessao)
    r = _rodar(rel.calcular(_Db(sessao), 17, 30))
    t = r["total"]
    assert (t["enviadas_registro"], t["recebidas"]) == (2, 2)  # nota interna e msg velha fora
    assert t["com_status_meta"] == 11
    assert t["funil"] == {
        "aguardando": 1,
        "enviadas": 7,
        "entregues": 6,
        "lidas": 3,
        "falhas": 3,
        "taxa_entrega": round(6 / 10, 4),
        "taxa_leitura": round(3 / 6, 4),
    }
    c = t["cobranca"]
    assert (c["com_dado"], c["pagas"], c["gratis"], c["sem_dado"]) == (7, 4, 3, 4)
    assert {x["tipo"]: x["n"] for x in c["por_tipo"]} == {
        "regular": 4,
        "free_customer_service": 1,
        "free_entry_point": 2,
    }
    cats = {x["categoria"]: x for x in c["por_categoria"]}
    assert (cats["marketing"]["total"], cats["marketing"]["pagas"]) == (3, 3)
    assert (cats["service"]["pagas"], cats["service"]["gratis"]) == (1, 1)
    assert cats["referral_conversion"]["gratis"] == 2
    # 2 marketing +55 (0,3217) + 1 serviço pago (0,0350); o marketing para +1 não tem estimativa
    assert c["custo_estimado"] == float(round(Decimal("0.3217") * 2 + Decimal("0.0350"), 2))
    assert c["pagas_sem_estimativa"] == 1
    assert cats["marketing"]["custo_estimado"] == 0.64
    assert {(m["codigo"], m["n"]) for m in t["falhas_motivos"]} == {(131026, 2), (131049, 1)}
    assert t["falhas_motivos"][0]["motivo"].startswith("não entregável")
    assert t["anuncio"] == {
        "contatos": 1,
        "mensagens": 1,
        "respostas_na_janela_gratis": 2,
        "contatos_na_janela_gratis": 1,
    }
    assert r["anuncios"] == [{"anuncio_id": "120226305854810726", "titulo": "Matrículas 2027", "mensagens": 1}]
    assert t["franquia_servico_mes"] == {"limite": 1000, "gratis": 1, "pagas": 1}
    assert t["cobranca"]["cobranca_desde"] is not None
    assert [n["id"] for n in r["numeros"]] == [56]
    assert [n["connector_id"] for n in r["por_numero"]] == [56]


def test_relatorio_nao_mistura_tenant_e_filtra_numero(sessao):
    _cenario(sessao)
    r3 = _rodar(rel.calcular(_Db(sessao), 3, 30))
    assert r3["total"]["com_status_meta"] == 1 and r3["total"]["enviadas_registro"] == 1
    assert r3["total"]["anuncio"]["contatos"] == 0
    assert _rodar(rel.calcular(_Db(sessao), 17, 30, connector_id=10)) == {"erro": "numero_nao_encontrado"}
    so56 = _rodar(rel.calcular(_Db(sessao), 17, 30, connector_id=56))
    assert so56["total"]["com_status_meta"] == 11


def test_relatorio_sem_dado_de_cobranca_nunca_vira_gratis(sessao):
    """Linha antiga (sem `pricing`) fica em «sem dado», não soma em pagas nem em grátis."""
    _cenario(sessao)
    sessao.execute(TaWaEnvioStatus.__table__.update().values(tipo_preco=None, categoria_preco=None, cobravel=None))
    sessao.commit()
    c = _rodar(rel.calcular(_Db(sessao), 17, 30))["total"]["cobranca"]
    assert (c["pagas"], c["gratis"], c["com_dado"], c["custo_estimado"], c["cobranca_desde"]) == (0, 0, 0, 0.0, None)
    assert c["sem_dado"] == 11


def test_numero_sem_movimento_aparece_com_zero(sessao):
    sessao.add_all([TaTenant(id=17, nome="CCDA", email="c@c"), TaAgent(id=26, tenant_id=17, nome="Cinthia")])
    sessao.add(TaConnector(id=56, agent_id=26, kind="whatsapp_cloud", config_json_enc="x"))
    sessao.commit()
    r = _rodar(rel.calcular(_Db(sessao), 17, 7))
    assert [(n["connector_id"], n["enviadas_registro"], n["com_status_meta"]) for n in r["por_numero"]] == [(56, 0, 0)]
    assert r["total"]["funil"]["taxa_entrega"] is None


# ─── 4. permissão ────────────────────────────────────────────────────────────


def test_rota_so_para_dono_ou_admin():
    with pytest.raises(HTTPException) as e:
        _rodar(require_gestor(CurrentUser(1, "a@a", tenant_id=17, member_id=5, role="atendente")))
    assert e.value.status_code == 403
    assert _rodar(require_gestor(CurrentUser(1, "d@d", tenant_id=17, role="owner"))).tenant_id == 17


def test_rotas_estao_atras_do_require_gestor():
    from routes import reports

    alvo = {"/reports/whatsapp-oficial", "/reports/whatsapp-oficial/meta"}
    achadas = set()
    for r in reports.router.routes:
        if r.path in alvo:
            achadas.add(r.path)
            assert any(d.call is require_gestor for d in r.dependant.dependencies), r.path
    assert achadas == alvo


def test_rota_404_para_numero_de_outro_tenant(sessao):
    from routes import reports

    _cenario(sessao)
    dono = CurrentUser(1, "d@d", tenant_id=17, role="owner")
    with pytest.raises(HTTPException) as e:
        _rodar(reports.whatsapp_oficial(days=30, connector_id=10, user=dono, db=_Db(sessao)))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        _rodar(reports.whatsapp_oficial_meta(connector_id=10, days=30, user=dono, db=_Db(sessao)))
    assert e.value.status_code == 404
    assert (
        _rodar(reports.whatsapp_oficial(days=30, connector_id=None, user=dono, db=_Db(sessao)))["total"][
            "com_status_meta"
        ]
        == 11
    )


# ─── 5. número da própria Meta (pricing_analytics) ───────────────────────────

# Recorte da «Example response» do pricing_analytics (doc de analytics), com `phone_number` acrescentado
# a dois pontos para provar o filtro por número (a doc diz que ele vem quando a dimensão PHONE é pedida).
DOC_ANALYTICS = {
    "pricing_analytics": {
        "data": [
            {
                "data_points": [
                    {
                        "start": 1749193200,
                        "end": 1749279600,
                        "country": "IN",
                        "pricing_type": "FREE_CUSTOMER_SERVICE",
                        "pricing_category": "SERVICE",
                        "volume": 2,
                        "cost": 0,
                    },
                    {
                        "start": 1748934000,
                        "end": 1749020400,
                        "country": "US",
                        "tier": "0:MAX",
                        "pricing_type": "REGULAR",
                        "pricing_category": "MARKETING",
                        "volume": 1,
                        "cost": 10,
                        "phone_number": "15550783881",
                    },
                    {
                        "start": 1748847600,
                        "end": 1748934000,
                        "country": "US",
                        "pricing_type": "FREE_ENTRY_POINT",
                        "pricing_category": "SERVICE",
                        "volume": 6,
                        "cost": 0,
                        "phone_number": "15550783881",
                    },
                ]
            }
        ]
    }
}


def test_somar_pricing_analytics():
    tudo = rel.somar_pricing_analytics(DOC_ANALYTICS, None)
    assert (tudo["volume"], tudo["custo"], tudo["so_deste_numero"]) == (9, 10.0, False)
    deste = rel.somar_pricing_analytics(DOC_ANALYTICS, "+1 555-078-3881")
    assert (deste["volume"], deste["custo"], deste["so_deste_numero"]) == (7, 10.0, True)
    assert {x["tipo"]: x["n"] for x in deste["por_tipo"]} == {"regular": 1, "free_entry_point": 6}
    sem_custo = rel.somar_pricing_analytics({"pricing_analytics": {"data": [{"data_points": [{"volume": 3}]}]}}, None)
    assert (sem_custo["volume"], sem_custo["custo"]) == (3, None)


def test_da_meta_com_cache_e_falha_que_nao_derruba(sessao, monkeypatch):
    _cenario(sessao)
    monkeypatch.setattr(
        "core.encryption.decrypt", lambda _x: '{"waba_id": "W1", "token": "T", "display_phone": "+1 555 078 3881"}'
    )
    chamadas = []

    async def _pede(cfg, inicio, fim):
        chamadas.append((cfg["waba_id"], inicio < fim))
        return DOC_ANALYTICS

    monkeypatch.setattr(rel, "_pedir_pricing_analytics", _pede)
    db = _Db(sessao)
    a = _rodar(rel.da_meta(db, 17, 56, 30))
    b = _rodar(rel.da_meta(db, 17, 56, 30))
    assert a["disponivel"] and a["volume"] == 7 and b == a and chamadas == [("W1", True)]
    assert _rodar(rel.da_meta(db, 17, 10, 30)) == {"disponivel": False, "motivo": "numero_nao_encontrado"}

    async def _quebra(*_a, **_k):
        raise RuntimeError("200: Permissions error")

    rel._cache_meta.clear()
    monkeypatch.setattr(rel, "_pedir_pricing_analytics", _quebra)
    c = _rodar(rel.da_meta(db, 17, 56, 30))
    assert c["disponivel"] is False and "Permissions error" in c["motivo"]


def test_da_meta_sem_token_nao_chama(sessao, monkeypatch):
    _cenario(sessao)
    monkeypatch.setattr("core.encryption.decrypt", lambda _x: '{"waba_id": "W1"}')

    async def _nao(*_a, **_k):
        raise AssertionError("não devia chamar a Meta")

    monkeypatch.setattr(rel, "_pedir_pricing_analytics", _nao)
    r = _rodar(rel.da_meta(_Db(sessao), 17, 56, 30))
    assert r["disponivel"] is False and "chave" in r["motivo"]

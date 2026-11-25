"""A lista de conversas não para mais nas 200 mais recentes da conta (25/11/2026, CCDA).

«A Karolaine só tem 3 conversas, ela excluiu?»: tinha 69. Num dia de disparo o número oficial ocupava 182
das 200 carregadas, e a tela filtrava número, filas e busca em cima delas."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.db import Base
from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaTenant
from routes import conversations
from services import filtro_conversas

T0 = datetime(2026, 11, 25, 10, 0)
OFICIAL, KAROL, DEBORA = 56, 49, 38
DONO = dict(tenant_id=17, member_id=None, role="owner")
KAROLAINE = dict(tenant_id=17, member_id=6, role="atendente")


def _rodar(coro):
    laco = asyncio.new_event_loop()
    try:
        return laco.run_until_complete(coro)
    finally:
        laco.close()


class _Db:
    def __init__(self, s):
        self.s = s

    async def execute(self, q, *a, **k):
        if "ta_connector_membro" in str(q):  # números divididos com outras pessoas: nenhum aqui
            return SimpleNamespace(all=lambda: [])
        return self.s.execute(q, *a, **k)

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()


def _conv(i, conector, minutos, **k):
    k.setdefault("external_id", f"55119{i:08d}@s.whatsapp.net")
    return TaConversation(
        id=i, agent_id=26, connector_kind="whatsapp_cloud" if conector == OFICIAL else "whatsapp",
        connector_id=conector, last_message_at=T0 + timedelta(minutes=minutos),
        started_at=T0, msg_count=1, status=k.pop("status", "active"), csat_state="none", priority="none",
        followup_step=0, tags=k.pop("tags", []), **k,
    )  # fmt: skip


def _msg(cid, role, minutos):
    return TaMessageLog(conversation_id=cid, role=role, content=role, created_at=T0 + timedelta(minutes=minutos))


@pytest.fixture
def s(monkeypatch):
    motor = create_engine("sqlite://")
    Base.metadata.create_all(
        motor, tables=[m.__table__ for m in (TaTenant, TaAgent, TaConnector, TaConversation, TaMessageLog)]
    )
    fone = {OFICIAL: "5511000009591", KAROL: "5511000002166", DEBORA: "5511000002168"}
    monkeypatch.setattr(conversations, "decrypt", lambda enc: '{"phone": "%s"}' % fone[int(enc)])

    async def _nomes(_t, externos):
        return {e: n for e, n in NOMES_DO_CRM.items() if e in set(externos)}

    async def _sem_agenda(_db, _t, _o):
        return None

    async def _agentes(_db, _t):
        return [26]

    NOMES_DO_CRM.clear()
    monkeypatch.setattr(conversations.nome_crm, "nomes_do_crm", _nomes)
    monkeypatch.setattr(conversations, "_completar_com_agenda", _sem_agenda)
    with Session(motor, expire_on_commit=False) as sess:
        sess.add(TaTenant(id=17, nome="CCDA", email="x@x"))
        sess.add(TaAgent(id=26, tenant_id=17, nome="Nathalia"))
        for k, membro in ((OFICIAL, None), (KAROL, 6), (DEBORA, 23)):
            sess.add(TaConnector(id=k, agent_id=26, kind="whatsapp", config_json_enc=str(k), member_id=membro, modo="registro"))
        sess.commit()
        yield sess
    motor.dispose()


NOMES_DO_CRM: dict[str, str] = {}
_PADRAO = dict(
    agent_id=None, status=None, tag=None, scope=None, view=None, de=None, ate=None, responsavel=None, numero=None,
    canal=None, agente=None, time_id=None, fila=None, contato=None, busca=None, antes_de=None, antes_id=None, limit=200,
)  # fmt: skip


def _lista(s, quem=DONO, **k):
    r = _rodar(conversations.list_conversations(**{**_PADRAO, **k}, user=SimpleNamespace(**quem), db=_Db(s)))
    return [c.id for c in r]


def _resumo(s, quem=DONO, **k):
    base = dict(scope=None, de=None, ate=None, responsavel=None)
    return _rodar(conversations.resumo_da_lista(**{**base, **k}, user=SimpleNamespace(**quem), db=_Db(s)))


def _dia_de_disparo(s):
    """260 do oficial agora; as 69 da Karolaine são dos dias anteriores, menos 3."""
    s.add_all([_conv(1000 + i, OFICIAL, i) for i in range(260)])
    s.add_all([_conv(i, KAROL, 300 + i if i <= 3 else -1000 - i, assigned_member_id=6) for i in range(1, 70)])
    s.commit()


def test_o_numero_da_consultora_aparece_inteiro_no_dia_do_disparo(s):
    _dia_de_disparo(s)
    assert len([c for c in _lista(s) if c < 1000]) == 3  # o que a tela mostrava
    assert sorted(_lista(s, numero="5511000002166")) == list(range(1, 70))
    assert _lista(s, numero="5511000002168") == []  # número dela sem conversa
    assert _lista(s, numero="não existe") == []


def test_a_lateral_conta_todas_e_nenhum_numero_some(s):
    _dia_de_disparo(s)
    s.add(_conv(5000, DEBORA, -90000))
    s.commit()
    r = _resumo(s)
    assert r["total"] == 330
    assert {n["rotulo"]: n["total"] for n in r["numeros"]} == {"5511000009591": 260, "5511000002166": 69, "5511000002168": 1}
    assert {n["rotulo"]: n["connector_ids"] for n in r["numeros"]}["5511000002166"] == [KAROL]
    assert {c["canal"]: c["total"] for c in r["canais"]} == {"whatsapp_cloud": 260, "whatsapp": 70}
    assert r["agentes"] == [{"id": 26, "nome": "Nathalia", "total": 330, "nao_lidas": 0}]


def test_atendente_nao_ganha_outra_porta(s):
    _dia_de_disparo(s)
    s.add(_conv(5000, DEBORA, -90000, assigned_member_id=23))
    s.commit()
    assert [n["rotulo"] for n in _resumo(s, KAROLAINE)["numeros"]] == ["5511000002166"]
    assert _resumo(s, KAROLAINE)["total"] == 69
    assert _lista(s, KAROLAINE, numero="5511000002168") == []
    assert _lista(s, KAROLAINE, numero="5511000009591") == []
    assert _lista(s, KAROLAINE, contato="55119%08d@s.whatsapp.net" % 5000) == []
    assert _lista(s, KAROLAINE, busca="5000") == []
    assert _lista(s, KAROLAINE, fila="nao_atendidas") == []


def test_pagina_seguinte_sem_repetir_nem_perder(s):
    s.add_all([_conv(i, OFICIAL, i // 3) for i in range(1, 48)])  # empates de horário de propósito
    s.commit()
    vistos, ultimo = [], dict()
    for _ in range(12):
        ids = _lista(s, limit=10, **ultimo)
        if not ids:
            break
        vistos += ids
        u = s.get(TaConversation, ids[-1])
        ultimo = dict(antes_de=u.last_message_at, antes_id=u.id)
        # chega mensagem nova no topo entre uma página e outra: não pode empurrar a página seguinte
        s.get(TaConversation, vistos[0]).last_message_at = T0 + timedelta(days=1, minutes=len(vistos))
        s.commit()
    assert vistos == list(range(47, 0, -1))


def test_as_filas_sao_as_mesmas_da_linha(s):
    s.add_all([
        _conv(1, KAROL, 1), _conv(2, KAROL, 2, visto_equipe_em=T0 + timedelta(minutes=5)),
        _conv(3, KAROL, 3, visto_equipe_em=T0 + timedelta(hours=1), assigned_member_id=6),
        _conv(4, KAROL, 4, status="closed"), _conv(5, KAROL, 5, status="handed_off", assigned_member_id=6),
    ])  # fmt: skip
    s.add_all([
        _msg(1, "user", 1), _msg(1, "assistant", 2),            # respondida pela IA, ninguém viu
        _msg(2, "user", 1), _msg(2, "agent", 2), _msg(2, "user", 10),  # voltou a falar depois de vista
        _msg(3, "user", 1), _msg(3, "note", 2),                 # vista, só nota interna: segue esperando
        _msg(4, "user", 1),                                     # encerrada não espera
        _msg(5, "agent", 1),                                    # só nós falamos
    ])  # fmt: skip
    s.commit()
    assert sorted(_lista(s, fila="nao_lidas")) == [1, 2, 4]
    assert sorted(_lista(s, fila="aguardando")) == [2, 3]
    assert sorted(_lista(s, fila="nao_atendidas")) == [1, 2]
    r = _resumo(s)
    assert (r["nao_lidas"], r["aguardando"], r["nao_atendidas"]) == (3, 2, 2)
    assert r["numeros"][0]["nao_lidas"] == 3
    # e é a mesma régua do campo da linha
    nao_lidas = _rodar(conversations._nao_lidas(_Db(s), [1, 2, 3, 4, 5]))
    assert sorted(nao_lidas) == [1, 2, 4]


def test_a_busca_acha_conversa_antiga_por_nome_e_por_telefone(s):
    _dia_de_disparo(s)
    s.add(_conv(7000, KAROL, -90000, external_id="5511987654321@s.whatsapp.net", contact_name="Ju"))
    s.add(_conv(7001, DEBORA, -90001, external_id="123456789012345@lid", contact_name="Conceição"))
    s.commit()
    NOMES_DO_CRM["5511987654321@s.whatsapp.net"] = "JULIANA GONÇALVES"
    assert _lista(s, busca="goncalves") == [7000]  # nome do CRM, sem acento
    assert _lista(s, busca="(11) 98765-4321") == [7000]
    assert _lista(s, busca="conceicao") == [7001]
    assert _lista(s, busca="ninguém assim") == []
    assert _lista(s, busca="goncalves", numero="5511000002168") == []  # respeita o número escolhido
    assert len(_lista(s, busca="j")) == 200  # uma letra não busca


def test_conversas_do_mesmo_contato(s):
    s.add_all([_conv(1, KAROL, 1, external_id="a@x"), _conv(2, OFICIAL, 2, external_id="a@x"), _conv(3, KAROL, 3)])
    s.commit()
    assert _lista(s, contato="a@x") == [2, 1]


def test_canal_agente_e_time(s):
    s.add_all([_conv(1, KAROL, 1, team_id=4), _conv(2, OFICIAL, 2)])
    s.commit()
    assert _lista(s, canal="whatsapp") == [1] and _lista(s, canal="whatsapp_cloud") == [2]
    assert _lista(s, agente="Nathalia") == [2, 1] and _lista(s, agente="Outro") == []
    assert _lista(s, time_id=4) == [1]
    assert _resumo(s)["times"] == [{"id": 4, "total": 1, "nao_lidas": 0}]


def test_adiada_fica_fora_da_lista_e_da_conta(s):
    s.add_all([_conv(1, KAROL, 1), _conv(2, KAROL, 2, snoozed_until=datetime.utcnow() + timedelta(days=1))])
    s.commit()
    assert _lista(s) == [1] and _resumo(s)["total"] == 1
    assert _lista(s, scope="snoozed") == [2] and _resumo(s, scope="snoozed")["total"] == 1


def test_resumo_etiquetas_e_linha_sem_numero():
    linhas = [
        (26, None, None, None, ["visita", "visita"], None, None, None, T0, None),
        (26, 49, "whatsapp", 3, ["visita"], "closed", None, T0, T0, None),
    ]
    r = filtro_conversas.agrupar_resumo(linhas, {49: ("x", "registro")}, {26: "N"})
    assert r["etiquetas"] == [{"nome": "visita", "total": 2, "nao_lidas": 1}]
    assert r["canais"] == [{"canal": "outro", "total": 1, "nao_lidas": 1}, {"canal": "whatsapp", "total": 1, "nao_lidas": 0}]
    assert [n["rotulo"] for n in r["numeros"]] == ["x"]
    assert (r["aguardando"], r["nao_atendidas"]) == (1, 1)


def test_resumo_vem_antes_da_rota_do_id():
    caminhos = [r.path for r in conversations.router.routes]
    assert caminhos.index("/conversations/resumo") < caminhos.index("/conversations/{conversation_id}")


def test_fila_desconhecida_nao_passa():
    with pytest.raises(ValueError):
        filtro_conversas.condicao_fila("todas")

"""Tools de funil do agente — o que aceitam e o que fazem quando dá errado.

O risco aqui não é o caminho feliz. É o agente (a) mover o card para uma etapa
que ele inventou, (b) marcar como perdida uma família que só disse "vou pensar",
e (c) pedir desculpa por uma engrenagem interna que ela não sabe que existe.

Atualizado para o documento final v3: seis etapas (eram duas) e `marcar_perda`
como ferramenta separada.
"""
import asyncio

import pytest

from services.agenda_tools import (
    ETAPAS_QUE_O_AGENTE_MOVE,
    MOTIVOS_DE_PERDA,
    _make_etapa_handler,
    _make_perda_handler,
    build_etapa_tool_schema,
    build_perda_tool_schema,
)


def rodar(handler, args):
    return asyncio.get_event_loop().run_until_complete(handler(args))


# ── schema da etapa ──────────────────────────────────────────────────
def test_schema_oferece_as_seis_etapas_do_v3():
    """Enum fechado: o modelo não consegue escolher etapa fora da lista."""
    fn = build_etapa_tool_schema()["function"]
    assert fn["name"] == "atualizar_etapa_crm"
    assert fn["parameters"]["properties"]["etapa"]["enum"] == [
        "Série identificada",
        "Motivo identificado",
        "Interesse em avançar",
        "Visita Agendada",
        "Visita Realizada",
    ]
    assert fn["parameters"]["required"] == ["etapa"]


def test_entrada_de_lead_fica_fora_do_enum():
    """🚨 É onde o card nasce. Uma tool que voltasse pra lá deixaria o modelo
    desfazer progresso a partir de conversa fiada."""
    assert "Entrada de Lead" not in ETAPAS_QUE_O_AGENTE_MOVE


def test_perda_saiu_do_enum_de_etapa():
    """Perda tem ferramenta própria — a regra de negativa não cabe num enum."""
    assert not any("perdid" in e.lower() for e in ETAPAS_QUE_O_AGENTE_MOVE)
    assert "motivo" not in build_etapa_tool_schema()["function"]["parameters"]["properties"]


def test_schema_manda_nao_comentar_com_a_familia():
    d = build_etapa_tool_schema()["function"]["description"].lower()
    assert "nunca avise a família" in d


def test_schema_avisa_para_nao_avancar_so_porque_respondeu():
    """O v3 é explícito: etapa é estágio alcançado, não quantidade de mensagens."""
    d = build_etapa_tool_schema()["function"]["description"].lower()
    assert "não avance uma etapa só porque a família respondeu" in d


def test_lista_de_etapas_continua_curta_de_proposito():
    """Se alguém crescer esta lista, o teste avisa: mover funil vira palpite."""
    assert len(ETAPAS_QUE_O_AGENTE_MOVE) == 5


# ── schema da perda ──────────────────────────────────────────────────
def test_schema_da_perda_existe_e_tem_enum_fechado():
    fn = build_perda_tool_schema()["function"]
    assert fn["name"] == "marcar_perda"
    assert fn["parameters"]["properties"]["motivo"]["enum"] == MOTIVOS_DE_PERDA


@pytest.mark.parametrize("nao_e_perda", [
    "vou pensar", "depois vejo", "agora não", "está caro",
    "vou conversar com meu marido", "estou pesquisando", "estou olhando outras escolas",
])
def test_a_descricao_lista_o_que_NAO_e_perda(nao_e_perda):
    """🚨 Perder um lead cedo demais é o erro caro: o card sai do funil, para de
    ser reengajado, e ninguém revisita. A lista da negativa mora na descrição."""
    assert nao_e_perda in build_perda_tool_schema()["function"]["description"].lower()


def test_a_descricao_manda_nao_chamar_na_duvida():
    d = build_perda_tool_schema()["function"]["description"].lower()
    assert "na dúvida, não chame" in d


# ── handler da etapa ─────────────────────────────────────────────────
def test_sem_telefone_nao_chama_a_api_e_nao_alarma_a_familia():
    h = _make_etapa_handler("ccda", None)
    r = rodar(h, {"etapa": "Visita Agendada"})
    # O contrato mudou: a ferramenta manda o modelo CONTINUAR, não ficar mudo.
    # Antes ela dizia só "sem comentar isso", e o modelo entendia "não diga
    # nada" — respondia vazio e o fallback do motor entrava no lugar dele.
    assert "NÃO mencione isso" in r
    assert "siga o roteiro" in r
    assert "desculpa" not in r.lower()


def test_etapa_fora_da_lista_e_recusada_antes_do_http():
    h = _make_etapa_handler("ccda", "5511999999999")
    r = rodar(h, {"etapa": "Efetivação — ganho"})
    assert "etapa inválida" in r
    assert "Visita Agendada" in r


def test_etapa_vazia_tambem_e_recusada():
    h = _make_etapa_handler("ccda", "5511999999999")
    assert "etapa inválida" in rodar(h, {})


@pytest.mark.parametrize("etapa", ETAPAS_QUE_O_AGENTE_MOVE)
def test_as_etapas_validas_passam_da_validacao(etapa):
    """Chega a tentar o HTTP (e falha sem rede) — prova que não parou antes."""
    h = _make_etapa_handler("ccda", "5511999999999")
    assert "etapa inválida" not in rodar(h, {"etapa": etapa})


# ── handler da perda ─────────────────────────────────────────────────
def test_perda_sem_telefone_nao_alarma_a_familia():
    r = rodar(_make_perda_handler("ccda", None), {"motivo": "não tem interesse"})
    # O contrato mudou: a ferramenta manda o modelo CONTINUAR, não ficar mudo.
    # Antes ela dizia só "sem comentar isso", e o modelo entendia "não diga
    # nada" — respondia vazio e o fallback do motor entrava no lugar dele.
    assert "NÃO mencione isso" in r
    assert "siga o roteiro" in r
    assert "desculpa" not in r.lower()


def test_motivo_fora_da_lista_e_NORMALIZADO_nao_recusado():
    """🚨 Recusar faria o modelo tentar de novo com outro texto e, na terceira,
    desistir — a perda ficaria invisível no funil, pior que motivo aproximado."""
    r = rodar(_make_perda_handler("ccda", "5511999999999"), {"motivo": "cliente sumiu"})
    assert "inválido" not in r.lower()


def test_motivo_ausente_cai_no_padrao():
    r = rodar(_make_perda_handler("ccda", "5511999999999"), {})
    assert "inválido" not in r.lower()

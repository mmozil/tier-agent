"""Cascata por origem — o reengajamento tem que retomar o assunto certo.

A queixa que originou isto: quem parou na hora de escolher a data recebia
"vi que você demonstrou interesse no nosso colégio", igual a quem nunca disse a
série. Para quem já conversou, isso lê como se o colégio tivesse esquecido tudo.
"""
import pytest

from services.cascatas_reengajamento import (
    CASCATAS,
    ETAPA_ESGOTOU,
    ETAPA_POR_PASSO,
    PADRAO,
    identificar_origem,
    passos,
)


# ── identificação da origem ──────────────────────────────────────────
@pytest.mark.parametrize(
    "ultima_fala,esperado",
    [
        ("Ótimo, será um prazer te receber. Tenho disponibilidade: Dia 03/09 às 9h ou 14h. "
         "Qual fica melhor para você?", "oferta_datas"),
        ("Excelente. Você prefere agendar uma visita ao colégio ou prefere que eu te ligue "
         "para passar mais detalhes?", "escolha_proximo_passo"),
        ("A mensalidade começa em R$ 1.163,84, com planos de benefícios que apresento "
         "pessoalmente. Esse valor de investimento faz sentido para vocês?", "pitch_preco"),
        ("Compreendo, Ana. Temos alguns planos de benefícios e talvez um deles se encaixe "
         "melhor. Posso te ligar para conversarmos?", "objecao_preco"),
        ("Combinado. Tenho um atendimento agendado agora, mas te ligo em até 30 minutos. "
         "Pode ser?", "combinado_ligacao"),
        ("Para que a consultora já prepare tudo, me passa: nome completo do(a) filho(a) e "
         "escola atual.", "dados_do_filho"),
    ],
)
def test_cada_ponto_de_parada_cai_na_sua_cascata(ultima_fala, esperado):
    assert identificar_origem(ultima_fala) == esperado


def test_abertura_e_o_padrao():
    assert identificar_origem(
        "Olá! Sou a Nathalia, assistente educacional aqui no CCDA."
    ) == PADRAO


def test_texto_desconhecido_cai_no_padrao_e_nao_quebra():
    """🚨 Errar para o texto NEUTRO, nunca para um que afirma o que não houve."""
    assert identificar_origem("qualquer coisa que ninguém previu") == PADRAO
    assert identificar_origem(None) == PADRAO
    assert identificar_origem("") == PADRAO


def test_acento_perdido_no_canal_nao_quebra_o_casamento():
    assert identificar_origem("Otimo, sera um prazer te receber. Tenho disponibilidade") == "oferta_datas"


def test_caixa_alta_nao_quebra():
    assert identificar_origem("TENHO DISPONIBILIDADE: DIA 03/09") == "oferta_datas"


def test_objecao_vence_pitch_quando_as_duas_marcas_aparecem():
    """A ordem das cascatas importa: a mais específica primeiro."""
    texto = ("A mensalidade começa em R$ 1.163,84. Compreendo. Temos alguns "
             "planos de benefícios e talvez um deles se encaixe melhor.")
    assert identificar_origem(texto) == "objecao_preco"


# ── os passos ────────────────────────────────────────────────────────
def test_toda_cascata_tem_quatro_passos():
    for c in CASCATAS:
        assert len(passos(c["chave"])) == 4


def test_o_d1_muda_por_origem_e_o_resto_e_comum():
    a = passos("oferta_datas")
    b = passos("pitch_preco")
    assert a[0]["msg"] != b[0]["msg"]          # D+1 é próprio
    assert [p["msg"] for p in a[1:]] == [p["msg"] for p in b[1:]]  # D+3/7/10 iguais


def test_o_contador_de_tentativa_anda_a_cada_passo():
    p = passos(PADRAO)
    assert [x["etapa"] for x in p[:3]] == ETAPA_POR_PASSO[:3]


def test_o_ultimo_passo_encerra_em_perdido():
    """D+10 é o break-up: o lead sai do funil por esgotamento."""
    assert passos(PADRAO)[-1]["etapa"] == ETAPA_ESGOTOU


def test_as_horas_sao_cumulativas_e_crescentes():
    h = [x["h"] for x in passos(PADRAO)]
    assert h == sorted(h) and len(set(h)) == 4


def test_sao_oito_cascatas_como_no_desenho():
    assert len(CASCATAS) == 8


def test_nenhum_d1_repete_texto():
    """Duas cascatas com o mesmo texto seriam uma cascata só disfarçada."""
    textos = [c["d1"] for c in CASCATAS]
    assert len(set(textos)) == len(textos)

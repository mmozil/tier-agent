"""Cascata por origem — o reengajamento tem que retomar o assunto certo.

A queixa que originou isto: quem parava na hora de escolher a data recebia
"vi que você demonstrou interesse no nosso colégio", igual a quem nunca disse a
série. Para quem já conversou, isso lê como se o colégio tivesse esquecido tudo.

Atualizado para o documento final v3: 9 origens, 23h no 1º disparo, encerramento
D+13, e a origem 3 com uma variante por categoria de motivo.
"""
import pytest

from services.cascatas_reengajamento import (
    CASCATAS,
    HORAS,
    MOTIVO_PERDA_ESGOTOU,
    PADRAO,
    POR_CATEGORIA,
    identificar_origem,
    passos,
    texto_d1,
)


# ── identificação da origem ──────────────────────────────────────────
@pytest.mark.parametrize(
    "ultima_fala,esperado",
    [
        ("Para qual ano escolar você gostaria de mais informações?", 1),
        ("E o que fez vocês começarem a procurar uma nova escola neste momento?", 2),
        ("Você prefere agendar uma visita ao colégio ou prefere que eu te ligue "
         "para passar mais detalhes?", 3),
        ("Ótimo, será um prazer te receber. Tenho disponibilidade: Dia 03/09 às 9h "
         "ou 14h. Qual fica melhor para você?", 4),
        ("Para que a consultora já prepare tudo, me passa: nome completo do(a) "
         "filho(a) e escola atual.", 5),
        ("Combinado! Vou te ligar para explicar melhor. Pode ser?", 6),
        ("A mensalidade é de R$ 989,86. Você prefere conhecer o colégio "
         "pessoalmente ou quer que eu te ligue?", 7),
        ("Compreendo, Ana. Temos alguns planos de benefícios e talvez um deles se "
         "encaixe melhor. Posso te ligar para conversarmos?", 8),
        ("Oi, tudo bem? Ainda fico à disposição pra saber qual ano escolar você "
         "gostaria de mais informações.", 9),
    ],
)
def test_cada_ponto_de_parada_cai_na_sua_cascata(ultima_fala, esperado):
    assert identificar_origem(ultima_fala) == esperado


def test_sao_nove_origens():
    """O v3 acrescentou a origem 2 (Motivo da procura), que não tinha texto."""
    assert len(CASCATAS) == 9
    assert sorted(c["n"] for c in CASCATAS) == list(range(1, 10))


def test_a_origem_2_existe_e_fala_do_motivo():
    """Era o único ponto de parada sem texto próprio: quem contava o motivo e
    sumia recebia o texto de quem nunca disse nada."""
    assert identificar_origem(
        "E o que fez vocês começarem a procurar uma nova escola neste momento?"
    ) == 2
    assert "procurar uma nova escola" in texto_d1(2)


def test_preco_vence_interesse_quando_as_duas_marcas_aparecem():
    """🚨 As origens 3 e 7 terminam com a MESMA pergunta. Só a marca do valor
    separa, e o formato do preço manda tudo numa mensagem só."""
    texto = ("A mensalidade é de R$ 989,86. Você prefere agendar uma visita ao "
             "colégio ou prefere que eu te ligue?")
    assert identificar_origem(texto) == 7


def test_texto_desconhecido_cai_no_padrao_e_nao_quebra():
    """🚨 Errar para o texto NEUTRO, nunca para um que afirma o que não houve."""
    assert identificar_origem("qualquer coisa que ninguém previu") == PADRAO
    assert identificar_origem(None) == PADRAO
    assert identificar_origem("") == PADRAO


def test_acento_perdido_no_canal_nao_quebra_o_casamento():
    assert identificar_origem("Otimo, sera um prazer te receber. Tenho disponibilidade") == 4


def test_caixa_alta_nao_quebra():
    assert identificar_origem("TENHO DISPONIBILIDADE: DIA 03/09") == 4


# ── a origem 3 e suas nove variantes ─────────────────────────────────
def test_origem_3_tem_uma_variante_por_categoria():
    assert len(POR_CATEGORIA) == 9


def test_cada_categoria_tem_texto_proprio():
    """Duas categorias com o mesmo texto seriam uma categoria só disfarçada."""
    textos = list(POR_CATEGORIA.values())
    assert len(set(textos)) == len(textos)


@pytest.mark.parametrize("categoria,marca", [
    ("Adaptação", "adaptação"),
    ("Pedagógico", "pedagógica"),
    ("Rotina", "integral"),
    ("Estrutura", "estrutura"),
    ("Mudança", "cidade nova"),
])
def test_a_variante_retoma_o_assunto_da_familia(categoria, marca):
    assert marca in texto_d1(3, categoria).lower()


def test_categoria_preco_nao_oferece_a_via_por_aqui():
    """🚨 Valor não se negocia por escrito — só esta variante fecha em ligação."""
    t = texto_d1(3, "Preço")
    assert "por aqui" not in t.lower()
    assert "ligar" in t.lower()


def test_categoria_ausente_cai_no_fallback_neutro():
    """Motivo não informado não pode virar afirmação sobre a vida da família."""
    assert texto_d1(3, None) == POR_CATEGORIA["Outro"]
    assert texto_d1(3, "") == POR_CATEGORIA["Outro"]
    assert texto_d1(3, "categoria que não existe") == POR_CATEGORIA["Outro"]


def test_so_a_origem_3_varia_por_categoria():
    """Passar categoria numa origem que não usa não pode mudar o texto."""
    for n in (1, 2, 4, 5, 6, 7, 8, 9):
        assert texto_d1(n, "Adaptação") == texto_d1(n, None)


# ── os passos ────────────────────────────────────────────────────────
def test_o_primeiro_disparo_e_23h():
    assert HORAS["d1"] == 23
    assert passos(1)[0]["h"] == 23


def test_o_encerramento_e_d13_e_nao_d10():
    """🚨 A despedida sai no D+10; a perda só três dias depois. Quem responde à
    despedida ainda é lead."""
    p = passos(1)
    assert p[-1]["h"] == HORAS["fim"] == 312
    assert p[-1]["perda"] == MOTIVO_PERDA_ESGOTOU


def test_o_passo_de_perda_nao_manda_mensagem():
    """Mandar texto no D+13 seria despedir-se duas vezes."""
    assert passos(1)[-1]["msg"] is None


def test_sao_quatro_mensagens_mais_o_encerramento():
    p = passos(1)
    assert len(p) == 5
    assert sum(1 for x in p if x["msg"]) == 4


def test_a_tentativa_e_numero_nao_etapa():
    """🚨 O quadro perdeu as cinco colunas de tentativa: a contagem virou campo."""
    assert [x["tentativa"] for x in passos(1)] == [1, 2, 3, 4, 5]
    assert all("etapa" not in x for x in passos(1))


def test_o_d1_muda_por_origem_e_o_resto_e_comum():
    a, b = passos(4), passos(8)
    assert a[0]["msg"] != b[0]["msg"]                              # D+1 é próprio
    assert [p["msg"] for p in a[1:]] == [p["msg"] for p in b[1:]]  # o resto igual


def test_as_horas_sao_cumulativas_e_crescentes():
    h = [x["h"] for x in passos(1)]
    assert h == sorted(h) and len(set(h)) == 5


def test_nenhum_d1_repete_texto():
    """Duas origens com o mesmo texto seriam uma origem só disfarçada."""
    textos = [texto_d1(c["n"]) for c in CASCATAS]
    assert len(set(textos)) == len(textos)

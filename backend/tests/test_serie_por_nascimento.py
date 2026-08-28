"""A série sai de CONTA, nunca de palpite do modelo.

O Augusto pediu isso porque "a atual sempre erra". Ela erra porque o MODELO faz
a conta — mesmo defeito dos dias da semana, que ele errou em 3 de 3.

🚨 O erro aqui é caro de um jeito específico: a família ouve que o filho entra
este ano quando entra no que vem, e planeja a vida em cima disso. Um dia de
diferença no nascimento muda o ano letivo inteiro.

A regra é nacional e é uma data: 6 anos completos até 31 de março do ano letivo
para o 1º ano (CNE/CEB 2/2018).
"""
import pytest

from services.agenda_tools import (
    CORTE_DIA,
    CORTE_MES,
    SERIE_POR_IDADE,
    build_serie_tool_schema,
    calcular_serie,
)


def serie(nasc, ano=2027):
    return calcular_serie(nasc, ano).get("serie")


def idade(nasc, ano=2027):
    return calcular_serie(nasc, ano).get("idade_no_corte")


# ── a borda: é ela que gera a dúvida das famílias ────────────────────
def test_nascido_EM_31_03_entra_no_ano():
    """Faz 6 anos NO dia do corte — 'até 31/03' inclui o 31/03."""
    assert idade("2020-03-31", 2026) == 6
    assert serie("2020-03-31", 2026) == "1º ano do Ensino Fundamental"


def test_nascido_EM_01_04_espera_um_ano_inteiro():
    """🚨 Um dia depois, e o filho só entra no ano seguinte. É a dúvida que o
    Marcos descreveu: 'os pais têm dúvida se pode ou não matricular no 1º ano'."""
    assert idade("2020-04-01", 2026) == 5
    assert serie("2020-04-01", 2026) == "Jardim II"
    assert serie("2020-04-01", 2027) == "1º ano do Ensino Fundamental"


@pytest.mark.parametrize("dia,esperado", [
    ("2020-03-29", 6), ("2020-03-30", 6), ("2020-03-31", 6),
    ("2020-04-01", 5), ("2020-04-02", 5), ("2020-04-03", 5),
])
def test_cada_dia_ao_redor_do_corte(dia, esperado):
    assert idade(dia, 2026) == esperado


def test_o_corte_e_31_de_marco():
    assert (CORTE_MES, CORTE_DIA) == (3, 31)


# ── a tabela inteira ─────────────────────────────────────────────────
@pytest.mark.parametrize("anos,esperado", sorted(SERIE_POR_IDADE.items()))
def test_toda_idade_da_tabela_devolve_a_serie_certa(anos, esperado):
    """Nascido em 01/01, faz aniversário antes do corte: idade = ano - nascimento."""
    assert serie(f"{2027 - anos}-01-01", 2027) == esperado


def test_a_tabela_cobre_do_jardim_ao_terceiro_do_medio():
    """A faixa que o CCDA atende. Fora dela a resposta é 'confirmo pessoalmente',
    não um palpite."""
    assert min(SERIE_POR_IDADE) == 4
    assert max(SERIE_POR_IDADE) == 17
    assert SERIE_POR_IDADE[4] == "Jardim I"
    assert SERIE_POR_IDADE[17] == "3ª série do Ensino Médio"


def test_nao_ha_buraco_na_tabela():
    """Idade sem série viraria 'fora da faixa' no meio do Fundamental."""
    assert sorted(SERIE_POR_IDADE) == list(range(4, 18))


# ── fora da faixa e entradas ruins ───────────────────────────────────
def test_muito_novo_NAO_e_recusa_e_sim_um_ano_futuro():
    """Abaixo da idade mínima a criança ENTRA — só que depois. Ver o bloco do
    caso real no fim deste arquivo: responder "não elegível" e encerrar foi o que
    perdeu uma matrícula que já estava decidida."""
    r = calcular_serie("2025-01-01", 2027)
    assert r["serie"] is None
    assert r["entra_em"] == 2029
    assert "A criança ENTRA" in r["orientacao"]


def test_muito_velho_nao_inventa_serie():
    r = calcular_serie("2000-01-01", 2027)
    assert r["serie"] is None
    assert "confirma pessoalmente" in r["orientacao"]


@pytest.mark.parametrize("ruim", ["31/03/2020", "ontem", "", "2020-13-45", "abc"])
def test_data_invalida_devolve_erro_e_nao_estoura(ruim):
    """A ferramenta caindo derrubaria a conversa. Erro é resposta, não exceção."""
    assert "erro" in calcular_serie(ruim, 2027)


def test_nascimento_depois_do_corte_e_recusado():
    """Criança que nem nasceu no ano letivo pedido."""
    assert "erro" in calcular_serie("2028-01-01", 2027)


def test_29_de_fevereiro_nao_quebra():
    """Ano bissexto é o caso que costuma estourar em conta de idade."""
    r = calcular_serie("2020-02-29", 2027)
    assert "erro" not in r
    assert r["idade_no_corte"] == 7


# ── o caso de borda é EXPLICADO, não só calculado ────────────────────
def test_aniversario_depois_do_corte_traz_observacao():
    """🚨 A família quase sempre acha que conta. Dizer a data do corte em voz
    alta é o que evita a conversa terminar com ela achando outra coisa."""
    r = calcular_serie("2020-06-15", 2027)
    assert "31/03" in r["observacao"]


def test_aniversario_antes_do_corte_nao_precisa_de_observacao():
    """Aviso em todo caso vira ruído e a família para de ler."""
    assert "observacao" not in calcular_serie("2020-01-10", 2027)


def test_a_data_de_corte_volta_na_resposta():
    """Para a agente poder citá-la sem recalcular."""
    assert calcular_serie("2020-01-10", 2027)["data_corte"] == "31/03/2027"


# ── o schema proíbe o modelo de fazer a conta ────────────────────────
def test_o_schema_proibe_o_modelo_de_calcular():
    d = build_serie_tool_schema()["function"]["description"]
    assert "NUNCA calcule a série você mesmo" in d
    assert "um dia de diferença muda o ano letivo" in d


def test_o_schema_manda_usar_quando_perguntam_do_primeiro_ano():
    """É a pergunta literal que as famílias fazem."""
    assert "já pode entrar no 1º ano" in build_serie_tool_schema()["function"]["description"]


def test_ano_letivo_e_obrigatorio_no_schema():
    """Sem ele a mesma criança teria duas respostas certas e o modelo escolheria."""
    assert build_serie_tool_schema()["function"]["parameters"]["required"] == [
        "data_nascimento", "ano_letivo",
    ]


# ── fora do corte é um QUANDO, não um NÃO ────────────────────────────
# Conversa real do atendimento atual da escola (28/08, 19:29). Criança nascida em
# 02/04/2022, dois dias depois do corte:
#
#     "Pelas informações fornecidas, seu filho ainda não é elegível para o Jardim I."
#     "Infelizmente, ele terá que aguardar mais um ano para iniciar."
#     "Você tem mais dúvidas ou gostaria de mais alguma informação sobre outro assunto?"
#
# Três frases e a família foi embora. Mas essa criança entra no Jardim I em 2027 —
# é matrícula do ano que vem, não recusa. Nenhuma instrução de tom no prompt
# salva uma ferramenta que devolve só "não elegível".
CASO_REAL = "2022-04-02"


def test_o_caso_real_devolve_o_ano_em_que_a_crianca_ENTRA():
    r = calcular_serie(CASO_REAL, 2026)
    assert r["serie"] is None
    assert r["entra_em"] == 2027
    assert r["serie_quando_entrar"] == "Jardim I"


def test_no_ano_seguinte_ela_realmente_entra():
    """A promessa da orientação tem de se cumprir — senão a agente marca um ano
    que, chegando lá, dá 'não elegível' de novo."""
    assert calcular_serie(CASO_REAL, 2027)["serie"] == "Jardim I"


def test_a_orientacao_PROIBE_o_infelizmente():
    """🚨 A palavra do atendimento que perdeu a família."""
    o = calcular_serie(CASO_REAL, 2026)["orientacao"]
    assert "NUNCA use 'infelizmente'" in o
    assert "A criança ENTRA" in o


def test_a_orientacao_manda_NAO_encerrar():
    """O atendimento real perguntou 'quer informação sobre outro assunto?' e
    encerrou. Era matrícula do ano que vem indo embora."""
    o = calcular_serie(CASO_REAL, 2026)["orientacao"]
    assert "Nunca encerre a conversa" in o
    assert "ofereça continuar o contato" in o


def test_a_orientacao_manda_reconhecer_a_proximidade_do_corte():
    """Dois dias parecem injustos, e a família precisa sentir que alguém entende."""
    assert "dois dias parecem injustos" in calcular_serie(CASO_REAL, 2026)["orientacao"]


@pytest.mark.parametrize("nasc,ano,entra", [
    ("2022-04-02", 2026, 2027),   # falta 1 ano
    ("2023-04-02", 2026, 2028),   # faltam 2
    ("2024-01-10", 2026, 2028),   # faltam 2 (aniversário antes do corte)
])
def test_calcula_quantos_anos_faltam(nasc, ano, entra):
    assert calcular_serie(nasc, ano)["entra_em"] == entra


def test_idade_ACIMA_da_faixa_nao_promete_ano_nenhum():
    """Quem já passou do 3º do Médio não 'entra depois' — aí é confirmar
    pessoalmente, e prometer um ano seria mentira."""
    r = calcular_serie("2000-01-01", 2027)
    assert "entra_em" not in r
    assert "confirma pessoalmente" in r["orientacao"]


def test_a_regra_e_apresentada_como_do_CALENDARIO_nao_do_colegio():
    """Soar como decisão do colégio faz a família achar que há o que negociar,
    e a conversa vira disputa em vez de agendamento."""
    assert "não uma decisão do colégio" in calcular_serie("2020-06-15", 2027)["observacao"]

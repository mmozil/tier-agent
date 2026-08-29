"""A primeira fala é a única que a pessoa espera de olho na tela.

🚨 Medido em produção: o modelo escreveu um período longo sem ponto, a primeira
fala saiu com 281 caracteres, e o Kokoro levou 6,5s só nela — segurando a fila e
atrasando o turno SEGUINTE junto. O tempo do TTS cresce com o texto (6 chars =
1,03s · 171 chars = 2,00s), então frase comprida no início é o pior lugar.
"""
import os

for _k, _v in {
    "DATABASE_URL": "postgresql+asyncpg://x:x@localhost/x",
    "JWT_SECRET": "x" * 32,
    "FERNET_KEY": "ZmFrZS1mZXJuZXQta2V5LWZvci11bml0LXRlc3RzLTAxMg=",
    "REDIS_URL": "redis://localhost:6379/0",
}.items():
    os.environ.setdefault(_k, _v)

from routes.public_chat import PRIMEIRA_FALA_MAX, _partir_em_falas


def test_periodo_longo_sem_ponto_nao_vira_primeira_fala_gigante():
    t = ("Nossa plataforma cuida de toda a operação da empresa, do cadastro do cliente "
         "até a emissão da nota fiscal, passando por estoque, pedidos, cobrança e "
         "conciliação bancária, tudo na mesma base de dados sem integração externa")
    assert len(t) > 200
    f = _partir_em_falas(t)
    assert len(f[0]) <= PRIMEIRA_FALA_MAX


def test_corta_na_virgula_e_nao_no_meio_da_palavra():
    t = "a" * 60 + ", " + "b" * 200
    f = _partir_em_falas(t)
    assert f[0].endswith(",")
    assert f[1].startswith("b")


def test_nada_se_perde_no_corte():
    t = ("Podemos sim emitir a nota, o sistema já sai configurado com IBS e CBS, "
         "e o contador recebe o arquivo todo mês sem precisar pedir")
    inteiro = " ".join(_partir_em_falas(t)).replace(" ", "")
    assert inteiro == t.replace(" ", "")


def test_frase_curta_fica_intacta():
    t = "Claro! O valor é 1.400 por mês."
    assert _partir_em_falas(t) == [t]


def test_sem_virgula_util_nao_corta_no_susto():
    """Sem pausa natural, cortar seria inventar uma. Melhor uma fala longa que
    uma frase partida no meio de um sintagma."""
    t = "x" * 260
    f = _partir_em_falas(t)
    assert f[0] == t


def test_o_teto_de_falas_continua_valendo():
    t = ". ".join(f"frase numero {i} com corpo suficiente para nao colar" for i in range(9)) + "."
    assert len(_partir_em_falas(t, maximo=4)) <= 4

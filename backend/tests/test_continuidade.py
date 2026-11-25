"""A conversa que já começou (25/11/2026, CCDA): apresentação só na abertura, e o freio «anuncia e para»."""

import asyncio
import inspect

import pytest

from services import continuidade as K
from services.tier_engine import anuncia_e_para, visita_ja_marcada

PERSONA = (
    "Você é a Nathalia.\n"
    "[[abertura]]\n##PRIMEIRA MENSAGEM\n\"Oi meu nome é Nathalia\"\n[[/abertura]]\n"
    "Regra fixa.\n"
    "[[em_andamento]]\n18. Continue a conversa.\n[[/em_andamento]]\n"
    "Fim."
)
DISPARO = (
    "Bom dia, Debora! Tudo bem?\nAqui é a Nathalia, do Colégio CCDA.\n\nVocês vieram nos conhecer no ano passado, e estou "
    "passando para saber se estão procurando escola para 2027.\n\nPosso reservar um horário para vocês?"
)


def test_abertura_so_em_conversa_nova():
    p = K.persona_da_conversa(PERSONA, False)
    assert "Oi meu nome é Nathalia" in p and "Continue a conversa" not in p and "[[" not in p
    assert "Você é a Nathalia." in p and "Regra fixa." in p and p.endswith("Fim.")


def test_em_andamento_nao_ve_a_apresentacao():
    p = K.persona_da_conversa(PERSONA, True)
    assert "Oi meu nome é Nathalia" not in p and "PRIMEIRA MENSAGEM" not in p
    assert "18. Continue a conversa." in p and "[[" not in p


@pytest.mark.parametrize("persona", ["", None, "Persona comum", "[[dentro]]x[[/dentro]]", "[[abertura]] sem fim"])
def test_persona_sem_marcacao_passa_igual(persona):
    assert K.tem_marcas(persona) is False
    assert K.persona_da_conversa(persona, True) == persona
    assert K.persona_da_conversa(persona, False) == persona


def test_varias_marcas_e_texto_com_colchetes():
    p = "[[abertura]]A[[/abertura]] meio [link] [[abertura]]B[[/abertura]] [[em_andamento]]C[[/em_andamento]]"
    assert K.persona_da_conversa(p, False) == "A meio [link] B "
    assert K.persona_da_conversa(p, True) == " meio [link]  C"


@pytest.mark.parametrize(
    "hist,esperado",
    [
        ([], False),
        (None, False),
        ([{"role": "user", "content": "oi"}], False),
        ([{"role": "assistant", "content": "  "}], False),
        ([{"role": "assistant", "content": DISPARO}], True),
        ([{"role": "user", "content": "oi"}, {"role": "assistant", "content": "Olá"}], True),
    ],
)
def test_ja_falamos(hist, esperado):
    assert K.ja_falamos(hist) is esperado


def test_bloco_traz_a_ultima_mensagem_nossa_e_as_instrucoes():
    b = K.bloco([{"role": "assistant", "content": DISPARO}])
    assert b.startswith("\n\n# Esta conversa JÁ está em andamento")
    assert "Posso reservar um horário para vocês?" in b and "\n\nVocês vieram" not in b  # numa linha só
    assert "não diga de novo seu nome" in b and "SÓ um cumprimento" in b and "sem pontuação" in b


def test_bloco_usa_a_mais_recente_e_corta_texto_longo():
    b = K.bloco([{"role": "assistant", "content": "primeira"}, {"role": "user", "content": "x"}, {"role": "assistant", "content": "b" * 2000}])
    assert "primeira" not in b and "…»" in b and len(b) < 2200


def test_bloco_com_a_equipe():
    b = K.bloco([{"role": "assistant", "content": "IA"}], [f"fala {i}" for i in range(6)])
    assert "A equipe também já escreveu" in b and "fala 5" in b and "fala 1»" not in b
    assert "«fala 2»" in b


def test_bloco_vazio_em_conversa_nova():
    assert K.bloco([]) == "" and K.bloco(None) == "" and K.bloco([{"role": "user", "content": "oi"}], []) == ""


def test_bloco_so_com_fala_da_equipe():
    assert "A equipe também" in K.bloco([], ["Olá, tudo bem?"])


class _R:
    def __init__(self, linhas):
        self._l = linhas

    def first(self):
        return self._l[0] if self._l else None

    def all(self):
        return self._l


class _Db:
    def __init__(self, linhas=None, erro=None):
        self.linhas, self.erro, self.sql = linhas or [], erro, None

    async def execute(self, sql, params=None):
        self.sql, self.params = str(sql), params
        if self.erro:
            raise self.erro
        return _R(self.linhas)


def test_em_andamento_olha_o_banco_e_nao_levanta():
    assert asyncio.run(K.em_andamento(_Db([(1,)]), 10)) is True
    assert asyncio.run(K.em_andamento(_Db([]), 10)) is False
    assert asyncio.run(K.em_andamento(_Db(erro=RuntimeError("x")), 10)) is False
    db = _Db([])
    assert asyncio.run(K.em_andamento(db, 10, [{"role": "assistant", "content": "oi"}])) is True
    assert db.sql is None  # o histórico já respondeu: não vai ao banco
    d2 = _Db([])
    asyncio.run(K.em_andamento(d2, 10))
    assert "'assistant', 'agent'" in d2.sql and d2.params == {"c": 10}


def test_falas_da_equipe_na_ordem_e_sem_modelo():
    db = _Db([("segunda",), ("primeira",)])
    assert asyncio.run(K.falas_da_equipe(db, 5)) == ["primeira", "segunda"]
    assert "NOT LIKE :d" in db.sql and db.params["d"].startswith("Disparo") and db.params["m"].startswith("Modelo")
    assert asyncio.run(K.falas_da_equipe(_Db(erro=RuntimeError("x")), 5)) == []


def test_runtime_e_teste_do_painel_usam_o_mesmo():
    from routes import agents
    from services import agent_runtime

    fonte = inspect.getsource(agent_runtime)
    i = fonte.index("system_prompt = persona_efetiva(agent)")
    assert fonte.index("continuidade.persona_da_conversa(system_prompt", i) < fonte.index("build_rag_block(db, agent.id", i)
    assert fonte.index("continuidade.bloco(history", i) < fonte.index("reply = await tier_engine.send_message", i)
    painel = inspect.getsource(agents)
    assert "continuidade.persona_da_conversa(system" in painel and "continuidade.bloco(history)" in painel


# ─── o freio «anuncia e para» ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "frase",
    [
        "Bom dia, Débora! Tudo bem? Vcs ainda estão procurando escola pra 2027?",
        "Obrigada por avisar, Andreia! Se no futuro estiverem procurando uma escola, estaremos aqui.",
        "Entendo! Você está buscando o período integral ou meio período?",
        "Que bom que vocês continuam olhando com carinho para o colégio.",
        "Se em algum momento vocês quiserem conhecer o CCDA, será um prazer.",
        "Para as famílias que seguem pesquisando, a visita ajuda muito.",
        "Aguardamos vocês de braços abertos.",
        "Aguardaremos vocês em 2028.",
        "A temperatura do aquecimento é controlada.",
    ],
)
def test_freio_nao_pega_a_vida_do_cliente(frase):
    assert anuncia_e_para(frase) is False, frase


@pytest.mark.parametrize(
    "frase",
    [
        "Deixa eu ver aqui para você.",
        "Um momento, por favor.",
        "Só um instante!",
        "Vou verificar os horários e já te falo.",
        "Verificando a agenda…",
        "Claro! Consultando os horários disponíveis.",
        "Estou consultando a agenda agora.",
        "Tô conferindo aqui, tá?",
        "Aguarde, por favor.",
        "Peraí que eu confiro.",
        "Já te passo os horários.",
        "Certo.\nBuscando os horários de quinta.",
        "Ok, já verificando pra vc.",
    ],
)
def test_freio_continua_pegando_o_anuncio(frase):
    assert anuncia_e_para(frase) is True, frase


def test_freio_vazio():
    assert anuncia_e_para(None) is False and anuncia_e_para("") is False


# ─── «Confirmado!» respondendo à nossa confirmação ───────────────────────────


@pytest.mark.parametrize(
    "nossa,esperado",
    [
        ("Olá, Beatriz! Passando para confirmar que sua visita está agendada para 📅 18/11 às 14:00.", True),
        ("Passando para lembrar que sua visita ao CCDA está confirmada para hoje às 14:30.", True),
        ("Por gentileza, confirme sua presença respondendo com SIM.", True),
        ("Para o dia 19/11 tenho 08:30, 09:30 ou 10:00. Qual horário fica melhor?", False),
        ("Ainda tenho alguns horários de visita. Qual dia fica melhor?", False),
        ("Vi que vocês não conseguiram vir na visita que estava agendada.", False),
    ],
)
def test_visita_ja_marcada(nossa, esperado):
    assert visita_ja_marcada([{"role": "assistant", "content": nossa}]) is esperado
    assert visita_ja_marcada([{"role": "assistant", "content": nossa}, {"role": "user", "content": "Confirmado"}]) is esperado


def test_visita_ja_marcada_olha_so_a_ultima_nossa():
    h = [{"role": "assistant", "content": "sua visita está agendada para 18/11"}, {"role": "assistant", "content": "Qual dia fica melhor?"}]
    assert visita_ja_marcada(h) is False
    assert visita_ja_marcada(None) is False and visita_ja_marcada([]) is False


def test_freio_de_confirmacao_usa_a_guarda():
    from services import tier_engine

    f = inspect.getsource(tier_engine.send_message)
    assert "visita_ja_marcada(history)" in f

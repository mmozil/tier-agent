"""O pronome preso ao verbo — "ajudá-lo", "assisti-lo".

🚨 O dono ouviu na tela de voz e foi direto: "assisti o quê? Parece uma TV.
Esse termo não usamos aqui no Brasil." Em atendimento brasileiro a ênclise soa a
filme dublado, e "assistir alguém", aqui, é assistir televisão.

A persona já proíbe — mas proibição em prompt é pedido, não garantia: medido, de
cinco saudações quatro obedeceram e uma escapou. Numa frase que todo cliente
ouve na primeira interação, uma em cinco é muito.
"""
import os

for _k, _v in {
    "DATABASE_URL": "postgresql+asyncpg://x:x@localhost/x",
    "JWT_SECRET": "x" * 32,
    "FERNET_KEY": "ZmFrZS1mZXJuZXQta2V5LWZvci11bml0LXRlc3RzLTAxMg=",
    "REDIS_URL": "redis://localhost:6379/0",
}.items():
    os.environ.setdefault(_k, _v)

import pytest

from services.tier_engine import _sem_enclise, _strip_thinking


@pytest.mark.parametrize("antes,depois", [
    ("Como posso ajudá-lo hoje?", "Como posso ajudar hoje?"),
    ("Estou aqui para assisti-lo.", "Estou aqui para ajudar."),
    ("Posso atendê-la agora.", "Posso atender agora."),
    ("Vamos auxiliá-los no processo.", "Vamos auxiliar no processo."),
    ("Preciso informá-lo do prazo.", "Preciso informar do prazo."),
])
def test_troca_o_pronome_preso(antes, depois):
    assert _sem_enclise(antes) == depois


def test_no_comeco_da_frase_mantem_a_maiuscula():
    assert _sem_enclise("Ajudá-lo é o que fazemos.") == "Ajudar é o que fazemos."


def test_nao_mexe_em_verbo_fora_da_lista():
    """🚨 A lista é fechada de propósito. Regex genérico de -lo pegaria
    construção legítima, e reescrever o modelo por engano é pior que a ênclise."""
    assert _sem_enclise("É preciso lê-lo antes de assinar.") == "É preciso lê-lo antes de assinar."
    assert _sem_enclise("Vou fazê-lo agora.") == "Vou fazê-lo agora."


def test_nao_mexe_no_verbo_solto():
    assert _sem_enclise("Posso ajudar com a nota fiscal.") == "Posso ajudar com a nota fiscal."
    assert _sem_enclise("Vamos assistir ao treinamento.") == "Vamos assistir ao treinamento."


def test_entra_no_caminho_de_toda_resposta():
    """A limpeza mora no `_strip_thinking`, por onde passa TODA resposta do
    modelo — inclusive as das segundas chances e dos freios."""
    assert _strip_thinking("<think>x</think>Como posso ajudá-lo?") == "Como posso ajudar?"


def test_texto_vazio_nao_quebra():
    assert _sem_enclise("") == ""
    assert _sem_enclise(None) == ""

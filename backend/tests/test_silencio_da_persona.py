"""Silêncio de propósito (15/11/2026, M7).

A persona da M7 manda não responder depois da primeira mensagem em horário comercial. O
modelo que obedece devolve o sinal `[SILENCIO]`; o motor não pode trocá-lo pela frase
genérica de fallback, e o runtime não pode enviá-lo ao cliente.
"""

from types import SimpleNamespace

from services import agent_runtime, tier_engine


def test_reconhece_o_sinal_com_variacoes():
    for t in ["[SILENCIO]", " [silencio] ", "[SILÊNCIO]", "[ silencio ].", '"[SILENCIO]"']:
        assert tier_engine.eh_silencio(t), t


def test_nao_confunde_resposta_normal_com_silencio():
    for t in [
        "",
        None,
        "Certo! Me avisa se precisar de mais alguma coisa.",
        "Fico em silêncio até a equipe assumir [SILENCIO]",
        "[SILENCIO] mas antes: o preço é R$ 10",
    ]:
        assert not tier_engine.eh_silencio(t), t


def test_diretrizes_ensinam_o_sinal_so_quando_a_persona_manda():
    agent = SimpleNamespace(persona="Você é a Isa.", system_prompt=None, template_kind="")
    d = agent_runtime.build_base_directives(agent, connector_kind="whatsapp_cloud")
    assert "[SILENCIO]" in d
    assert "só quando a persona mandar" in d

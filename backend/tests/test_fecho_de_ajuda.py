"""Corte do fecho genérico de ajuda (CCDA, 15/11/2026). Casos reais do ensaio do agente 26."""

import asyncio

from services import fecho_de_ajuda as f


def test_corta_as_ofertas_genericas_do_fim():
    casos = {
        "É um benefício incluso na mensalidade. Se precisar de mais detalhes, estou aqui para ajudar!": (
            "É um benefício incluso na mensalidade."
        ),
        "De nada! Se precisar de mais informações ou tiver outras dúvidas, é só me chamar.": "De nada!",
        "O integral vai das 7h às 19h. Se precisar de mais alguma informação ou quiser agendar uma visita, é só me "
        "avisar. Estou aqui para ajudar!": "O integral vai das 7h às 19h.",
        "As férias são só em dezembro.\n\nSe precisar de mais informações, estou à disposição!": (
            "As férias são só em dezembro."
        ),
        "De nada! Se tiver mais alguma dúvida, é só me chamar. Estou aqui para ajudar! 😊": "De nada!",
    }
    for entrada, esperado in casos.items():
        assert f.cortar(entrada) == esperado


def test_nao_corta_o_que_faz_a_conversa_andar():
    fica = [
        # mensagem padrão do CCDA com o link: termina em pergunta
        "Acesse o link: https://www.ccda.com.br/agendamento-de-visita/ Se tiver qualquer dúvida, estou aqui. "
        "Me avisa se foi tudo certinho?",
        "São inclusas. Se precisar de mais informações sobre o programa, posso te enviar um link com mais detalhes.",
        "O horário é das 13h às 17h50. Ficou tudo claro?",
        "Se quiser agendar uma visita, é só me avisar.",
        "Pelo telefone (11) 4043-0461. Se preferir, posso ver os horários livres para você por aqui.",
        # a resposta é SÓ a oferta: não sai mensagem vazia
        "Se precisar de mais alguma informação, estou aqui para ajudar.",
        "",
    ]
    for t in fica:
        assert f.cortar(t) == t
    assert f.cortar(None) is None


def test_desligado_sem_parametro_e_em_erro():
    class _Db:
        def __init__(self, valor=None, erro=False):
            self.valor, self.erro = valor, erro

        async def execute(self, *_a, **_k):
            if self.erro:
                raise RuntimeError("banco fora")
            return type("R", (), {"scalar": lambda _s: self.valor})()

    assert asyncio.run(f.ligado(_Db("1"), 26)) is True
    assert asyncio.run(f.ligado(_Db(None), 26)) is False
    assert asyncio.run(f.ligado(_Db("0"), 26)) is False
    assert asyncio.run(f.ligado(_Db(erro=True), 26)) is False
    assert asyncio.run(f.ligado(_Db("1"), None)) is False


def test_so_oferta_separa_resposta_inteira_de_fecho():
    assert f.so_oferta("Se precisar de mais informações ou quiser agendar uma visita, estou aqui para ajudar.")
    assert f.so_oferta("Se tiver mais alguma dúvida, é só me chamar. Estou aqui para ajudar! 😊")
    assert not f.so_oferta("De nada! Se precisar de mais informações, é só me chamar.")
    assert not f.so_oferta("O horário é das 13h às 17h50. Ficou tudo claro?")
    assert not f.so_oferta("")
    assert not f.so_oferta(None)


def test_aplicar_reescreve_so_quando_a_resposta_inteira_e_a_oferta():
    from types import SimpleNamespace

    oferta = "Se precisar de mais alguma informação ou tiver dúvidas, estou aqui para ajudar!"
    chamadas = []

    def gerador(resposta=None, erro=False):
        async def gerar(conteudo, hist):
            chamadas.append((conteudo, hist))
            if erro:
                raise RuntimeError("motor fora")
            return SimpleNamespace(text=resposta, tokens_in=10, tokens_out=5)

        return gerar

    def rodar(texto, msg, gerar, ferramentas=None):
        return asyncio.run(
            f.aplicar(texto, ferramentas_usadas=ferramentas, mensagem_do_cliente=msg, history=[], gerar=gerar)
        )

    # reescrita boa: troca, e o modelo viu a resposta que não podia sair
    texto, extra = rodar(oferta, "Entendi", gerador("Que bom! Qual período vocês estão pensando?"))
    assert texto == "Que bom! Qual período vocês estão pensando?" and extra.tokens_in == 10
    assert chamadas[-1][0] == f.CORRECAO and chamadas[-1][1][-1] == {"role": "assistant", "content": oferta}
    # reescrita insistiu na oferta: família agradeceu → «De nada!»; não agradeceu → fica a original
    assert rodar(oferta, "Entendi, obrigado", gerador(oferta))[0] == "De nada!"
    assert rodar(oferta, "Ok", gerador(oferta))[0] == oferta
    # motor falhou: mesma regra
    assert rodar(oferta, "Valeu!", gerador(erro=True))[0] == "De nada!"
    # turno usou ferramenta: não chama de novo
    n = len(chamadas)
    assert rodar(oferta, "ok", gerador("x"), ferramentas=[{"name": "agenda"}])[0] == oferta and len(chamadas) == n
    # resposta normal com fecho: só corta, sem chamar o motor
    assert (
        rodar("De nada! Se precisar de mais informações, é só me chamar.", "obrigada", gerador("x"))[0] == ("De nada!")
        and len(chamadas) == n
    )

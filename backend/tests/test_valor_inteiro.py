"""O preço chega inteiro no WhatsApp (25/11/2026, CCDA): «R$» e o número nunca ficam em linhas diferentes."""

from services.agent_runtime import _format_for_whatsapp, _valor_inteiro

NB = "\u00a0"


def test_espaco_comum_vira_espaco_que_nao_quebra():
    assert _valor_inteiro("fica R$ 1.086,55.") == f"fica R${NB}1.086,55."


def test_colado_e_com_espaco_a_mais_ficam_iguais():
    for t in ("R$1.275,62", "R$  1.275,62", f"R${NB}1.275,62"):
        assert _valor_inteiro(t) == f"R${NB}1.275,62"


def test_varios_valores_e_o_resto_do_texto_intacto():
    t = "Mensalidade: R$ 1.086,55\nIntegral: R$ 1.611,47\nTotal: R$ 2.698,02"
    assert _valor_inteiro(t) == f"Mensalidade: R${NB}1.086,55\nIntegral: R${NB}1.611,47\nTotal: R${NB}2.698,02"
    assert _valor_inteiro("sem preço, só R$ e US$ 10") == "sem preço, só R$ e US$ 10"


def test_passa_pelo_formato_do_whatsapp_com_negrito_e_lista():
    assert _format_for_whatsapp("- **R$ 99,90** por mês") == f"• *R${NB}99,90* por mês"


def test_texto_sem_preco_nao_muda():
    t = "Bom dia! A visita é dia 26/11, às 09:00."
    assert _format_for_whatsapp(t) == t

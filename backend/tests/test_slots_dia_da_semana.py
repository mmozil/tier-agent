"""O dia da semana sai do SERVIDOR, não da cabeça do modelo.

Numa conversa real (28/08/2026), o agente ofereceu "Domingo 31/08". A família
corrigiu. Ele pediu desculpa e ofereceu "Sábado 31/08". Errado de novo — 31/08 é
SEGUNDA. E "Terça 02/09", que é QUARTA. Nenhum dos três acertou.

Não era alucinação isolada: a ferramenta devolvia só a data ISO, e deduzir o dia
da semana ficava com o modelo. Dia da semana é conta, e conta quem faz é quem
tem o calendário.
"""
import pytest

from services.agenda_tools import _dia_br, _dia_da_semana, summarize_slots


def payload(*dias):
    return {"slots": [
        {"disponivel": True, "dia": d, "hora": "09:00", "inicio": f"{d}T09:00"} for d in dias
    ]}


# ── a conta ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("iso,esperado", [
    ("2026-08-29", "sábado"),
    ("2026-08-30", "domingo"),
    ("2026-08-31", "segunda-feira"),
    ("2026-09-01", "terça-feira"),
    ("2026-09-02", "quarta-feira"),
    ("2026-09-03", "quinta-feira"),
    ("2026-09-04", "sexta-feira"),
])
def test_cada_dia_da_semana(iso, esperado):
    assert _dia_da_semana(iso) == esperado


def test_os_tres_dias_que_o_agente_errou_na_conversa_real():
    """🚨 O caso que originou este teste, com as datas exatas."""
    assert _dia_da_semana("2026-08-31") == "segunda-feira"   # ele disse domingo, depois sábado
    assert _dia_da_semana("2026-09-02") == "quarta-feira"    # ele disse terça


def test_data_invalida_nao_derruba_a_ferramenta():
    """Sem dia da semana o modelo ainda oferece o horário; com exceção, não
    oferece nada — e a família fica sem resposta."""
    assert _dia_da_semana("não é data") == ""
    assert _dia_da_semana("") == ""


def test_formato_br():
    assert _dia_br("2026-09-02") == "02/09"


# ── o que o modelo recebe ────────────────────────────────────────────
def test_o_resumo_entrega_semana_e_dia_br():
    r = summarize_slots(payload("2026-08-31", "2026-09-02"), "2026-08-31")
    assert [d["semana"] for d in r["dias"]] == ["segunda-feira", "quarta-feira"]
    assert [d["dia_br"] for d in r["dias"]] == ["31/08", "02/09"]


def test_a_instrucao_proibe_o_modelo_de_calcular():
    """Entregar o dado não basta: sem a instrução o modelo continua deduzindo."""
    r = summarize_slots(payload("2026-08-31"), "2026-08-31")
    assert "nunca calcule isso você mesmo" in r["instrucao"]


def test_a_instrucao_pinta_o_formato_do_DOCUMENTO():
    """🚨 O v3 manda oferecer 'Dia 00/00 às 00h', SEM dia da semana. O agente
    dizendo "Domingo 31/08" estava errado duas vezes: o dia estava errado E não
    devia estar ali. Dia da semana no documento só aparece para combinar
    LIGAÇÃO ("te ligo na segunda-feira"), nunca para oferecer visita."""
    i = summarize_slots(payload("2026-08-31"), "2026-08-31")["instrucao"]
    assert "Dia {dia_br} às {hora}" in i
    assert "NÃO diga o dia da semana ao oferecer visita" in i


def test_semana_continua_no_payload_para_quem_pergunta():
    """Some da oferta, não do dado: se a família perguntar que dia da semana é,
    a resposta tem de sair certa em vez de o modelo voltar a deduzir."""
    r = summarize_slots(payload("2026-08-31"), "2026-08-31")
    assert r["dias"][0]["semana"] == "segunda-feira"


def test_a_data_iso_continua_no_resumo():
    """`agendar_visita` usa `inicio` exato — trocar ISO por texto quebraria o
    agendamento para deixar a oferta bonita."""
    r = summarize_slots(payload("2026-08-31"), "2026-08-31")
    assert r["dias"][0]["dia"] == "2026-08-31"
    assert r["dias"][0]["horarios"][0]["inicio"] == "2026-08-31T09:00"


def test_sem_horario_disponivel_nao_inventa_dia():
    r = summarize_slots({"slots": []}, "2026-08-31")
    assert "dias" not in r
    assert "aviso" in r


def test_a_marca_AGENDAVEIS_sobrevive():
    """Ela liga o freio `denies_slots` do motor — perder isso deixaria o modelo
    negar horário que a ferramenta devolveu."""
    assert "AGENDÁVEIS" in summarize_slots(payload("2026-08-31"), "2026-08-31")["status"]

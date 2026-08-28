"""Reengajamento POR ORIGEM — a cascata muda conforme onde a família parou.

Versão do documento final v3 (CCDA). O que mudou em relação à anterior:

  * **9 origens**, não 8. Entrou a origem 2 (Motivo da procura), que era o único
    ponto de parada do roteiro sem texto próprio: quem parava depois de contar o
    motivo recebia o texto genérico de quem nunca disse nada.
  * **A origem 3 tem 9 variantes**, uma por categoria de motivo. É a diferença
    entre "vi que você demonstrou interesse" e "imagino que encontrar uma escola
    onde ele se sinta bem seja importante para vocês".
  * **1º disparo em 23h**, não 20h. Encerramento **D+13**, não D+10: o texto de
    despedida sai no D+10 e a perda só é registrada três dias depois — quem
    responde à despedida ainda é lead.
  * **A tentativa não é mais etapa do funil.** Ela grava em
    `tentativa_reengajamento` (0-5). O quadro deixou de ter cinco colunas de
    "Tentativa de Contato": o card fica onde a família chegou, e quantas vezes
    tentamos falar com ela é atributo, não lugar.

🚨 A origem é lida da ÚLTIMA MENSAGEM DO AGENTE, e isso só é confiável porque o
script é literal (a "Regra zero" da persona). Se alguém afrouxar aquela regra, o
casamento aqui degrada — e degrada em silêncio, caindo na cascata genérica. Por
isso a origem 1 é o padrão: errar para o texto mais neutro, nunca para um texto
que afirma algo que não aconteceu.

🚨 **As origens 3 e 7 fazem a MESMA pergunta.** "Você prefere agendar uma visita
ao colégio ou prefere que eu te ligue?" fecha tanto o motivo quanto o pitch de
preço. O que as separa é o preço ter acabado de ser apresentado — e como o
formato do preço manda tudo numa mensagem só (contexto, horário, grade, valor e
a pergunta), a marca do valor está presente no mesmo texto. Por isso a 7 é
testada ANTES da 3: a mais específica primeiro.
"""

from __future__ import annotations

import re
import unicodedata

# Horas desde a última mensagem da família, cumulativas.
# `fim` não manda mensagem: é o ponto em que a perda por esgotamento é registrada.
HORAS = {"d1": 23, "d3": 72, "d7": 168, "d10": 240, "fim": 312}

D3 = (
    "Olá, aqui é a Nathalia do CCDA.\n\n"
    "Para dar sequência no seu atendimento, posso te ligar por 2 minutos ainda hoje?"
)
D7 = (
    "Oi, tudo bem? Passando para saber, você ainda tem interesse em receber "
    "mais informações sobre o CCDA?"
)
D10 = (
    "Olá, espero que esteja tudo bem. Imagino que a rotina está corrida e não "
    "quero incomodar. Se em algum momento quiser retomar o contato, é só me "
    "chamar. Um abraço, Nathalia."
)

MOTIVO_PERDA_ESGOTOU = "esgotou tentativas"

# ── Origem 3 — uma variante por categoria de motivo ─────────────────────────────
# O motivo já é conhecido, então o reengajamento retoma O ASSUNTO, não o contato.
# 🚨 "Preço" aqui é a família dizendo que já procurava algo mais barato (motivo
# declarado), coisa diferente de `PRECO_APRESENTADO`, que é o preço ter acabado
# de ser mostrado por nós — esse é a origem 7. E só esta variante NÃO oferece a
# via "por aqui": valor não se negocia por escrito.
POR_CATEGORIA: dict[str, str] = {
    "Adaptação": (
        "Oi, {nome}! Fiquei pensando em como isso deve estar sendo desafiador, "
        "começar do zero numa adaptação.\n\n"
        "Se fizer sentido, adoraria te mostrar de perto como cuidamos disso aqui. "
        "Prefere seguir por aqui ou que eu te ligue?"
    ),
    "Pedagógico": (
        "Oi, {nome}! Entendo bem essa busca por algo que realmente faça diferença "
        "no aprendizado dele(a).\n\n"
        "Posso te contar mais sobre nossa proposta pedagógica, ou prefere que eu te ligue?"
    ),
    "Rotina": (
        "Oi, {nome}! Sei como encaixar a rotina da família é importante.\n\n"
        "Posso te explicar como funciona o período integral aqui, ou prefere que eu te ligue?"
    ),
    "Logística": (
        "Oi, {nome}! Imagino que organizar tudo numa mudança já dá trabalho.\n\n"
        "Fico à disposição pra facilitar essa parte da escola, prefere seguir por "
        "aqui ou que eu te ligue?"
    ),
    "Estrutura": (
        "Oi, {nome}! Ficaria feliz em te mostrar de perto a estrutura do colégio.\n\n"
        "Prefere seguir por aqui ou que eu te ligue?"
    ),
    "Desempenho": (
        "Oi, {nome}! Sei o quanto essa fase de preparação pesa na decisão.\n\n"
        "Posso te contar mais sobre como trabalhamos isso aqui, ou prefere que eu te ligue?"
    ),
    "Preço": (
        "Oi, {nome}! Sei que o investimento pesa na decisão.\n\n"
        "Tenho algumas opções de planos de benefícios que talvez ajudem, posso te "
        "ligar para explicar melhor?"
    ),
    "Mudança": (
        "Oi, {nome}! Chegar numa cidade nova já é bastante coisa.\n\n"
        "Fico à disposição pra facilitar essa parte da escola pra vocês, prefere "
        "seguir por aqui ou que eu te ligue?"
    ),
    "Outro": (
        "Oi, tudo bem? Fiquei no aguardo do seu retorno sobre agendar uma visita "
        "ao colégio ou receber uma ligação nossa.\n\n"
        "Prefere seguir por aqui, ou que eu te ligue?"
    ),
}
CATEGORIA_PADRAO = "Outro"

# (n, rotulo, marcas da ultima mensagem do agente, texto do D+1)
#
# ORDEM IMPORTA: a mais específica primeiro. A 7 vem antes da 3 porque as duas
# terminam com a mesma pergunta; só a marca do valor separa.
CASCATAS: list[dict] = [
    {
        "n": 8,
        "origem": "Objeção de preço",
        "marcas": ["planos de benefícios e talvez um deles se encaixe"],
        "d1": (
            "Olá, espero que esteja tudo bem. Fiquei no aguardo do seu retorno sobre "
            "os planos de benefícios que mencionei.\n\n"
            "Posso te ligar para conversarmos melhor, ou prefere que eu te explique por aqui?"
        ),
    },
    {
        "n": 7,
        "origem": "Interesse em avançar, logo após o preço",
        "marcas": ["mensalidade é de", "mensalidade começa em",
                   "valor é passado presencialmente", "te passo pessoalmente"],
        "d1": (
            "Oi, {nome}! Fiquei no aguardo do seu retorno sobre as informações que te enviei.\n\n"
            "Prefere conhecer o colégio pessoalmente, ou que eu te ligue pra tirar dúvidas?"
        ),
    },
    {
        "n": 6,
        "origem": "Escolha da ligação",
        "marcas": ["vou te ligar", "te ligo em até 30 minutos",
                   "posso te ligar na segunda-feira"],
        "d1": (
            "Olá, espero que esteja tudo bem. Fiquei no aguardo para saber se você "
            "poderia me atender.\n\n"
            "Posso te ligar em outro horário, ou prefere que eu te passe as "
            "informações por aqui mesmo?"
        ),
    },
    {
        "n": 5,
        "origem": "Dados do filho",
        "marcas": ["nome completo do(a) filho", "escola atual", "consultora já prepare"],
        "d1": (
            "Olá, tudo bem? Sua visita já está confirmada, só falta o nome do(a) "
            "filho(a) e a escola atual, para a consultora já se preparar.\n\n"
            "Consegue me passar por aqui, ou prefere que eu te ligue?"
        ),
    },
    {
        "n": 4,
        "origem": "Oferta de datas",
        "marcas": ["tenho disponibilidade", "qual fica melhor para você",
                   "qual dia fica melhor"],
        "d1": (
            "Oi, tudo bem? Fiquei no aguardo para saber qual data fica melhor para sua visita.\n\n"
            "Posso te enviar as opções de novo, ou prefere que eu te ligue para combinarmos?"
        ),
    },
    {
        "n": 9,
        "origem": "Pergunta de série, dentro do reengajamento",
        "marcas": ["ainda fico à disposição pra saber qual ano escolar"],
        "d1": (
            "Oi, tudo bem? Ainda fico à disposição pra saber qual ano escolar você "
            "gostaria de mais informações.\n\n"
            "Prefere me contar por aqui, ou que eu te ligue?"
        ),
    },
    {
        "n": 2,
        "origem": "Motivo da procura",
        "marcas": ["o que fez vocês começarem a procurar uma nova escola"],
        "d1": (
            "Oi, tudo bem? Fiquei no aguardo para entender um pouco melhor o que fez "
            "vocês começarem a procurar uma nova escola.\n\n"
            "Prefere me contar por aqui ou prefere que eu te ligue?"
        ),
    },
    {
        "n": 3,
        "origem": "Interesse em avançar, logo após o motivo",
        "marcas": ["prefere agendar uma visita ao colégio ou prefere que eu te ligue"],
        # o texto sai de POR_CATEGORIA; este é o fallback quando o motivo não veio
        "d1": POR_CATEGORIA[CATEGORIA_PADRAO],
        "por_categoria": True,
    },
    {
        "n": 1,
        "origem": "Mensagem 1 (série)",
        "marcas": [],  # padrão: nenhuma marca casou
        "d1": (
            "Oi, tudo bem? Vi que você demonstrou interesse no nosso colégio.\n\n"
            "Você prefere seguir o contato por aqui, ou prefere que eu te ligue?"
        ),
    },
]

PADRAO = 1


def _normalizar(texto: str) -> str:
    """Sem acento, sem caixa, espaços colapsados — o casamento não pode falhar
    por causa de um acento perdido no caminho do canal."""
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def identificar_origem(ultima_msg_do_agente: str | None) -> int:
    """Qual cascata usar (1-9), a partir da última coisa que o agente disse."""
    alvo = _normalizar(ultima_msg_do_agente or "")
    if not alvo:
        return PADRAO
    for c in CASCATAS:
        for marca in c["marcas"]:
            if _normalizar(marca) in alvo:
                return c["n"]
    return PADRAO


def cascata(origem: int) -> dict:
    for c in CASCATAS:
        if c["n"] == origem:
            return c
    return next(c for c in CASCATAS if c["n"] == PADRAO)


def texto_d1(origem: int, categoria: str | None = None) -> str:
    """O 1º disparo. Só a origem 3 varia por categoria de motivo."""
    c = cascata(origem)
    if not c.get("por_categoria"):
        return c["d1"]
    return POR_CATEGORIA.get(
        (categoria or "").strip() or CATEGORIA_PADRAO,
        POR_CATEGORIA[CATEGORIA_PADRAO],
    )


def passos(origem: int, categoria: str | None = None) -> list[dict]:
    """Os 5 passos: quatro mensagens e o encerramento.

    `tentativa` é o valor que vai para o campo `tentativa_reengajamento` — a
    contagem deixou de ser coluna do funil. `perda` marca o único passo que tira
    o card do funil, e ele NÃO manda mensagem: a despedida já saiu no D+10.
    """
    return [
        {"h": HORAS["d1"], "msg": texto_d1(origem, categoria), "tentativa": 1, "rotulo": "23h"},
        {"h": HORAS["d3"], "msg": D3, "tentativa": 2, "rotulo": "D+3"},
        {"h": HORAS["d7"], "msg": D7, "tentativa": 3, "rotulo": "D+7"},
        {"h": HORAS["d10"], "msg": D10, "tentativa": 4, "rotulo": "D+10"},
        {"h": HORAS["fim"], "msg": None, "tentativa": 5, "rotulo": "D+13",
         "perda": MOTIVO_PERDA_ESGOTOU},
    ]

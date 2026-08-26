"""Reengajamento POR ORIGEM — a cascata muda conforme onde a família parou.

O motor tinha UMA cadência: quem parou na hora de escolher a data recebia o
mesmo texto de quem nunca disse a série ("vi que você demonstrou interesse no
nosso colégio"). Para quem já conversou, isso lê como se o colégio tivesse
esquecido a conversa — foi a queixa que abriu este trabalho.

🚨 A origem é lida da ÚLTIMA MENSAGEM DO AGENTE, e isso só é confiável porque o
script é literal (a "Regra zero" da persona). Se alguém afrouxar aquela regra, o
casamento aqui degrada — e degrada em silêncio, caindo na cascata genérica. Por
isso a cascata 1 é o padrão: errar para o texto mais neutro, nunca para um texto
que afirma algo que não aconteceu.

🚨 As 8 origens compartilham D+3, D+7 e D+10. Só o D+1 muda. É assim no desenho,
e é o que faz sentido: o primeiro toque retoma o assunto pendente; os seguintes
já são pedido de sinal de vida.
"""

from __future__ import annotations

import re
import unicodedata

# Horas desde a última mensagem da família, cumulativas.
HORAS = {"d1": 20, "d3": 72, "d7": 168, "d10": 240}

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

# (chave, rótulo do documento, marcas da última mensagem do agente, texto do D+1)
#
# As marcas são trechos do próprio script. Ordem importa: as mais específicas
# primeiro, porque "prefere agendar uma visita" aparece tanto na Mensagem 2
# quanto no fecho do pitch de preço.
CASCATAS: list[dict] = [
    {
        "chave": "objecao_preco",
        "origem": "Objeção de preço",
        "marcas": ["planos de benefícios e talvez um deles se encaixe"],
        "d1": (
            "Olá, espero que esteja tudo bem. Fiquei no aguardo do seu retorno sobre "
            "os planos de benefícios que mencionei.\n\n"
            "Posso te ligar pra conversarmos melhor, ou prefere que eu te explique por aqui?"
        ),
    },
    {
        "chave": "pitch_preco",
        "origem": "Pitch de preço",
        "marcas": ["mensalidade começa em", "valor de investimento faz sentido",
                   "valor é passado presencialmente", "te passo pessoalmente"],
        "d1": (
            "Olá, tudo bem? Fiquei no aguardo do seu retorno sobre as informações "
            "que te enviei.\n\n"
            "Prefere conhecer o colégio pessoalmente, ou que eu te ligue pra tirar dúvidas?"
        ),
    },
    {
        "chave": "combinado_ligacao",
        "origem": "Combinado (ligação)",
        "marcas": ["te ligo em até 30 minutos", "posso te ligar na segunda-feira",
                   "qual horário fica melhor pra você hoje"],
        "d1": (
            "Olá, espero que esteja tudo bem. Fiquei no aguardo pra saber se você "
            "poderia me atender.\n\n"
            "Posso te ligar em outro horário, ou prefere que eu te passe as "
            "informações por aqui mesmo?"
        ),
    },
    {
        "chave": "dados_do_filho",
        "origem": "Mensagem 5 (dados do filho)",
        "marcas": ["nome completo do(a) filho", "escola atual", "consultora já prepare"],
        "d1": (
            "Olá, tudo bem? Sua visita já está confirmada, só falta o nome do(a) "
            "filho(a) e a escola atual, pra consultora já se preparar.\n\n"
            "Consegue me passar por aqui, ou prefere que eu te ligue?"
        ),
    },
    {
        "chave": "oferta_datas",
        "origem": "Mensagem 3 (oferta de datas)",
        "marcas": ["tenho disponibilidade", "qual fica melhor para você",
                   "qual dia fica melhor"],
        "d1": (
            "Oi, tudo bem? Fiquei no aguardo pra saber qual data fica melhor pra sua visita.\n\n"
            "Posso te enviar as opções de novo, ou prefere que eu te ligue pra combinarmos?"
        ),
    },
    {
        "chave": "escolha_proximo_passo",
        "origem": "Mensagem 2 (escolha do próximo passo)",
        "marcas": ["prefere agendar uma visita ao colégio ou prefere que eu te ligue"],
        "d1": (
            "Oi, tudo bem? Fiquei no aguardo do seu retorno sobre agendar uma visita "
            "ao colégio ou receber uma ligação nossa.\n\n"
            "Prefere seguir por aqui, ou que eu te ligue?"
        ),
    },
    {
        "chave": "pergunta_serie",
        "origem": "Pergunta de série no reengajamento",
        "marcas": ["ainda fico à disposição pra saber qual ano escolar"],
        "d1": (
            "Oi, tudo bem? Ainda fico à disposição pra saber qual ano escolar você "
            "gostaria de mais informações.\n\n"
            "Prefere me contar por aqui, ou que eu te ligue?"
        ),
    },
    {
        "chave": "abertura",
        "origem": "Mensagem 1 (abertura)",
        "marcas": [],  # padrão: nenhuma marca casou
        "d1": (
            "Oi, tudo bem? Vi que você demonstrou interesse no nosso colégio.\n\n"
            "Você prefere seguir o contato por aqui, ou prefere que eu te ligue?"
        ),
    },
]

PADRAO = "abertura"

# Etapa do funil por passo da cascata. O passo 0 (D+1) leva o card para a 2ª
# tentativa porque a 1ª já aconteceu quando a família respondeu à abertura.
ETAPA_POR_PASSO = [
    "2ª Tentativa de Contato",
    "3ª Tentativa de Contato",
    "4ª Tentativa de Contato",
    "5ª Tentativa de Contato",
]
ETAPA_ESGOTOU = "Perdido: esgotou tentativas"


def _normalizar(texto: str) -> str:
    """Sem acento, sem caixa, espaços colapsados — o casamento não pode falhar
    por causa de um acento perdido no caminho do canal."""
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def identificar_origem(ultima_msg_do_agente: str | None) -> str:
    """Qual cascata usar, a partir da última coisa que o agente disse."""
    alvo = _normalizar(ultima_msg_do_agente or "")
    if not alvo:
        return PADRAO
    for c in CASCATAS:
        for marca in c["marcas"]:
            if _normalizar(marca) in alvo:
                return c["chave"]
    return PADRAO


def cascata(chave: str) -> dict:
    for c in CASCATAS:
        if c["chave"] == chave:
            return c
    return next(c for c in CASCATAS if c["chave"] == PADRAO)


def passos(chave: str) -> list[dict]:
    """Os 4 passos da cascata: D+1 próprio, D+3/D+7/D+10 comuns.

    `etapa` é para onde o card vai quando o passo dispara — o contador de
    tentativa do desenho. O último passo encerra em Perdido.
    """
    c = cascata(chave)
    return [
        {"h": HORAS["d1"], "msg": c["d1"], "etapa": ETAPA_POR_PASSO[0], "rotulo": "D+1"},
        {"h": HORAS["d3"], "msg": D3, "etapa": ETAPA_POR_PASSO[1], "rotulo": "D+3"},
        {"h": HORAS["d7"], "msg": D7, "etapa": ETAPA_POR_PASSO[2], "rotulo": "D+7"},
        {"h": HORAS["d10"], "msg": D10, "etapa": ETAPA_ESGOTOU, "rotulo": "D+10"},
    ]

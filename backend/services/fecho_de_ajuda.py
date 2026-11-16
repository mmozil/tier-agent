"""Tira do FIM da resposta a frase genérica de oferecer ajuda («Se precisar de mais informações, estou aqui
para ajudar», «Estou à disposição!») — pedido do CCDA em 15/11/2026.

Por quê no código e não só na persona: as regras 34 e 39 do agente 26 já proibiam a frase e o modelo seguia
pondo (31% das respostas numa semana; 6 de 24 no ensaio depois de corrigir a regra que mandava o contrário).

O que é cortado: só frases do FIM, no máximo duas, que sejam inteiras uma oferta genérica — sem pergunta, sem
link, sem número. O que fica: pergunta que faz a conversa andar («Ficou claro?») e oferta concreta («posso te
enviar o link»).

Resposta que é SÓ a oferta (a família manda «ok» / «obrigada» e a IA devolve só «se precisar…»): cortar
deixaria a mensagem vazia. O CCDA mandou seguir a regra 39 — «nunca diga que está à disposição, incentive a
conversa» —, então `aplicar` mostra ao modelo a resposta que não pode sair e pede outra (`CORRECAO`, uma vez,
sem ferramentas). Se insistir na oferta: família que agradeceu recebe «De nada!»; senão fica a original.

Liga por agente: `ta_runtime_param` (escopo='agent', escopo_id=<id do agente>, key='cortar_fecho_de_ajuda',
value='1'). Sem a linha = desligado = o comportamento de antes. Lido a cada resposta; nunca levanta.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text as sa_text

logger = logging.getLogger(__name__)

PARAM_KEY = "cortar_fecho_de_ajuda"
MAX_FRASES = 2

# fronteira de frase: pontuação final seguida de espaço, ou quebra de linha
_FRONTEIRA = re.compile(r"(?<=[.!?…])[ \t]+|\n+")
_LETRA = re.compile(r"[A-Za-zÀ-ÿ]")
_RABO_SEM_LETRA = re.compile(r"[^A-Za-zÀ-ÿ0-9.!?…]+$")

_DISPOSICAO = re.compile(r"(?i)\b(?:à|a)\s+(?:sua\s+|total\s+)?disposi[çc][ãa]o\b")
_ESTOU_AQUI = re.compile(
    r"(?i)^(?:e\s+)?(?:estou|estamos|sigo|seguimos|fico|ficamos)\s+(?:sempre\s+)?(?:por\s+)?aqui"
    r"(?:\s+para\s+(?:te\s+|lhe\s+)?(?:ajudar|o\s+que\s+(?:você\s+|vc\s+)?precisar))?[\s.!…]*$"
)
_CONTE_COMIGO = re.compile(r"(?i)^(?:pode\s+)?conte\s+comigo[\s.!…]*$")
_SE_OFERTA = re.compile(r"(?i)^(?:e\s+)?(?:caso|se)\s+(?:você\s+|vc\s+|ainda\s+)?(?:precisar|tiver|quiser|surgir)\b")
_ASSUNTO = re.compile(
    r"(?i)(informa[çc]|d[úu]vida|detalhe|algo\s+mais|mais\s+alguma|outra\s+coisa|qualquer\s+coisa|ajuda)"
)
_CONTATO = re.compile(
    r"(?i)(é\s+só\s+(?:me\s+)?(?:chamar|avisar|falar|perguntar|mandar)|me\s+(?:avise|avisa|chame|chama|fale|fala)|"
    r"pode\s+(?:me\s+)?(?:chamar|falar|perguntar)|(?:estou|estamos)\s+(?:por\s+)?aqui|disposi[çc][ãa]o|para\s+ajudar)"
)


def eh_oferta_generica(frase: str) -> bool:
    """A frase inteira é só «estou à disposição / se precisar de mais informações…»? Pura."""
    f = _RABO_SEM_LETRA.sub("", (frase or "").strip())
    if not f or "?" in f or "http" in f.lower() or re.search(r"\d{3,}", f):
        return False
    if _DISPOSICAO.search(f) and len(f) <= 160:
        return True
    if _ESTOU_AQUI.match(f) or _CONTE_COMIGO.match(f):
        return True
    return bool(_SE_OFERTA.match(f) and _ASSUNTO.search(f) and _CONTATO.search(f))


_AGRADECEU = re.compile(r"(?i)\b(obrigad|brigad|valeu|agrade[çc])")
CORRECAO = (
    "(Instrução interna do sistema, não é mensagem do cliente.) A sua última resposta foi só uma oferta genérica "
    "de ajuda, e ela não pode ser enviada: nunca diga que está à disposição nem «se precisar de mais informações», "
    "incentive a conversa. Escreva a resposta que vai para o cliente no lugar dela, em uma ou duas frases curtas, "
    "respondendo à última mensagem dele. Só o texto da resposta."
)


def historico_da_correcao(history: list[dict] | None, mensagem_do_cliente: str, resposta: str) -> list[dict]:
    """Histórico para a reescrita: a conversa + a mensagem do cliente + a resposta que não pode sair."""
    return [
        *(history or []),
        {"role": "user", "content": mensagem_do_cliente or ""},
        {"role": "assistant", "content": resposta or ""},
    ]


def ultimo_recurso(mensagem_do_cliente: str | None, resposta: str) -> str:
    """A reescrita também veio só oferta: se a família agradeceu, «De nada!»; senão fica a resposta. Pura."""
    if _AGRADECEU.search(mensagem_do_cliente or ""):
        return "De nada!"
    return resposta


def so_oferta(texto: str | None) -> bool:
    """A resposta INTEIRA é oferta genérica (toda frase com letra é uma)? Pura."""
    t = (texto or "").strip()
    frases = [p for p in _FRONTEIRA.split(t) if _LETRA.search(p)]
    return bool(frases) and all(eh_oferta_generica(p) for p in frases)


def _inicio_da_ultima_frase(texto: str) -> int | None:
    """Onde começa a última frase (contando emoji solto no fim como parte dela). None = uma frase só."""
    fronteiras = [m for m in _FRONTEIRA.finditer(texto)]
    for m in reversed(fronteiras):
        if _LETRA.search(texto[m.end() :]):
            return m.end()
    return None


def cortar(texto: str | None) -> str | None:
    """Remove do fim até `MAX_FRASES` frases de oferta genérica. Nunca deixa a resposta vazia. Pura."""
    if not texto:
        return texto
    resto = texto.rstrip()
    cortou = False
    for _ in range(MAX_FRASES):
        inicio = _inicio_da_ultima_frase(resto)
        if inicio is None:  # sobrou uma frase só: a resposta inteira era a oferta — fica
            break
        if not eh_oferta_generica(resto[inicio:]):
            break
        candidato = resto[:inicio].rstrip()
        if not _LETRA.search(candidato):
            break
        resto = candidato
        cortou = True
    return resto if cortou else texto


async def aplicar(texto, *, ferramentas_usadas, mensagem_do_cliente, history, gerar):
    """Resposta final + a chamada extra (para somar tokens), ou None.

    `gerar(user_content, history)` chama o motor SEM ferramentas. Só reescreve quando a resposta é inteira
    a oferta e o turno não usou ferramenta (nada roda duas vezes). Nunca levanta."""
    extra = None
    if so_oferta(texto) and not ferramentas_usadas:
        try:
            from services.tier_engine import eh_silencio

            extra = await gerar(CORRECAO, historico_da_correcao(history, mensagem_do_cliente, texto))
            novo = getattr(extra, "text", None)
            if novo and not eh_silencio(novo) and not so_oferta(novo):
                texto = novo
            else:
                texto = ultimo_recurso(mensagem_do_cliente, texto)
        except Exception:  # noqa: BLE001 — a resposta sai do mesmo jeito
            logger.warning("fecho_de_ajuda: reescrita falhou", exc_info=True)
            texto = ultimo_recurso(mensagem_do_cliente, texto)
    return cortar(texto), extra


async def ligado(db, agent_id: int | None) -> bool:
    """O agente pediu o corte? Erro de leitura = desligado (a resposta nunca deixa de sair por isto)."""
    if not agent_id:
        return False
    try:
        valor = (
            await db.execute(
                sa_text("SELECT value FROM ta_runtime_param WHERE escopo = 'agent' AND escopo_id = :a AND key = :k"),
                {"a": agent_id, "k": PARAM_KEY},
            )
        ).scalar()
    except Exception:  # noqa: BLE001
        logger.warning("fecho_de_ajuda: não consegui ler o parâmetro do agente %s", agent_id, exc_info=True)
        return False
    return str(valor or "").strip().lower() in ("1", "true", "sim", '"1"')

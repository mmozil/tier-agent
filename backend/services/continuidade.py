"""A conversa já começou? — o que a persona mostra na abertura e o que mostra no meio (25/11/2026, CCDA).

O caso: um disparo nosso («Aqui é a Nathalia, do Colégio CCDA… Posso reservar um horário?»), a família responde
«Bom dia» e a IA se apresenta de novo. Medido de 06 a 25/11 no agente 26: 32 das 90 primeiras respostas depois
de mensagem nossa repetiram a apresentação — 21 de 40 quando a família escreveu de 1 a 3 palavras, e igual com
ou sem pontuação (16 de 45 nos dois). A persona já dizia «não se apresente», mas também dizia «sempre utilize
essa 1ª mensagem, independente do que o usuário diga» e «ignore a 1ª mensagem do cliente»: o que o modelo lê ele
usa. Aqui o texto da abertura SAI do prompt quando já existe mensagem nossa — o que ele não vê, não repete.

Como se liga: marcações na própria persona, do mesmo jeito dos blocos por horário (`persona_do_horario`):
    [[abertura]] … [[/abertura]]          fica só enquanto não existe nenhuma mensagem nossa na conversa
    [[em_andamento]] … [[/em_andamento]]  fica só depois que existe (IA, equipe, modelo ou disparo)
Persona sem marcação passa igual e nada é acrescentado ao prompt: só muda quem usa.

Com marcação e a conversa em andamento, o prompt ganha no FIM (`bloco`) a nossa última mensagem e, se a equipe
escreveu pelo painel ou pelo celular, o que ela disse — a fala humana fica fora do `load_history`.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text as sa_text

logger = logging.getLogger(__name__)

_RE_BLOCO = re.compile(r"\[\[(abertura|em_andamento)\]\](.*?)\[\[/\1\]\]", re.DOTALL)
MAX_ULTIMA = 700
MAX_EQUIPE = 4


def tem_marcas(persona: str | None) -> bool:
    return bool(persona) and bool(_RE_BLOCO.search(persona))


def persona_da_conversa(persona: str, em_andamento: bool) -> str:
    """Deixa só o bloco da situação da conversa. Sem marcação, devolve o mesmo texto. Pura."""
    if not tem_marcas(persona):
        return persona
    fica = "em_andamento" if em_andamento else "abertura"
    return _RE_BLOCO.sub(lambda m: m.group(2).strip("\n") if m.group(1) == fica else "", persona)


def ja_falamos(history: list[dict] | None) -> bool:
    """O histórico (o do modelo) tem alguma mensagem nossa? Pura."""
    return any(m.get("role") == "assistant" and (m.get("content") or "").strip() for m in (history or []))


def _corta(texto: str, limite: int) -> str:
    t = re.sub(r"\s+", " ", texto or "").strip()
    return t if len(t) <= limite else t[: limite - 1].rstrip() + "…"


def bloco(history: list[dict] | None, falas_da_equipe: list[str] | None = None) -> str:
    """O fim do prompt numa conversa em andamento. Vazio se não há mensagem nossa. Pura."""
    ultima = next(
        (
            m["content"]
            for m in reversed(history or [])
            if m.get("role") == "assistant" and (m.get("content") or "").strip()
        ),
        None,
    )
    equipe = [f for f in (falas_da_equipe or []) if (f or "").strip()]
    if ultima is None and not equipe:
        return ""
    linhas = ["\n\n# Esta conversa JÁ está em andamento (calculado pelo sistema)"]
    if ultima is not None:
        linhas.append(f"- Nossa última mensagem, que o contato leu antes de escrever: «{_corta(ultima, MAX_ULTIMA)}»")
    if equipe:
        linhas.append("- A equipe também já escreveu nesta conversa (o contato viu), da mais antiga para a mais nova:")
        linhas += [f"  • «{_corta(f, 300)}»" for f in equipe[-MAX_EQUIPE:]]
    linhas += [
        "- Você já se apresentou: não diga de novo seu nome, seu cargo nem onde trabalha, e não recomece o atendimento.",
        "- A mensagem do contato é a CONTINUAÇÃO desta conversa, mesmo curta, sem pontuação ou com erro de digitação. "
        "Responda ao que ele disse, levando em conta tudo o que já foi dito, e não pergunte de novo o que ele já respondeu.",
        "- Se ele mandou SÓ um cumprimento («oi», «bom dia», «tudo bem?»): cumprimente de volta pelo primeiro nome dele e, "
        "na mesma mensagem, retome numa frase curta a pergunta ou o convite da nossa última mensagem, com o mesmo assunto "
        "dela. Não troque por outra pergunta.",
    ]
    return "\n".join(linhas)


async def em_andamento(db, conversation_id: int, history: list[dict] | None = None) -> bool:
    """Já existe mensagem NOSSA nesta conversa — IA, equipe, modelo ou disparo. Nunca levanta."""
    if ja_falamos(history):
        return True
    try:
        return bool(
            (
                await db.execute(
                    sa_text(
                        "SELECT 1 FROM ta_message_log WHERE conversation_id = :c "
                        "AND role IN ('assistant', 'agent') AND content IS NOT NULL LIMIT 1"
                    ),
                    {"c": conversation_id},
                )
            ).first()
        )
    except Exception:  # noqa: BLE001 — na dúvida, a conversa é tratada como nova (o comportamento de antes)
        logger.exception("continuidade: não consegui ver se a conversa %s já começou", conversation_id)
        return False


async def falas_da_equipe(db, conversation_id: int) -> list[str]:
    """O que a equipe escreveu (fora modelo e disparo, que já estão no histórico). Nunca levanta."""
    from services.disparo_oficial import MARCA_DISPARO, MARCA_MODELO

    try:
        linhas = (
            await db.execute(
                sa_text(
                    "SELECT content FROM ta_message_log WHERE conversation_id = :c AND role = 'agent' "
                    "AND content IS NOT NULL AND COALESCE(model_used, '') NOT LIKE :d "
                    "AND COALESCE(model_used, '') NOT LIKE :m ORDER BY id DESC LIMIT :n"
                ),
                {"c": conversation_id, "d": f"{MARCA_DISPARO}%", "m": f"{MARCA_MODELO}%", "n": MAX_EQUIPE},
            )
        ).all()
        return [r[0] for r in reversed(linhas)]
    except Exception:  # noqa: BLE001
        logger.exception("continuidade: não consegui ler as falas da equipe conv=%s", conversation_id)
        return []

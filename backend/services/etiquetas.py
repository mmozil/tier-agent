"""Etiquetas da conta — a LISTA FIXA, no padrão do Chatwoot (12/11/2026, pedido do CCDA).

Antes a etiqueta era texto livre digitado na conversa: cada pessoa escrevia de um jeito («vip» e
«VIP» viravam duas), não havia cor nem descrição, e a lateral só mostrava as etiquetas que
apareciam nas 200 conversas carregadas. No Chatwoot do CCDA a equipe usa 16 etiquetas fixas e
86% das conversas têm uma — a equipe ESCOLHE numa lista, não digita.

Regras:
- A lista é da CONTA (tenant): nome único, cor, descrição e se aparece na lateral.
- Conta que ainda não criou nenhuma etiqueta segue como antes (texto livre) — nada muda para quem
  não usa.
- Com lista, a conversa só recebe etiqueta da lista. A que a conversa JÁ tinha passa, mesmo fora
  dela: senão tirar uma etiqueta falharia por causa de outra antiga.
- Apagar da lista NÃO tira das conversas (fica o histórico; a etiqueta aparece em cinza e pode ser
  removida). RENOMEAR leva o nome novo para todas as conversas da conta.
"""

from __future__ import annotations

import re

NOME_MAX = 24
MAX_POR_CONVERSA = 8
COR_PADRAO = "#6B7280"
_RE_COR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def normalizar_tag(bruto: str | None) -> str:
    """O que a conversa sempre fez com a etiqueta: sem espaço nas pontas, minúsculas, 24 letras."""
    return (bruto or "").strip().lower()[:NOME_MAX]


def normalizar_nome(bruto: str | None) -> str:
    """Nome de etiqueta da LISTA: como na conversa, e espaço vira hífen (como no Chatwoot:
    «visita agendada» → «visita-agendada»), para o nome nunca diferir só por espaço."""
    return re.sub(r"\s+", "-", (bruto or "").strip().lower())[:NOME_MAX].strip("-")


def cor_valida(bruto: str | None) -> str | None:
    """#RRGGBB em maiúsculas, ou None se não for uma cor."""
    c = (bruto or "").strip()
    return c.upper() if _RE_COR.match(c) else None


def validar_tags(
    pedidas: list[str] | None, catalogo: set[str] | None, atuais: list[str] | None
) -> tuple[list[str], list[str]]:
    """Normaliza a lista pedida e confere contra a lista da conta.

    Devolve (final, fora_da_lista). Sem lista (`catalogo` vazio) = texto livre, como antes.
    A etiqueta que a conversa já tinha passa mesmo fora da lista."""
    ja = {normalizar_tag(t) for t in (atuais or [])}
    final: list[str] = []
    fora: list[str] = []
    for t in pedidas or []:
        n = normalizar_tag(t)
        if not n or n in final:
            continue
        if catalogo and n not in catalogo and n not in ja:
            if n not in fora:
                fora.append(n)
            continue
        final.append(n)
    return final[:MAX_POR_CONVERSA], fora

"""Histórico do CONTATO — todas as conversas dele no tenant, por qualquer número.

O card do CRM guarda o ponteiro de UMA conversa. Com os números das consultoras em
modo registro (07/10/2026), a mesma família fala com o número da IA, com a Débora
e com a Karolaine: são conversas diferentes, e o card mostrava só a do ponteiro. A
aba Conversas do card passa a ler o histórico do contato inteiro, dizendo por qual
número cada mensagem andou e quem falou do nosso lado.

Regras puras aqui (testáveis sem banco); a consulta mora na rota.
"""

from __future__ import annotations

import re

# Só canais em que o identificador do contato É o telefone. Em webchat, Telegram e
# e-mail o id não é número de telefone — juntar por dígitos ali colaria estranhos.
KINDS_TELEFONE = ("whatsapp", "whatsapp_cloud")

_MIN_DIGITOS = 10  # DDI+DDD+número; abaixo disso não é telefone, é id de outra coisa


def chave_do_contato(external_id: str | None, kind: str | None = "whatsapp") -> str:
    """Os dígitos do telefone do contato, ou "" quando não dá para afirmar que é telefone.

    `5511999990000@s.whatsapp.net` e `5511999990000` (Cloud API) são o mesmo contato.
    `…@lid` é um id interno do WhatsApp, não o telefone: devolve "" (fica só a própria
    conversa, em vez de casar com um telefone que por acaso tenha os mesmos dígitos).
    """
    if kind not in KINDS_TELEFONE:
        return ""
    bruto = (external_id or "").strip().lower()
    if not bruto or bruto.endswith("@lid") or bruto.endswith("@g.us") or bruto.endswith("@broadcast"):
        return ""
    digitos = re.sub(r"\D", "", bruto.split("@", 1)[0])
    return digitos if len(digitos) >= _MIN_DIGITOS else ""


def mesmo_contato(a_external: str | None, a_kind: str | None, b_external: str | None, b_kind: str | None) -> bool:
    """Duas conversas são do mesmo contato? Igualdade exata do id OU mesmo telefone."""
    if a_external and a_external == b_external and a_kind == b_kind:
        return True
    ka = chave_do_contato(a_external, a_kind)
    return bool(ka) and ka == chave_do_contato(b_external, b_kind)


def quem_falou(papel: str | None, nome_membro: str | None, nome_agente: str | None) -> str | None:
    """Quem é o «nós» de cada mensagem, para o card não mostrar balões anônimos.

    `agent` = uma pessoa (painel ou celular da consultora) · `assistant` = a IA.
    Mensagem do contato não leva nome: o card já diz de quem é.
    """
    if papel == "agent":
        return nome_membro or "Atendente"
    if papel == "assistant":
        return f"IA · {nome_agente}" if nome_agente else "IA"
    return None

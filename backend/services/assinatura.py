"""Nome de quem respondeu na frente da mensagem — «*Ellaine:*».

Em número dividido por várias pessoas (a secretaria da escola), a família vê no
WhatsApp quem está falando, como nas ferramentas de atendimento compartilhado.
Liga por número (`ta_connector.assinar_nome`), desligado por padrão: no celular
da própria consultora o nome seria redundante.

O texto GRAVADO no inbox fica sem o prefixo — quem respondeu já aparece embaixo
do balão (`member_id`). Por isso o eco do celular, que volta COM o prefixo,
precisa ser comparado sem ele (`tirar_assinatura`).
"""

from __future__ import annotations

import re

_PREFIXO = re.compile(r"^\*[^*\n]{1,40}:\*\n")


def primeiro_nome(nome: str | None) -> str | None:
    partes = (nome or "").strip().split()
    return partes[0][:40] if partes else None


def com_assinatura(nome: str | None, texto: str) -> str:
    """`*Nome:*` + quebra + texto. Sem nome, devolve o texto como veio."""
    quem = primeiro_nome(nome)
    if not quem or not (texto or "").strip():
        return texto
    return f"*{quem}:*\n{texto}"


def tirar_assinatura(texto: str | None) -> str:
    return _PREFIXO.sub("", texto or "", count=1)

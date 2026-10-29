"""A chave da mensagem do WhatsApp que está sendo gravada agora (21/10/2026).

Reagir com emoji exige a chave da mensagem como o WhatsApp a conhece — `key.id`,
o chat (`remoteJid`) e quem mandou (`fromMe`). O webhook tem a chave; quem grava a
mensagem (`agent_runtime.log_message`) fica três chamadas abaixo. Em vez de
costurar um parâmetro por todo o caminho, o webhook DEFINE a chave no contexto da
tarefa daquela mensagem e a gravação CONSOME — uma vez só, e só para o papel
certo: a resposta da IA gravada depois, na mesma tarefa, não herda a chave da
mensagem do cliente.

Cada mensagem roda na sua própria tarefa (`asyncio.create_task` copia o contexto),
então uma não enxerga a chave da outra.
"""

from __future__ import annotations

from contextvars import ContextVar

_ATUAL: ContextVar[dict | None] = ContextVar("wa_chave_atual", default=None)


def definir(chave: dict | None, papel: str) -> None:
    """`chave` = {id, remote_jid, from_me}; `papel` = o role da mensagem a gravar."""
    _ATUAL.set({**chave, "papel": papel} if chave and chave.get("id") else None)


def consumir(papel: str) -> dict | None:
    c = _ATUAL.get()
    if not c or c.get("papel") != papel:
        return None
    _ATUAL.set(None)
    return c


def remote_jid_atual() -> str | None:
    """O chat como o WhatsApp mandou (`key.remoteJid`), SEM consumir a chave. Na mensagem do cliente
    pode ser o código oculto (`…@lid`) enquanto a conversa é aberta pelo telefone — é o elo que junta
    a conversa partida (29/10/2026)."""
    c = _ATUAL.get()
    return (c or {}).get("remote_jid")

"""Nó send_text — envia texto pelo canal do conversa."""

from __future__ import annotations

from services.playbook_template_engine import render_string

from .base import ExecutionContext, NodeResult


async def execute_send_text(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Envia 1 mensagem de texto pelo canal da conversa.

    Config:
        text (str): conteúdo, suporta `{{vars.X}}`, `{{contact.name}}`, etc
        delay_ms (int, opcional): pausa antes de enviar (não bloqueia executor)
    """
    raw = (config.get("text") or "").strip()
    if not raw:
        return NodeResult(error="send_text: campo 'text' vazio")

    rendered = render_string(raw, ctx.template_context)

    ctx.outbound_messages.append(
        {
            "kind": "text",
            "content": rendered,
            "delay_ms": int(config.get("delay_ms") or 0),
        }
    )
    return NodeResult(output={"sent_text": rendered})

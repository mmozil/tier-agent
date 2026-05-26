"""Nós de integração — call_api + tier_pay + handoff_human."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import httpx

from services.playbook_template_engine import render_dict, render_string

from .base import ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


async def execute_call_api(ctx: ExecutionContext, config: dict) -> NodeResult:
    """HTTP POST/GET genérico pra integração externa.

    Config:
        method (str): GET|POST|PUT|PATCH|DELETE
        url (str): URL completa (suporta vars)
        headers_json (dict|str): headers (valores suportam vars)
        body_json (dict|str): body JSON (valores suportam vars)
        timeout_s (int, default 15)
        save_as (str): salva response.json() ou response.text em vars[save_as]
        save_status_as (str): salva status code em vars[save_status_as]
    """
    method = (config.get("method") or "POST").upper()
    url_raw = (config.get("url") or "").strip()
    if not url_raw:
        return NodeResult(error="call_api: url vazia")
    url = render_string(url_raw, ctx.template_context)

    headers_raw = config.get("headers_json") or {}
    if isinstance(headers_raw, str):
        try:
            headers_raw = json.loads(headers_raw) if headers_raw.strip() else {}
        except json.JSONDecodeError:
            return NodeResult(error="call_api: headers_json inválido")
    headers = {str(k): render_string(str(v), ctx.template_context) for k, v in headers_raw.items()}

    body_raw = config.get("body_json")
    body = render_dict(body_raw, ctx.template_context) if body_raw else None

    save_as = (config.get("save_as") or "").strip() or None
    save_status_as = (config.get("save_status_as") or "").strip() or None
    timeout_s = int(config.get("timeout_s") or 15)

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            if method == "GET":
                r = await cli.get(url, headers=headers)
            elif method == "DELETE":
                r = await cli.delete(url, headers=headers)
            else:
                r = await cli.request(method, url, headers=headers, json=body)
    except Exception as e:
        return NodeResult(error=f"call_api: {e}")

    # parsea JSON se possível, senão texto
    try:
        parsed: object = r.json()
    except ValueError:
        parsed = r.text[:5000]

    vars_update: dict = {}
    if save_as:
        vars_update[save_as] = parsed
        ctx.template_context.setdefault("vars", {})[save_as] = parsed
    if save_status_as:
        vars_update[save_status_as] = r.status_code
        ctx.template_context.setdefault("vars", {})[save_status_as] = r.status_code

    return NodeResult(
        output={
            "method": method,
            "url": url[:200],
            "status_code": r.status_code,
            "response_preview": str(parsed)[:300],
        },
        vars_update=vars_update,
        # se status 4xx/5xx, segue mas marca step com erro pra debug
        error=f"HTTP {r.status_code}" if r.status_code >= 400 else None,
    )


async def execute_tier_pay(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Gera link de pagamento Pix/Cartão via Tier Pay (Pagar.me).

    Sprint 3 MVP: placeholder estruturado. Sprint 4+ integra TierPayService real
    (precisa env vars TIER_PAY_SECRET_KEY no tenant + endpoint /paymentlinks).

    Por enquanto retorna URL mockada + salva em vars pra cliente testar fluxo end-to-end.

    Config:
        valor_cents (int): valor em centavos
        descricao (str): descrição (suporta vars)
        metodo (str): pix|cartao|both
        save_as (str): variável onde salvar a URL gerada
    """
    valor_cents = int(config.get("valor_cents") or 0)
    if valor_cents <= 0:
        return NodeResult(error="tier_pay: valor_cents inválido")

    descricao = render_string(
        config.get("descricao") or "Cobrança Tier Agent",
        ctx.template_context,
    )
    metodo = (config.get("metodo") or "pix").lower()
    save_as = (config.get("save_as") or "payment_link").strip()

    # MVP: gera placeholder. Sprint 4 chama TierPayService real.
    # TODO: integrar services.tier_pay (copy da tier-finance) — requer env vars por tenant
    mock_url = f"https://pay.tier.finance/checkout/mock-{ctx.execution_id}-{valor_cents}"

    vars_update = {save_as: mock_url, f"{save_as}_status": "pending"}
    ctx.template_context.setdefault("vars", {})[save_as] = mock_url

    logger.warning(
        "tier_pay node MVP usando URL mock — integração real em Sprint 4. tenant=%s exec=%s valor=%s",
        ctx.tenant_id, ctx.execution_id, valor_cents,
    )

    return NodeResult(
        output={
            "url": mock_url,
            "valor_cents": valor_cents,
            "descricao": descricao,
            "metodo": metodo,
            "warning": "MVP — URL placeholder, integração real em Sprint 4",
        },
        vars_update=vars_update,
    )


async def execute_handoff_human(ctx: ExecutionContext, config: dict) -> NodeResult:
    """Pausa agente IA + sinaliza pra equipe humana atender.

    Config:
        queue (str): fila/setor (vendas, suporte, financeiro)
        msg (str): texto enviado pro contato avisando que humano vai assumir
        pause_minutes (int): tempo de pausa antes de retomar IA automaticamente (0 = permanente até botão admin)

    Comportamento:
        1. Envia msg pro contato (opcional)
        2. Salva vars[handoff_queue], vars[handoff_at]
        3. NodeResult.final_status='handed_off' — executor encerra execução
        4. V2: cria Notification row pra equipe ver na inbox CRM
    """
    queue = (config.get("queue") or "atendimento").strip()
    msg_raw = (config.get("msg") or "").strip()
    pause_minutes = int(config.get("pause_minutes") or 0)

    if msg_raw:
        msg = render_string(msg_raw, ctx.template_context)
        ctx.outbound_messages.append({"kind": "text", "content": msg})

    now = datetime.now(timezone.utc).isoformat()
    vars_update = {
        "handoff_queue": queue,
        "handoff_at": now,
        "handoff_pause_minutes": pause_minutes,
    }

    # TODO: criar Notification em ta_notification (Sprint 4) pra equipe ver no painel
    logger.info(
        "handoff_human conv=%s agent=%s queue=%s pause=%smin",
        ctx.conversation_id, ctx.agent_id, queue, pause_minutes,
    )

    return NodeResult(
        final_status="handed_off",
        output={
            "queue": queue,
            "msg_sent": bool(msg_raw),
            "pause_minutes": pause_minutes,
            "handed_off_at": now,
        },
        vars_update=vars_update,
    )

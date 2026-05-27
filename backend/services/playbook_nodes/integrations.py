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
    """Gera link de pagamento Pix/Cartão via Tier Pay (Pagar.me real).

    Config:
        valor_cents (int): valor em centavos
        descricao (str): descrição (suporta vars)
        metodo (str): pix|cartao|both (default both = pix + credit_card)
        save_as (str): variável onde salvar a URL gerada
        expires_in_days (int, default 7): validade do link
    """
    valor_cents = int(config.get("valor_cents") or 0)
    if valor_cents <= 0:
        return NodeResult(error="tier_pay: valor_cents inválido")

    descricao = render_string(
        config.get("descricao") or "Cobrança Tier Agent",
        ctx.template_context,
    )
    metodo = (config.get("metodo") or "both").lower()
    save_as = (config.get("save_as") or "payment_link").strip()
    expires_in_days = int(config.get("expires_in_days") or 7)

    # Mapeia metodo → Pagar.me payment methods
    if metodo == "pix":
        methods = ["pix"]
    elif metodo in ("cartao", "credit_card"):
        methods = ["credit_card"]
    elif metodo == "boleto":
        methods = ["boleto"]
    else:
        methods = ["pix", "credit_card"]

    # Customer info do contact
    contact = ctx.template_context.get("contact") or {}
    customer_name = contact.get("name")
    tenant = ctx.template_context.get("tenant") or {}
    tenant_label = tenant.get("nome") or f"tenant-{ctx.tenant_id}"

    from services import tier_pay_client

    # Carrega config Tier Pay do tenant (Q3.7 multi-tenant). Fallback pro env master se sem config.
    tenant_sk: str | None = None
    tenant_recipient: str | None = None
    tenant_fee = 0.0
    try:
        from core.db import db_context
        from core.encryption import decrypt
        from models import TaTierPayConfig
        from sqlalchemy import select as _sel

        async with db_context() as pdb:
            cfg_row = (
                await pdb.execute(
                    _sel(TaTierPayConfig).where(
                        TaTierPayConfig.tenant_id == ctx.tenant_id,
                        TaTierPayConfig.active.is_(True),
                    )
                )
            ).scalar_one_or_none()
            if cfg_row:
                tenant_sk = decrypt(cfg_row.secret_key_enc)
                tenant_recipient = cfg_row.recipient_id
                tenant_fee = float(cfg_row.fee_percent or 0)
    except Exception:
        logger.exception("tier_pay tenant config load falhou — fallback master")

    result = await tier_pay_client.create_payment_link(
        name=f"{tenant_label[:40]} — {descricao[:40]}",
        amount_cents=valor_cents,
        description=descricao,
        methods=methods,
        expires_in_days=expires_in_days,
        customer_name=customer_name,
        secret_key=tenant_sk,
        recipient_id=tenant_recipient,
        fee_percent=tenant_fee,
        metadata={
            "tenant_id": ctx.tenant_id,
            "agent_id": ctx.agent_id,
            "playbook_id": ctx.playbook_id,
            "execution_id": ctx.execution_id,
            "conversation_id": ctx.conversation_id,
            "external_chat_id": ctx.external_chat_id or "",
        },
    )

    if not result.ok:
        # Fallback pro mock URL em caso de erro — não trava playbook
        logger.warning("tier_pay falhou — fallback mock: %s", result.error)
        mock_url = f"https://pay.tier.finance/checkout/erro-{ctx.execution_id}"
        return NodeResult(
            output={"url": mock_url, "error": result.error, "fallback": True},
            vars_update={save_as: mock_url, f"{save_as}_status": "error"},
            error=result.error,
        )

    vars_update = {
        save_as: result.url,
        f"{save_as}_id": result.payment_link_id,
        f"{save_as}_status": "pending",
    }
    ctx.template_context.setdefault("vars", {})[save_as] = result.url

    return NodeResult(
        output={
            "url": result.url,
            "payment_link_id": result.payment_link_id,
            "valor_cents": valor_cents,
            "descricao": descricao,
            "methods": methods,
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
        2. Cria TaNotification (category=handoff) pra equipe ver no inbox
        3. Salva vars[handoff_*]
        4. NodeResult.final_status='handed_off' — executor encerra execução
    """
    from core.db import db_context
    from models import TaNotification

    queue = (config.get("queue") or "atendimento").strip()
    msg_raw = (config.get("msg") or "").strip()
    pause_minutes = int(config.get("pause_minutes") or 0)

    if msg_raw:
        msg = render_string(msg_raw, ctx.template_context)
        ctx.outbound_messages.append({"kind": "text", "content": msg})

    now = datetime.now(timezone.utc).isoformat()
    contact_name = (ctx.template_context.get("contact") or {}).get("name") or "contato"
    contact_from = (ctx.template_context.get("contact") or {}).get("from") or "—"

    # Cria notification pra equipe (sessão isolada, não bloqueia executor)
    try:
        async with db_context() as ndb:
            notif = TaNotification(
                tenant_id=ctx.tenant_id,
                agent_id=ctx.agent_id,
                conversation_id=ctx.conversation_id,
                playbook_execution_id=ctx.execution_id,
                category="handoff",
                title=f"Handoff — {contact_name} ({queue})",
                body=(
                    f"Cliente {contact_name} ({contact_from}) precisa de atendimento humano "
                    f"na fila '{queue}'. Agente IA pausado por "
                    f"{'permanente' if pause_minutes == 0 else f'{pause_minutes}min'}."
                ),
                queue=queue,
                payload_json={
                    "contact_name": contact_name,
                    "contact_from": contact_from,
                    "pause_minutes": pause_minutes,
                    "handed_off_at": now,
                },
                status="unread",
            )
            ndb.add(notif)
            await ndb.commit()
    except Exception:
        logger.exception("handoff_human: falha criando Notification — handoff continua")

    vars_update = {
        "handoff_queue": queue,
        "handoff_at": now,
        "handoff_pause_minutes": pause_minutes,
    }

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

"""Cliente Agent → ERP (Tier Empresas) — cria oportunidade no CRM a partir de uma conversa.

Reusa o shared secret ``TIER_ERP_INTEGRATION_SECRET`` (a MESMA federação que
provisiona o tenant + embute o inbox no ERP). É uma chamada server-to-server: o
token SSO que o inbox embutido carrega é um JWT do PRÓPRIO Agent e não vale no
ERP, então quem fala com o ERP é o backend do Agent, não o browser.

Usado por:
  - Fase 1: botão "Enviar para CRM" (``routes/conversations.py``)
  - Fase 2: auto-qualificação de lead (``services/lead_capture.py``, dormente por flag)

A idempotência mora no ERP (dedup por ``conversa_externa_id``). Aqui só propagamos
erros como ``ErpCrmError`` pro caller decidir (toast/log) — nunca derruba o fluxo
do agente.
"""

from __future__ import annotations

import logging

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)


class ErpCrmError(Exception):
    """Falha ao falar com o CRM do ERP (config ausente, 4xx/5xx, timeout)."""


def integracao_ativa() -> bool:
    """True se o shared secret da federação ERP está setado."""
    return bool((get_settings().tier_erp_integration_secret or "").strip())


async def enviar_conversa_para_crm(
    *,
    agent_tenant_id: int,
    conversa_externa_id: str | int,
    contato_nome: str | None = None,
    contato_avatar: str | None = None,
    telefone: str | None = None,
    canal: str | None = None,
    titulo: str | None = None,
    resumo: str | None = None,
    ultima_mensagem: str | None = None,
) -> dict:
    """POST no ERP → {ok, oportunidade_id, cliente_id, titulo, estagio_id, ja_existia}.

    ``conversa_externa_id`` deve ser estável por conversa (usamos o id da conversa
    do Agent) — é a chave de idempotência: botão + auto-qualificação convergem numa
    única oportunidade.
    """
    settings = get_settings()
    secret = (settings.tier_erp_integration_secret or "").strip()
    if not secret:
        raise ErpCrmError("Integração ERP não configurada (TIER_ERP_INTEGRATION_SECRET).")

    base = (settings.tier_erp_api_url or "https://api.tier.finance").rstrip("/")
    url = f"{base}/api/tier-empresas/vendas/crm/oportunidades/from-conversa"
    payload = {
        "agent_tenant_id": agent_tenant_id,
        "conversa_externa_id": str(conversa_externa_id),
        "contato_nome": contato_nome,
        "contato_avatar": contato_avatar,
        "telefone": telefone,
        "canal": canal,
        "titulo": titulo,
        "resumo": resumo,
        "ultima_mensagem": ultima_mensagem,
        "origem_sistema": "tier-agent",
    }
    headers = {
        "X-Tier-Integration-Secret": secret,
        "X-Sync-Source": "tier-agent",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as cli:
            r = await cli.post(url, json=payload, headers=headers)
    except httpx.HTTPError as e:  # rede/timeout
        raise ErpCrmError(f"Falha de rede ao chamar o CRM do ERP: {e}") from e

    if r.status_code >= 400:
        detail: str | None = None
        try:
            detail = r.json().get("detail")
        except Exception:  # noqa: BLE001 — corpo não-JSON
            detail = (r.text or "")[:200]
        raise ErpCrmError(str(detail or f"ERP retornou {r.status_code}"))

    return r.json()

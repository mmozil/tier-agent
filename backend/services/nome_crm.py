"""Nome do contato vindo do CRM do ERP, para a conversa que só tem o número (09/11/2026, M7).

Pedido do dono: «clica no número dentro do negócio, vai para o Atendimento e só aparece o
número, confundindo os usuários». A conversa guarda o apelido do WhatsApp (`contact_name`, o
pushName), que vem vazio para quem nunca escreveu primeiro — na M7, 76 das 130 conversas com
telefone (medido 09/11). O CRM conhecia 34 delas pelo número.

Regras:
  - Nunca derruba a tela: sem integração, conta fora do CRM, ERP fora do ar ou lento → {}.
  - A lista do inbox recarrega a cada 10 s: guarda a resposta por número (achou ou não) por
    5 min, e a conta que o ERP não conhece (ou que falhou) fica 1 a 10 min sem perguntar.
  - Número `@lid` não tem telefone: fica de fora.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Iterable

from services import erp_crm_client

logger = logging.getLogger(__name__)

_TTL_NOME = 300.0  # achou ou não achou: 5 min
_TTL_CONTA_FORA = 600.0  # conta do Agent sem CRM ligado
_TTL_FALHA = 60.0  # ERP fora do ar / lento: não atrasa cada recarga da lista
_MAX_CACHE = 20000

_cache: dict[tuple[int, str], tuple[float, str | None]] = {}
_conta_pausada: dict[int, float] = {}


def telefone_da_conversa(external_id: str | None) -> str | None:
    """Os dígitos do número de uma conversa de WhatsApp, ou None (`@lid`, grupo, outro canal)."""
    ext = (external_id or "").strip()
    if not ext or "@lid" in ext or "@g.us" in ext or "@broadcast" in ext:
        return None
    digitos = re.sub(r"\D", "", ext.split("@")[0])
    return digitos if 10 <= len(digitos) <= 13 else None


async def nomes_do_crm(tenant_id: int | None, externos: Iterable[str | None]) -> dict[str, str]:
    """{external_id: nome do contato no CRM} para as conversas cujo número o CRM conhece."""
    if not tenant_id or not erp_crm_client.integracao_ativa():
        return {}
    agora = time.monotonic()
    if _conta_pausada.get(tenant_id, 0.0) > agora:
        return {}

    por_tel: dict[str, list[str]] = {}
    for ext in externos:
        tel = telefone_da_conversa(ext)
        if tel:
            por_tel.setdefault(tel, []).append(ext)  # type: ignore[arg-type]
    if not por_tel:
        return {}

    faltam = [t for t in por_tel if _cache.get((tenant_id, t), (0.0, None))[0] <= agora]
    if faltam:
        try:
            achados = await erp_crm_client.nomes_dos_contatos(agent_tenant_id=tenant_id, telefones=faltam, timeout=3.0)
        except erp_crm_client.ErpCrmError as e:
            fora = "nao vinculado" in str(e).lower()
            _conta_pausada[tenant_id] = agora + (_TTL_CONTA_FORA if fora else _TTL_FALHA)
            logger.info("[nome_crm] tenant %s sem nomes do CRM: %s", tenant_id, e)
            achados = None
        except Exception:  # noqa: BLE001 — nome é luxo; a lista sai sem ele
            _conta_pausada[tenant_id] = agora + _TTL_FALHA
            logger.warning("[nome_crm] falha inesperada (tenant %s)", tenant_id, exc_info=True)
            achados = None
        if achados is not None:
            if len(_cache) > _MAX_CACHE:
                _cache.clear()
            for t in faltam:
                _cache[(tenant_id, t)] = (agora + _TTL_NOME, achados.get(t))

    saida: dict[str, str] = {}
    for tel, exts in por_tel.items():
        nome = _cache.get((tenant_id, tel), (0.0, None))[1]
        if nome:
            for ext in exts:
                saida[ext] = nome
    return saida


async def nome_do_crm_por_telefone(tenant_id: int | None, telefone: str | None) -> str | None:
    """O nome do CRM para um número solto (a conversa nova, que ainda não existe)."""
    digitos = re.sub(r"\D", "", telefone or "")
    if not digitos:
        return None
    return (await nomes_do_crm(tenant_id, [digitos])).get(digitos)

"""Rajada de mensagens do cliente: responde a ÚLTIMA, uma vez só (16/11/2026, M7 e CCDA).

O cliente manda «Bom dia» e, 2 s depois, «Reunião». Cada mensagem rodava a IA sozinha e em paralelo:
as duas achavam que era o primeiro contato e mandavam a saudação inteira — duas mensagens iguais.
Medido em 16/11/2026 (7 dias): 14 respostas duplas da IA em menos de 60 s (M7 6, CCDA 5, Tier 3);
entre as duas mensagens do cliente, 12 de 14 vieram com até 2,7 s, uma com 5,3 s e uma com 45 s.

A regra, em duas portas:
1. ANTES do modelo: espera curta (`agrupar_mensagens_s`, padrão 2,5 s). Chegou outra mensagem do
   cliente nesse meio tempo → esta cede a vez, sem chamar o modelo. A mais nova responde, com esta
   no histórico — a resposta cobre as duas.
2. DEPOIS do modelo, antes de enviar: chegou outra durante a geração (rajada mais espaçada que a
   espera) → descarta a própria resposta e deixa a mais nova responder. Exceção: se o modelo usou
   FERRAMENTA (agendou, cadastrou…), a ação já aconteceu e a resposta que a explica sai assim mesmo.

A mensagem que cede continua indo para o CRM (o ERP desduplica pela conversa): a 1ª mensagem de quem
vem de anúncio é a que traz a origem, e ela não pode se perder.

Configuração: `ta_runtime_param` (escopo='agent', escopo_id=<agente>, key='agrupar_mensagens_s'), em
segundos. Sem a linha = 2,5 s; `0` desliga a espera (a porta 2 continua). Teto 15 s (era 8; 25/11/2026, CCDA:
de 46 pares de mensagens com 5 a 12 s entre elas, a IA respondeu no meio em 22). Lida a cada
mensagem: editar vale na seguinte, sem deploy. Nada aqui levanta erro para quem chama.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math

from sqlalchemy import text as sa_text

logger = logging.getLogger(__name__)

PARAM_KEY = "agrupar_mensagens_s"
PADRAO_S = 2.5
MAX_S = 15.0  # com o «digitando» mínimo (5 s do CCDA corre junto) fica abaixo dos 25 s da Meta

_dormir = asyncio.sleep  # trocado nos testes


def ler_segundos(valor) -> float:
    """Valor do `ta_runtime_param` → segundos de espera. Sem valor = padrão; inválido = padrão; 0 = desligado."""
    if valor is None:
        return PADRAO_S
    bruto = valor
    if isinstance(bruto, str):
        texto = bruto.strip()
        if not texto:
            return PADRAO_S
        try:
            bruto = json.loads(texto)
        except (ValueError, TypeError):
            bruto = texto
    if isinstance(bruto, bool):
        return PADRAO_S
    if isinstance(bruto, str):
        try:
            bruto = float(bruto.strip().replace(",", "."))
        except ValueError:
            return PADRAO_S
    if not isinstance(bruto, (int, float)):
        return PADRAO_S
    s = float(bruto)
    if not math.isfinite(s) or s < 0:
        return PADRAO_S
    return min(s, MAX_S)


async def segundos_do_agente(agent_id: int) -> float:
    """Lê `agrupar_mensagens_s` numa sessão própria e curta. Falhou a leitura = padrão."""
    try:
        from sqlalchemy import select

        from core.db import db_context
        from models import TaRuntimeParam

        async with db_context() as s:
            valor = (
                await s.execute(
                    select(TaRuntimeParam.value)
                    .where(
                        TaRuntimeParam.escopo == "agent",
                        TaRuntimeParam.escopo_id == agent_id,
                        TaRuntimeParam.key == PARAM_KEY,
                    )
                    .order_by(TaRuntimeParam.id.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        return ler_segundos(valor)
    except Exception:  # noqa: BLE001
        logger.warning("rajada: leitura de %s falhou agent=%s — usa o padrão", PARAM_KEY, agent_id, exc_info=True)
        return PADRAO_S


async def chegou_outra(db, conversation_id: int, meu_id: int | None) -> bool:
    """Depois da mensagem `meu_id`, o cliente mandou outra nesta conversa? Na dúvida, não (responde)."""
    if not meu_id:
        return False
    try:
        ultima = (
            await db.execute(
                sa_text("SELECT max(id) FROM ta_message_log WHERE conversation_id = :c AND role = 'user'"),
                {"c": conversation_id},
            )
        ).scalar()
        return bool(ultima and int(ultima) > int(meu_id))
    except Exception:  # noqa: BLE001
        logger.warning("rajada: consulta falhou conv=%s — responde", conversation_id, exc_info=True)
        with contextlib.suppress(Exception):
            await db.rollback()
        return False


async def ceder_antes_do_modelo(db, agent_id: int, conversation_id: int, meu_id: int | None) -> bool:
    """Porta 1: espera curta; True = chegou outra mensagem do cliente e esta cede a vez."""
    if not meu_id:
        return False
    segundos = await segundos_do_agente(agent_id)
    if segundos <= 0:
        return False
    await _dormir(segundos)
    return await chegou_outra(db, conversation_id, meu_id)


async def descartar_depois_do_modelo(db, conversation_id: int, meu_id: int | None, usou_ferramenta: bool) -> bool:
    """Porta 2: True = a resposta pronta fica para trás (chegou outra durante a geração e não houve ação)."""
    if usou_ferramenta:
        return False
    return await chegou_outra(db, conversation_id, meu_id)

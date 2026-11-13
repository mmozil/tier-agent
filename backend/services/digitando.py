"""«digitando…» com tempo mínimo antes da resposta da IA (13/11/2026, CCDA).

Pedido do CCDA (agente 26, número oficial): «ela vai muito rápido e o pai desconfia que não é
humano… deixar digitando por uns 5 segundos». Até aqui o tempo de «digitando» era só a latência do
modelo: com resposta pronta em 1–2 s, o balão chegava quase junto dos três pontinhos.

A regra (por AGENTE, desligada por padrão):
- O relógio começa quando o «digitando…» foi pedido ao WhatsApp — depois do atraso de leitura do
  webhook — e para na hora de mandar o PRIMEIRO balão.
- Alvo = mínimo configurado + extra pelo tamanho da resposta + variação sorteada.
  · extra: +0,5 s a cada 100 caracteres além dos primeiros 100 do primeiro balão, no máximo +2 s
    (resposta longa «demora mais para digitar»);
  · variação: ± 20% do mínimo, no máximo ± 1 s (sem ela todo turno teria a mesma duração, e
    duração sempre igual também denuncia máquina).
  Com mínimo 5 s: resposta curta sai entre 4 e 6 s de «digitando»; a mais longa, entre 6 e 8 s.
  Teto = mínimo + 3 s.
- Se o modelo já levou mais que o alvo, manda NA HORA. A espera nunca soma por cima de um modelo
  lento: ela só completa o que falta.
- O mínimo aceito vai de 0 a 15 s. Com o teto, o «digitando» mais longo fica em 18 s, abaixo dos
  25 s em que a Meta apaga o indicador sozinha (ele também some quando a mensagem é enviada).

Configuração: `ta_runtime_param` (escopo='agent', escopo_id=<id do agente>, key='digitando_minimo'),
valor em segundos (`5`, `5.5`, `"5"`). Sem a linha, com valor inválido ou se a leitura falhar = 0 =
o comportamento de antes (manda assim que o modelo responde). Lida a cada resposta: editar vale na
mensagem seguinte, sem deploy.

A leitura usa sessão própria e curta: a sessão do turno não fica com transação aberta durante a
espera. Nada aqui levanta erro para quem chama — a resposta nunca deixa de sair por causa disto.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import time

logger = logging.getLogger(__name__)

PARAM_KEY = "digitando_minimo"
MINIMO_MAX_S = 15.0  # mínimo aceito na configuração (com o teto, 18 s < 25 s da Meta)
VARIACAO_MAX_S = 1.0  # ± sorteado em volta do alvo...
VARIACAO_FRACAO = 0.2  # ...limitado a 20% do mínimo (mínimo de 2 s não varia ± 1 s)
CARACTERES_SEM_EXTRA = 100  # até aqui a resposta conta como «curta»
EXTRA_POR_100_CARACTERES_S = 0.5
EXTRA_MAX_S = 2.0


def ler_minimo(valor) -> float:
    """Valor do `ta_runtime_param` → segundos de «digitando» mínimo. Inválido = 0 (desligado)."""
    if valor is None:
        return 0.0
    bruto = valor
    if isinstance(bruto, str):
        texto = bruto.strip()
        if not texto:
            return 0.0
        try:
            bruto = json.loads(texto)
        except (ValueError, TypeError):
            bruto = texto
    if isinstance(bruto, bool):  # `true` não é número de segundos
        return 0.0
    if isinstance(bruto, str):
        try:
            bruto = float(bruto.strip().replace(",", "."))
        except ValueError:
            return 0.0
    if not isinstance(bruto, (int, float)):
        return 0.0
    segundos = float(bruto)
    if not math.isfinite(segundos) or segundos <= 0:
        return 0.0
    return min(segundos, MINIMO_MAX_S)


def alvo_digitando(minimo: float, tamanho: int, sorteio: float) -> float:
    """Quanto tempo de «digitando» o turno deve ter. `sorteio` em [-1, 1]. Puro."""
    if minimo <= 0:
        return 0.0
    excedente = max(0, int(tamanho or 0) - CARACTERES_SEM_EXTRA)
    extra = min(EXTRA_MAX_S, excedente / 100 * EXTRA_POR_100_CARACTERES_S)
    variacao = min(VARIACAO_MAX_S, minimo * VARIACAO_FRACAO)
    sorteio = max(-1.0, min(1.0, float(sorteio)))
    return max(0.0, minimo + extra + sorteio * variacao)


def calcular_espera(minimo: float, decorrido: float, tamanho: int, sorteio: float) -> float:
    """Segundos a esperar antes do primeiro balão: o que falta do alvo. Nunca negativo. Puro."""
    return max(0.0, alvo_digitando(minimo, tamanho, sorteio) - max(0.0, float(decorrido)))


async def minimo_do_agente(agent_id: int) -> float:
    """Lê `digitando_minimo` do agente numa sessão própria (fecha antes de qualquer espera)."""
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
    return ler_minimo(valor)


def _sortear() -> float:
    return random.uniform(-1.0, 1.0)


_dormir = asyncio.sleep


async def aguardar(agent_id: int, desde: float | None, texto: str | None) -> float:
    """Completa o «digitando» mínimo do agente antes do primeiro balão. Devolve quanto esperou.

    `desde` = `time.monotonic()` de quando o «digitando…» foi pedido; `None` (canal sem
    «digitando», teste do painel, webchat) = não espera. Qualquer falha = não espera."""
    if desde is None:
        return 0.0
    try:
        minimo = await minimo_do_agente(agent_id)
        if minimo <= 0:
            return 0.0
        decorrido = time.monotonic() - desde
        espera = calcular_espera(minimo, decorrido, len(texto or ""), _sortear())
    except Exception:
        logger.exception("digitando mínimo: leitura falhou agent=%s — manda sem esperar", agent_id)
        return 0.0
    if espera > 0:
        logger.info(
            "digitando mínimo agent=%s: mínimo=%.1fs já passou=%.1fs espera=%.1fs",
            agent_id,
            minimo,
            decorrido,
            espera,
        )
        await _dormir(espera)
    return espera

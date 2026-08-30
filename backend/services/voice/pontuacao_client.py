"""Põe pontuação e maiúscula no texto cru do reconhecimento do navegador.

🚨 O DEFEITO QUE ISTO CONSERTA
O Web Speech do Chrome, em pt-BR, devolve UMA linha minúscula sem pontuação
nenhuma. O dono descreveu como "um linguição": para quem lê na tela é feio, e
para o modelo é pior — três perguntas coladas viram uma frase só.

    cru : vocês atendem no sábado qual o horário
    pont: Vocês atendem no sábado, qual o horário?

POR QUE NÃO WHISPER
O `whisper_local` também pontua, e pontua muito bem — mas custa **1,5 s** por
turno (medido na nossa CPU) e substituiria a escuta ao vivo do navegador, que é
o que mostra o texto enquanto a pessoa fala. Este caminho custa **~100 ms** e
não tira nada: o navegador continua escutando, e a limpeza acontece depois.

ONDE MORA
Container `tier-pontuacao` na rede interna do Coolify, mesmo padrão do
`kokoro-tts`: sem Traefik, sem porta publicada, com teto de memória. O modelo
ONNX tem 1,1 GB e o container do backend **não tem volume** — dentro dele o
cache morreria a cada deploy, e a primeira conversa pagaria o download inteiro.

🚨 FALHA AQUI NUNCA CALA O AGENTE. Qualquer erro devolve o texto cru, que é
exatamente como a conversa funciona hoje. Desligar = apagar `PONTUACAO_URL`.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

TIMEOUT_S = float(os.environ.get("PONTUACAO_TIMEOUT_S", "2.0"))


async def pontuar(texto: str) -> str:
    """Devolve o texto pontuado, ou o próprio texto se algo der errado.

    O timeout é curto de propósito: a pontuação leva ~100 ms, e esperar mais que
    2 s por ela desfaria o motivo de não usarmos o Whisper.
    """
    base = (os.environ.get("PONTUACAO_URL") or "").rstrip("/")
    cru = (texto or "").strip()
    if not base or not cru:
        return texto

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as cli:
            r = await cli.post(f"{base}/pontuar", json={"texto": cru})
        if r.status_code >= 400:
            logger.warning("pontuação: serviço devolveu %s", r.status_code)
            return texto
        saida = (r.json() or {}).get("texto") or ""
    except Exception as e:  # noqa: BLE001
        logger.warning("pontuação indisponível (%s) — sigo com o texto cru", e)
        return texto

    if not saida.strip():
        return texto

    # 🚨 Trava de sanidade: o modelo tem que PONTUAR, não reescrever. Se o número
    # de palavras mudou, alguma coisa saiu do lugar e o cru é mais confiável —
    # texto trocado numa conversa de matrícula é pior que texto sem vírgula.
    if len(saida.split()) != len(cru.split()):
        logger.warning("pontuação mudou a contagem de palavras (%d -> %d) — mantenho o cru",
                       len(cru.split()), len(saida.split()))
        return texto

    return saida

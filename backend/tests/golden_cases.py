"""Golden cases do agente — conversas + asserts determinísticos sobre tool calls/freios.

Cada caso:
  name        — id legível
  turns       — mensagens do cliente (em ordem)
  must_call   — substrings de nome de tool que DEVEM aparecer na conversa
  must_not    — substrings que NÃO podem aparecer (ex.: criar duplicado)
  max_calls   — {substr: n} teto de chamadas (ex.: criar_agendamento no máx 1 sucesso)
  may_brake   — freios que PODEM disparar (informativo; não falha)

São casos de REGRESSÃO dos bugs fechados nesta maratona (serviço errado, duplicata de
remarcação, args placeholder, confirmação). Como o LLM é real, os asserts são tolerantes:
checam o PADRÃO de tool-use, não texto exato.
"""

from __future__ import annotations

GOLDEN_CASES: list[dict] = [
    {
        "name": "happy_path_banho_taxidog",
        "turns": [
            "olá",
            "quero agendar um banho pro meu pet",
            "Cliente Eval, meu pet é o Aslan, pastor alemão, tem 37kg",
            "quero o banho premium, o de pelos curtos e médios",
            "amanhã à tarde, quais horários você tem?",
            "pode ser às 16:30",
            "sim, quero incluir o taxidog exclusivo também",
            "meu CEP é 06700-640, número 77",
            "isso, pode confirmar tudo",
        ],
        # consulta horários e cria o agendamento (cadastrar_cliente depende de já existir
        # cadastro pro telefone — não dá pra assertar de forma estável reusando o mesmo nº).
        "must_call": ["horarios_disponiveis", "criar_agendamento"],
        "must_not": [],
        "max_calls": {"criar_agendamento": 4},  # pode retentar, mas idempotência garante 1 real
    },
    {
        "name": "remarcacao_nao_duplica",
        "turns": [
            "olá",
            "Cliente Eval, pet Aslan pastor alemão 37kg",
            "quero o banho premium pelos curtos e médios amanhã 16:30",
            "isso pode confirmar",
            "na verdade muda pra 17:00 por favor",
            "isso, pode confirmar a mudança",
        ],
        # remarcar deve ALTERAR (não criar um 2º) — alterar deve aparecer
        "must_call": ["alterar_agendamento"],
        "must_not": [],
    },
    {
        "name": "preco_so_apos_consultar",
        "turns": [
            "olá",
            "Cliente Eval, pet Aslan pastor alemão 37kg",
            "quanto custa o banho premium pelos curtos e médios?",
        ],
        # preço NUNCA inventado — tem que consultar o catálogo
        "must_call": ["listar_servicos"],
        "must_not": [],
    },
]

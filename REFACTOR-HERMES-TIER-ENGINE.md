# Estudo & Plano — Refactor: substituir o Hermes pelo motor próprio do Tier Agent

> **Data:** 2026-06-04 · **Status:** estudo / proposta (não iniciado)
> **Objetivo:** remover a dependência do Hermes (NousResearch) como runtime de execução e substituí-lo por um motor de agente **próprio do Tier**, honrando o mesmo contrato. Intenção original do produto era *modelar* o Hermes, não *depender* dele.

---

## 1. O que o Tier Agent FAZ (e o que é Tier-owned vs Hermes)

Tier Agent (`agent.tier.finance`) = SaaS multi-tenant de agentes de IA configuráveis. A arquitetura tem duas metades:

### Control plane — **TUDO isto é código próprio do Tier** (~90% do produto)
- **Canais/conectores**: WhatsApp (via Tier Engine), Telegram, etc. (`connectors/`, `engine_client.py`)
- **Playbook Builder**: editor visual de fluxos (`playbook_executor.py`, `playbook_router.py`, `playbook_nodes/{triggers,llm,code,flow,integrations,mcp,memory,routing,text,voice}.py`)
- **Inbox/atendimento**: conversas, handoff humano, escalação, CSAT, SLA, atribuição, lead capture (`handoff.py`, `escalation.py`, `csat.py`, `assignment.py`, `lead_capture.py`)
- **Conhecimento/RAG**: `rag_engine.py` (pgvector + Cohere rerank), memória cross-session (`memory_service.py`, Mem0-like)
- **Skills**: `skill_builder.py`, `skill_extractor.py`
- **Guardrails/segurança**: `guardrails.py` (Lakera), `pii_redactor.py`, `content_moderation.py`
- **Cross-cutting**: `llm_cache.py`, `cost_calculator.py`, `budget_guard.py`, `langfuse_client.py`
- **Voz**: Deepgram STT + ElevenLabs TTS (`voice/`)
- **Billing/teams/business hours**, `tier_pay_client.py`, `mcp_client.py`, `code_executor.py`
- **Config de LLM por tenant**: `TaLlmProvider` (provider + default_model + api_key_enc + base_url + cadeia de fallback) — **o Tier JÁ guarda as credenciais e o modelo**.

### Execution engine — **isto é o Hermes** (a metade que falta ser nossa)
- O **loop de agente**: recebe `{model, system, messages, tools}` → roda o raciocínio (multi-turno), chama o LLM real, executa tool calls/skills → devolve a resposta.
- Exposto como **REST OpenAI-compatible**: `POST http://hermes-container:porta/v1/chat/completions`.
- 1 container Hermes por tenant (volume isolado `HERMES_HOME`, `TIER_LLM_MODEL` injetado).

---

## 2. Por que "não dava pra enxergar como o Tier se portaria como o Hermes"

Porque **hoje o Tier não executa IA — ele terceiriza 100% pro Hermes**. O Tier é o **gerente** (canais, playbooks, dados, UI, billing); o Hermes é o **trabalhador** (o cérebro que roda o LLM + ferramentas). Não existe nada no Tier hoje que "se porte como o Hermes" — essa capacidade vive **inteira** dentro do Hermes.

Toda chamada de IA (agente livre, nó LLM de playbook, classificação de intent, síntese de RAG) sai por **uma única função**: `hermes_proxy.send_message(...)`.

---

## 3. A fronteira exata (o que define o tamanho do refactor)

```
Tier control plane  ──(toda IA)──▶  hermes_proxy.send_message(messages, system, tools, model, attachments)
                                          │  HTTP POST
                                          ▼
                                    Hermes container :8642  /v1/chat/completions
                                          │  loop agente + tools + LLM real
                                          ▼
                                    HermesReply { content, tokens, model_used, raw }
```

- **Contrato:** entrada `(messages[], system, tools?, model, attachments?)` → saída `HermesReply`.
- **Call sites:** poucos — `agent_runtime.py` (agente livre) + `playbook_nodes/llm.py` (3 usos: generate, classify intent, RAG synth). É **uma superfície estreita**.

**Conclusão:** não é "reconstruir o Hermes inteiro". É **substituir 1 função** (`send_message`) por uma implementação própria que honre o mesmo contrato.

---

## 4. O que o Tier JÁ tem vs o que falta construir

| Peça | Status |
|---|---|
| Config LLM por tenant (`TaLlmProvider`: provider, modelo, key, fallback) | ✅ já existe |
| Ferramentas (MCP `mcp_client.py`, code `code_executor.py`, RAG `rag_engine.py`, memória `memory_service.py`) | ✅ já existe (hoje o Hermes que as orquestra) |
| Cache, custo, guardrails, PII, moderação | ✅ já existe |
| **Loop de agente próprio** (system+messages → LLM → tool calls → loop → resposta final) | ❌ **FALTA** — é o que o Hermes faz |
| **Client LLM direto** (chamar Anthropic/OpenAI/MiniMax sem passar pelo Hermes) | ❌ **FALTA** (hoje só o Hermes chama o LLM) |

O "miolo" a construir é **pequeno e bem definido**: um loop de tool-use agnóstico de provider (o mesmo padrão do tool-use da API Claude/OpenAI).

---

## 5. Plano de refactor (faseado, sem big-bang)

### Fase 0 — Decisão de design (1 dia)
- **Onde roda o motor?** Recomendação: **módulo in-process no backend** (`services/tier_engine.py`), não um container por tenant. Multi-tenant por chamada (isolamento lógico via config), não por container. Elimina toda a complexidade de orquestração Docker/SSH (`container_orchestrator.py`, `containers.py`) + a superfície de segurança (foi o que causou o incidente).
- **Client LLM**: client unificado fino sobre os SDKs (Anthropic/OpenAI/MiniMax) lendo `TaLlmProvider` + cadeia de fallback. (A skill `claude-api` cobre o loop de tool-use idiomático.)

### Fase 1 — `tier_engine.send_message` (núcleo) (2-4 dias)
- Implementar o loop de agente: monta system+messages → chama LLM → se houver tool_calls, executa (via `mcp_client`/`code_executor`/`rag_engine`/`memory_service`) → re-injeta resultado → repete até resposta final.
- Mesma assinatura e mesmo `HermesReply` de saída do `hermes_proxy`. **Drop-in.**
- Vision/attachments: o Tier já monta payload multimodal; portar.

### Fase 2 — Swap atrás de feature flag (1-2 dias)
- Flag por tenant `engine=hermes|tier`. `hermes_proxy.send_message` vira um dispatcher: flag `tier` → `tier_engine`; senão Hermes (fallback).
- Rodar em **shadow/canary** num tenant de teste, comparar respostas.

### Fase 3 — Migrar skills/workspace (2-3 dias)
- As skills do Hermes são markdown no workspace dele. Portar pro modelo de skills do Tier (`skill_builder`) OU injetar como system/tools no `tier_engine`.
- Migrar SOUL/TOOLS/persona pra config do Tier (`TaAgent.persona`).

### Fase 4 — Cutover + remoção (1 dia)
- Virar a flag pra `tier` em todos os tenants. Validar.
- **Remover Hermes**: `container_orchestrator.py`, `containers.py`, `hermes_proxy.py`, `HERMES_IMAGE`, imagem `tier/hermes`, volumes. Zero dependência + zero superfície.

**Esforço total estimado:** ~1.5–2.5 semanas de dev focado. **Risco:** médio — mitigado por flag + shadow + fallback pro Hermes durante a transição.

---

## 6. Ganhos do refactor
- ✅ **Zero dependência de terceiro** (intenção original) — motor é 100% Tier.
- ✅ **Elimina a superfície de segurança** que causou o incidente (sem container de agente exposto, sem SSH/Docker orchestration).
- ✅ **Mais simples**: 1 módulo in-process em vez de N containers + volumes + portas + orquestração.
- ✅ **Mais barato**: sem overhead de container por tenant.
- ✅ **Controle total**: cache/custo/guardrails/PII aplicados no mesmo lugar, sem round-trip REST.

## 7. Pendências antes de começar
- ⚠️ **App Review Meta em andamento** — o Tier Agent vai ser usado na parceria. O refactor **não pode quebrar** o produto durante a análise. Por isso: flag + shadow + fallback (Fases 2-3), cutover só após validação.
- Decidir: in-process (recomendado) vs manter 1-container-por-tenant (se isolamento forte por tenant for requisito de compliance).

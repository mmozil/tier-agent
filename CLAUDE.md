# CLAUDE.md — Tier Agent

Guia pra Claude Code trabalhar neste repositório.

## Resumo

**Tier Agent** = 5º produto Tier (`agent.tier.finance`): SaaS de **agentes de IA configuráveis** que atendem clientes via WhatsApp e outros canais. Multi-tenant (1 container Hermes por tenant). Inspirado em Hermes Agent (NousResearch) sem fork.

- **Repo:** `mmozil/tier-agent` (branch `master`)
- **Stack:** FastAPI + Postgres + Redis + React/Vite + Tailwind. Backend porta 8100; frontend 5174 (dev).
- **Domínios:** `agent.tier.finance` (frontend) · `api-agent.tier.finance` (backend)

## Deploy (IMPORTANTE)

**Deploy é MANUAL via API Coolify** — o repo **NÃO tem webhook GitHub** (diferente do tier-finance). `git push` não deploya sozinho.

- Frontend Coolify UUID: `p88cwcwgs4kg84goow4s0w8w`
- Backend Coolify UUID: `f4w8co800kcgog4w08ssww4k`
- Disparar: `curl -X GET "https://coolify.tier.finance/api/v1/deploy?uuid=<UUID>&force=false" -H "Authorization: Bearer 5|claude-deploy-token-2026"`
- Poll: `GET /api/v1/deployments/<deployment_uuid>` (status → `finished`, ~60-105s)
- **Pós-deploy frontend:** purgar Cloudflare (zona `319ce1723892e1a8dc2e372a1c11909c`, hosts `agent.tier.finance`).
- Env vars no Coolify via API (`POST/PATCH /applications/{uuid}/envs`). Vite `VITE_*` precisa `is_buildtime=true`.

## Canais de WhatsApp (2 caminhos)

### 1. WhatsApp Cloud API OFICIAL (Meta) — produção, zero ban ✅
Caminho de produção. Conector `whatsapp_cloud` no backend (REST + webhook). **Doc canônica:** `.docs/whatsapp-oficial-embedded-signup.md`.
- App produção: **Tier Agent API Oficial** `1644748586815003` (Tech Provider, empresa Out Group verificada).
- Embedded Signup Config ID: `876861955432555` (criado via **modelo** "Cadastro incorporado do WhatsApp 60 dias" — variação WhatsApp só aparece via modelo/Tech Provider).
- Botão `ConnectWhatsAppCloud.tsx` (FB SDK) → `POST /connectors/whatsapp-cloud/onboard` (code→token→conector).
- **Pendente:** App Review (Advanced Access) pra clientes externos. Pacote pronto em `.docs/app-review-submission.md`.
- Atendimento reativo grátis; disparo marketing pago + opt-in (cliente paga na WABA dele → Tier sem risco financeiro).

### 2. Baileys (Tier WhatsApp Engine) — entrada/teste, RISCO DE BAN ⚠️
Conector `whatsapp` (fala com `whats.tier.finance`). Baileys é não-oficial: toma ban (número de teste foi restringido pela Meta). Manter só como tier de entrada. Ver memória `project-engine-baileys-instability-20260528`.

## Modelo LLM + Atendimento (atualizado 29/mai/2026)

### Modelo: MiniMax-M2 em produção (Claude/Haiku BLOQUEADO pela imagem)
- **Modelo ativo = MiniMax-M2** (provider config-driven via `TaLlmProvider`). O `tier-entrypoint.sh` do container lê `TIER_LLM_PROVIDER/MODEL/API_KEY` → `hermes config set`. Trocar = `TaLlmProvider` (tenant-específico ativo ganha do global) + `container_orchestrator.create_container` (recria; `restart_container` NÃO basta — só `docker restart`, mantém env).
- ⚠️ **Claude/Haiku NÃO funciona nesta imagem `tier/hermes:0.14.0-tier1`**: o `run_agent` **ignora `model.default`** e usa sempre `claude-opus-4-6` (thinking-first) → em conversa multi-turno reenvia thinking blocks com assinatura inválida → HTTP 400 `Invalid signature in thinking block` (agente para). Pra usar Claude precisa **rebuild da imagem** (run_agent honrar o modelo + desligar thinking). Crédito Anthropic intacto.
- **Filtro anti-CJK** (`agent_runtime._sanitize_reply`): MiniMax às vezes vaza chinês/japonês/coreano em pt-BR → removidos antes do envio. Inglês/espanhol NÃO são filtráveis (teto do MiniMax — só some com Claude). Persona tem regra "só pt-BR" como 1ª camada.

### Funcionalidades de atendimento (todas plataforma — valem p/ todo agente)
- **Captura de lead** (`services/lead_capture.py`): detecta intenção de compra/telefone → `TaNotification(category=lead)`.
- **Handoff humano** (`services/handoff.py`): pedido de atendente → curto-circuita antes do LLM → `TaNotification(category=handoff)` + resposta padrão.
- **Inbox de conversas** (`routes/conversations.py` + coluna `ta_message_log.content` via ensure idempotente em `main.py`): tela `/admin/leads` (Leads & Notificações) + `/admin/conversas` (histórico).
- **Split de mensagens** (`_split_into_bubbles`): resposta > 700 chars → até 4 balões.
- **Timing humanizado** (`webhooks._process_cloud_message_humanized`): atraso de leitura ~2-3s antes de digitar.
- **Persona consultiva + anti-alucinação**: entende antes de apresentar; nunca inventa (ERP é web, sem app dedicado; o que não sabe → encaminha consultor). Editada direto em `TaAgent.persona` (live, sem deploy) + `llm_cache.invalidate` após editar.

### RAG (pgvector) — pronto mas NÃO ativado
- `rag_engine.py` corrigido pra `gemini-embedding-001` + `embedContent` + `outputDimensionality=768` (text-embedding-004 aposentado; batchEmbedContents não suportado). Embeddings = etapa separada do chat (Anthropic NÃO tem embeddings — recomenda Voyage; usamos Gemini free OU MiniMax embo-01).
- **NÃO wirado no `agent_runtime`**: pra conhecimento PEQUENO a persona é MELHOR (RAG com chunks grandes recupera mal). Ativar só quando cliente tiver base GRANDE: chunking menor + `rag_engine.search` injetado no system prompt + `GEMINI_API_KEY` no Coolify.

### Agente de teste / App Review
- Agente "Maria Luiza" = `agent_id 2`, tenant **Out Group** (id 3), número **+55 11 92336-2467** (Cloud API oficial, token System User permanente).
- **App Review submetido** (29/mai, "em análise", ~10 dias). Login de teste do reviewer: `reviewer@tier.finance` / `TierReview2026!` (tenant 5). Pós-aprovação: **Publicar** (tirar de "Não publicado").

## Arquitetura backend

- `routes/` — connectors, agents, webhooks, playbooks, billing, containers, etc.
- `services/connectors/adapters/` — `whatsapp` (Baileys via Engine), `whatsapp_cloud` (Cloud API oficial), telegram, email, instagram. Registry em `services/connectors/registry.py`.
- `services/agent_runtime.py` — `handle_inbound_message` (resolve conector por instance_id/phone_number_id → LLM via Hermes container do tenant → responde pelo canal).
- `services/hermes_proxy.py` — fala com o container Hermes do tenant (1 por tenant). **Usar `container_orchestrator.get_container_by_tenant(db, tenant_id)`**, NUNCA `db.get(TaContainer, tenant_id)` (PK é `id`, não tenant_id).
- Webhooks: `/webhooks/whatsapp-cloud` (Cloud API, HMAC multi-secret) · `/webhooks/whatsapp-engine` (Baileys) · telegram/instagram/email.

## Gotchas

- **Auth 401 interceptor** (`lib/api.ts`): só redireciona pra /login em rotas protegidas (`/admin`, `/dashboard`). NUNCA global — senão quica a landing pública (mascarado por CORS em dev).
- **TaContainer**: PK é `id`, não `tenant_id`. Usar `get_container_by_tenant`.
- **Webhook event_id**: usar o `key.id` real da mensagem (a Engine manda `instance_id`/`timestamp` snake_case, não `instanceId`/`ts` — senão event_id vira constante e tudo após a 1ª msg é "duplicata").
- **FB.login callback** não pode ser `async` (SDK rejeita) — usar função normal + IIFE.
- **Cloud API**: variação Embedded Signup só via modelo; app precisa ser Tech Provider; Vite vars build-time.
- **Modelo do agente NÃO é `model.default`**: o `run_agent` da imagem força `claude-opus-4-6` quando provider=anthropic, ignorando a config → thinking-signature 400. Por isso MiniMax é o modelo de produção. Trocar modelo de verdade exige rebuild da imagem.
- **Conversa "envenenada"**: se um histórico (sessão Hermes `conv-{id}`) acumulou thinking blocks (do opus), fechar a conversa (`TaConversation.status='closed'`) força sessão nova/limpa. Mas isso NÃO conserta o Claude (opus regenera thinking) — só MiniMax resolve.
- **Editar persona é live (sem deploy)** — `TaAgent.persona` no DB; sempre `llm_cache.invalidate(tenant_id, agent_id)` depois.

## Convenções
- Comentários/docs em pt-BR. Python: Ruff line-length 120, double quotes. TS: strict, zero-warning. `npm run build` antes de commit no frontend.
- Memória canônica: `project_tier_agent_whatsapp_oficial.md` (mais completa — modelo, atendimento, RAG, App Review), `project_tier_agent.md` (+ Q1/Q2/Q3, playbook builder).
- Obsidian: `projetos/Tier/Tier Agent/`.

_Última atualização: 29/mai/2026 — atendimento (lead/handoff/inbox/split/consultivo), modelo MiniMax (Haiku bloqueado), filtro CJK, RAG pronto-não-ativado, App Review submetido._

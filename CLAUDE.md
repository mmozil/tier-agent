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

## Convenções
- Comentários/docs em pt-BR. Python: Ruff line-length 120, double quotes. TS: strict, zero-warning. `npm run build` antes de commit no frontend.
- Memória canônica: `project_tier_agent_whatsapp_oficial.md`, `project_tier_agent.md` (+ Q1/Q2/Q3, playbook builder).
- Obsidian: `projetos/Tier/Tier Agent/`.

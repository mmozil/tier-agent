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
- **Captura de lead** (`services/lead_capture.py`): detecta intenção de compra/telefone → `TaNotification(category=lead)` + dispara alerta externo.
- **Handoff inteligente** (`services/handoff.py` + `services/escalation.py`): pedido de atendente → curto-circuita antes do LLM, **PAUSA o bot** (`TaConversation.status='handed_off'` → no próximo inbound o `agent_runtime` retorna `handed_off_paused` sem chamar LLM), cria `TaNotification(category=handoff)` com **warm summary** (motivo + contato + fatos + últimas msgs, determinístico, sem custo LLM) + resposta padrão + alerta externo.
- **Escalonamento por sinal** (`escalation.py`): `is_frustrated` (palavrão/ameaça/caps/!!!) e `detect_loop` (2+ "não sei" do assistente seguidos) → **alertam o time sem pausar** o bot (reason no payload). Ref: Intercom/Chatwoot/Respond.io (sentimento é multiplicador, não pausa sozinho).
- **Alerta externo pra equipe** (`services/team_alert.py`): "me chama quando precisar". Avisa por **WhatsApp** (pelo próprio canal do agente → número do time) e/ou **e-mail**. Config por tenant em `TaRuntimeParam` (escopo=tenant): `alert_whatsapp` / `alert_email` / `alert_enabled`. UI em `/admin/leads` (card "Onde te avisamos"). Sem destino → no-op silencioso.
- **Assumir/Devolver/Resolver** (`routes/conversations.py`): `POST /conversations/{id}/handoff` (humano assume, pausa IA) · `/resume` (devolve pra IA) · `/resolve` (encerra, e por padrão dispara CSAT). Botões no drawer de `/admin/conversas` + badge de status.
- **Responder pelo painel** (`POST /conversations/{id}/reply`): atendente envia no canal do cliente (WhatsApp/Telegram/email), grava `role='agent'`, pausa a IA. Caixa de resposta no drawer (Enter envia). `_send_via_channel` é o helper de envio compartilhado.
- **Notas internas** (`POST /conversations/{id}/note`, `role='note'`): visível só pra equipe, NÃO vai pro cliente. Toggle "Responder / Nota interna" no composer (balão âmbar).
- **Respostas prontas** (`routes/canned_responses.py`, `TaCannedResponse` tenant-scoped, ensure DDL): atalhos inseridos com 1 clique. `CannedPicker.tsx` (botão ⚡) no composer com CRUD inline.
- **Etiquetas/tags** (`ta_conversation.tags` JSONB, ensure DDL): `PUT /conversations/{id}/tags` (normaliza trim/lower/dedup/max 8). Chips na lista + editor no drawer + barra de filtro `?tag=`.
- **Atribuição** (`ta_conversation.assigned_to`, lightweight sem tabela de usuários): `PUT /conversations/{id}/assign`. Campo "Atendente" no drawer.
- **CSAT** (`services/csat.py` + `ta_conversation.csat_state/csat_score/csat_at`): resolve envia "de 0 a 5…"; `maybe_capture_csat` roda ANTES de `ensure_conversation` (senão abriria conversa nova) e captura o número 0-5 da resposta seguinte → grava + agradece. Badge ⭐ no drawer.
- **SLA** (`scheduler.sla_watch_job`, 120s + param tenant `sla_minutes`): conversa `handed_off` cuja última msg é do cliente e está parada > SLA → `TaNotification(category='sla')` + alerta externo, 1x por espera (anti-spam `sla_alerted_at`). 0 = desligado. Config em `/admin/leads`.
- **Relatórios de atendimento** (`routes/reports.py` → `GET /reports/atendimento?days=`): volume, status, handoffs/leads/SLA, CSAT (média+distribuição), por etiqueta, por atendente. Página `/admin/relatorios-atendimento` (`RelatoriosAtendimentoPage.tsx`).
- **Equipe / multi-usuário** (`TaMember` + `routes/team.py`): atendentes com login próprio. Dono = `TaTenant` (auth inalterado); atendentes = `TaMember`. `/auth/login` loga os dois (tenta tenant, depois member). `CurrentUser` carrega `member_id`/`member_name`/`role` (owner|admin|atendente). Tela `/admin/equipe` (`EquipePage.tsx`): CRUD + status online. Convite = dono cria com senha inicial (sem dependência de e-mail).
- **Fila / round-robin** (`services/assignment.py`): no handoff com pausa, `auto_assign` distribui pro atendente **online com menor carga** (respeita `max_conversas`; dono não entra no rodízio). `ta_conversation.assigned_member_id`. Abas **Todas / Não atribuídas / Minhas** (`?scope=`) na inbox. Dropdown de atendente no drawer (`PUT /assign {member_id}`). Toggle online no topbar (`OnlineToggle.tsx` → `POST /team/online`, só atendente).
- **@menção em notas** (`ta_notification.target_member_id`): na nota interna, chips "Marcar: @fulano" → `POST /note {mentions:[member_id]}` cria notificação `category='mention'` direcionada. Inbox/sino filtram por `target_member_id` (atendente vê broadcasts + as suas; dono vê tudo).
- **Sino real** (`components/NotificationBell.tsx`): badge com `GET /notifications/stats` (poll 20s) + dropdown com não-lidas → `/admin/leads`.
- **Inbox de conversas** (`routes/conversations.py` + coluna `ta_message_log.content` via ensure idempotente em `main.py`): tela `/admin/leads` (Leads & Notificações, mostra motivo+resumo) + `/admin/conversas` (histórico + ações).
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

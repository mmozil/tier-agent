# CLAUDE.md — Tier Agent

Guia pra Claude Code trabalhar neste repositório.

## Resumo

**Tier Agent** = 5º produto Tier (`agent.tier.finance`): SaaS de **agentes de IA configuráveis** que atendem clientes via WhatsApp e outros canais. Multi-tenant.

> 🔄 **REFACTOR 04/jun/2026 — motor próprio `tier_engine` (Hermes removido).** O Tier Agent NÃO depende mais do Hermes. A execução de IA agora é **in-process** via `backend/services/tier_engine.py` (client LLM multi-provider lendo `TaLlmProvider` + cache + PII + tool-use), substituindo o antigo `hermes_proxy` + container Hermes por tenant. **Todos os nomes "hermes" foram removidos do código** (`hermes_proxy`→`tier_engine`, `HermesReply`→`EngineReply`, palavra `hermes`→`engine` em ~19 arquivos). Código de orquestração de container (`container_orchestrator.py`, `routes/containers.py`, `ENGINE_IMAGE` ex-`HERMES_IMAGE`, model `TaContainer`) está **dormente** (não usado pelo motor in-process) — remover em limpeza futura. **Pendente: validação runtime + cutover só após shadow (TRAVA: App Review Meta em andamento). Não deployado.** Detalhe: `REFACTOR-HERMES-TIER-ENGINE.md` + Obsidian `[[202606041700 - Refactor Tier Engine (remove Hermes)]]`. As gotchas abaixo sobre "container Hermes / imagem tier/hermes / thinking blocks opus" são **históricas** (do motor antigo).

> 📒 **Organização dos agentes (04/jun/2026, tenant 3 Out Group):** `agent 2` = **"Tier Empresas Atendimento"** (Maria Luiza, WhatsApp **Cloud API oficial**, phone_number_id `1105955629273371`, waba `1306815574284515`) · `agent 5` = **"DevSecOps"** (alertas SecOps, número `11941452082`, Baileys instância `b71e04fd` reusada). **Conector `whatsapp_cloud` é frágil** — clicar a lixeira em Canais apaga a linha **e o token junto** (token só vive ali, criptografado). Se cair em `no_connector`: regenerar **System User token permanente** (business.facebook.com → Usuários do sistema → app `1644748586815003`, scopes whatsapp_business_messaging+management, validade Nunca) e recriar o conector (`TaConnector(agent_id=2, kind='whatsapp_cloud', config={phone_number_id, token, waba_id})`). Validar token: `GET /v21.0/debug_token` → `type=SYSTEM_USER`, `expires_at=0`. **Nunca** logar o token no stdout. **Recuperação <1h (dead tuple, 25/jun)**: se apagou agora, `pg_dirtyread` na `ta_connector` (instalar `postgresql-17-dirtyread` no PG `tog0wc8gg`/DB `tier_agent`) lê a linha morta e reusa o blob cifrado (token nunca exposto) — janela ~1h (HOT-prune). **🛡️ Blindagem env (ATIVA 25/jun)**: `WHATSAPP_CLOUD_TOKEN`/`_PHONE_NUMBER_ID`/`_WABA_ID` no Coolify (`resolve_cloud_creds` fallback) → número sobrevive a delete do conector. Token+IDs no Cofre-Segredos (Obsidian).

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
- ✅ **App Review APROVADO 18/jul/2026** (Advanced Access) + **Embedded Signup LIBERADO pra clientes externos 07/ago/2026**. 🚨 O que destravou o "Out Group não pode integrar clientes" **NÃO foi o App Review** — foi **concluir a integração de Provedor de Tecnologia** (`Casos de uso → Conectar-se com clientes pelo WhatsApp → Início rápido → Torne-se um Provedor de Tecnologia → Iniciar integração → Independent Tech Provider`). App Review aprovado + app publicado NÃO basta. Detalhe: `.docs/whatsapp-oficial-embedded-signup.md`.
- **🚨 Custo por mensagem (mudou):** atendimento (service na janela 24h) grátis **só até 30/set/2026** → **1/out/2026 vira PAGO** (~R$0,04–0,19/msg BR, sem desconto de volume, vale pra "third-party AI agent" = a Yanna). Marketing pago sempre (~R$0,31–0,38). Cada cliente paga na WABA dele. **NÃO é "AI Provider"** (essa taxa é só p/ assistente de propósito geral tipo ChatGPT/Perplexity — negócio usando IA no atendimento está excluído; manter agentes escopados ao negócio). Detalhe: `.docs/whatsapp-cloud-api-setup.md`.

### 2. Baileys (Tier WhatsApp Engine) — entrada/teste, RISCO DE BAN ⚠️
Conector `whatsapp` (fala com `whats.tier.finance`). Baileys é não-oficial: instável (queda ~5h em 17/jul) + risco de ban. **Meta NÃO cobra Baileys** (não passa pela plataforma oficial) — por isso é "grátis" mas frágil. Manter só como tier de entrada. Ver memória `project-engine-baileys-instability-20260528`.

### Mapa de canal por agente (jul/2026)
- **agent 2 (Maria Luiza, Tier Empresas)** → **Cloud API** (`whatsapp_cloud`, número `11 92336-2467`, phone_number_id `1105955629273371`).
- **agent 6 (Yanna, petshop)** → **Baileys** (número `19 98114-5480`, instância `b008c371`). **A migrar p/ Cloud API** — plano em `.docs/migracao-yanna-baileys-para-cloud-20260720.md`.
- **agent 5 (DevSecOps)** → **Baileys** (número `11 94145-2082`, instância `7748dba8` — **caída** em 17/jul, precisa reconectar).

## Modelo LLM + Atendimento (atualizado 29/mai/2026)

> ⚙️ **PROVEDOR ATIVO ATUAL (17/jun/2026): `openai/gpt-4o-mini` via OpenRouter (`ta_llm_provider` id5, tenant 6, temperature 0.2, priority 50).** O dono testou Haiku (Anthropic direto, id6) mas a conta Anthropic **zerou créditos** → a Yanna ficou MUDA (todo inbound = `engine_error`). Troquei pro gpt-4o-mini (OpenRouter = saldo SEPARADO). **Temperatura 0.2 é proposital** (a 0.7 o gpt-4o-mini enchia args de tool com placeholder "Serviço 1"/data fake). **🚨 LIÇÃO:** provedor LLM ativo sem saldo = outage TOTAL e silencioso do agente (só `engine_error` no log). Saldos por conta são distintos (Anthropic-direto ≠ OpenRouter). Restaurar = ativar provedor de saldo separado (`UPDATE ta_llm_provider SET active=true,priority=50 WHERE id=5; ... active=false WHERE id=6`). Manter gpt-4o-mini como rede de segurança no `fallback_chain`. Detalhe: memory `feedback_llm_provider_creditos_outage` + `feedback_weak_model_tool_args_temperature`.

### Modelo: MiniMax-M2 em produção (Claude/Haiku BLOQUEADO pela imagem) — HISTÓRICO (motor antigo Hermes)
- **Modelo ativo = MiniMax-M2** (provider config-driven via `TaLlmProvider`). O `tier-entrypoint.sh` do container lê `TIER_LLM_PROVIDER/MODEL/API_KEY` → `hermes config set`. Trocar = `TaLlmProvider` (tenant-específico ativo ganha do global) + `container_orchestrator.create_container` (recria; `restart_container` NÃO basta — só `docker restart`, mantém env).
- ⚠️ **Claude/Haiku NÃO funciona nesta imagem `tier/hermes:0.14.0-tier1`**: o `run_agent` **ignora `model.default`** e usa sempre `claude-opus-4-6` (thinking-first) → em conversa multi-turno reenvia thinking blocks com assinatura inválida → HTTP 400 `Invalid signature in thinking block` (agente para). Pra usar Claude precisa **rebuild da imagem** (run_agent honrar o modelo + desligar thinking). Crédito Anthropic intacto.
- **Filtro anti-CJK** (`agent_runtime._sanitize_reply`): MiniMax às vezes vaza chinês/japonês/coreano em pt-BR → removidos antes do envio. Inglês/espanhol NÃO são filtráveis (teto do MiniMax — só some com Claude). Persona tem regra "só pt-BR" como 1ª camada.

### Injeção GLOBAL no system prompt (11-12/jun/2026 — vale p/ TODO agente)
Em `services/agent_runtime.py`, depois do bloco de contato (**secundário à persona** → não altera quem já está calibrado, ex: Maria Luiza do Out Group):
- **Data/hora atuais** em fuso `America/Sao_Paulo` (`_agora = datetime.now(ZoneInfo(...))`) — resolve o "não sei o dia/horário".
- **Diretrizes base** (anti-burrice): não repetir pergunta já respondida; **USAR ferramentas** em vez de perguntar o que dá pra consultar; nunca inventar horário/preço/dia; informar valor ANTES de confirmar; ação executada por ferramenta é **REAL** (nunca dizer "não foi criado"; pra cancelar, achar na agenda e cancelar de fato).
- **Atendimento padrão Apple**: A.P.P.L.E. (acolher / entender o problema / propor solução / ouvir com empatia / encerrar caloroso) + Feel-Felt-Found + "ajudar antes de vender" + nunca encerrar abrupto ("cancelei, tchau").
- **`_sanitize_reply`** (já existia anti-CJK) também remove **emoji de bandeira aleatório** (regional indicators U+1F1E6–1F1FF) que o MiniMax cuspia.
- **`_format_for_whatsapp(text)`** (só canais `whatsapp`/`whatsapp_cloud`, gate `_is_wa`): normaliza markdown que o WhatsApp NÃO entende → `**x**`/`__x__`→`*x*`, `## título`→`*título*`, marcadores `-`/`·`/`*`→`• `, colapsa quebras. WhatsApp usa `*negrito*`/`_itálico_` **nativo**, não markdown. Aplicado após `_sanitize_reply` quando `_is_wa`. Há também uma diretriz de formatação WhatsApp injetada no prompt quando `_is_wa`.

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
- **Horário de atendimento** (`services/business_hours.py`, params tenant `bh_enabled/bh_days/bh_start/bh_end/bh_message`, fuso `America/Sao_Paulo`): a IA roda 24/7; fora do expediente o **handoff** responde a mensagem de fora-de-horário em vez da padrão. Config em `/admin/leads`. `is_open()` retorna True se desligado.
- **Convite por link** (`TaMember.invite_token` + status `invited`): dono cria atendente **sem senha** → gera token, copia link `…/convite/{token}`. Endpoints públicos `GET /team/invite/{token}` + `POST /team/invite/{token}/accept` (atendente define senha, ativa). Página pública `AcceptInvitePage` (`/convite/:token`). Com senha = ativa direto (fluxo antigo mantido).
- **Snooze** (`ta_conversation.snoozed_until`): `POST /conversations/{id}/snooze {minutes}` / `/unsnooze`. Some das visões ativas até a hora chegar (aba "Adiadas" mostra só elas). `ensure_conversation` limpa o snooze quando o cliente volta a escrever. Botão "💤 Adiar…" (1h/4h/24h) no drawer.
- **Sino real** (`components/NotificationBell.tsx`): badge com `GET /notifications/stats` (poll 20s) + dropdown com não-lidas → `/admin/leads`.
- **Inbox de conversas** (`routes/conversations.py` + coluna `ta_message_log.content` via ensure idempotente em `main.py`): tela `/admin/leads` (Leads & Notificações, mostra motivo+resumo) + `/admin/conversas` (histórico + ações).
- **Split de mensagens** (`_split_into_bubbles`): resposta > 700 chars → até 4 balões.
- **Timing humanizado**:
  - Path Cloud: `webhooks._process_cloud_message_humanized` (pausa de leitura ~2-3s antes de digitar).
  - Path Engine/Baileys: `webhooks._process_engine_message` — pausa curta de leitura → **`send_typing`** ("…digitando") → LLM (a latência do LLM = tempo de digitação visível) → envia. **REMOVIDO** o `asyncio.sleep(3)` aditivo que somava EM CIMA do LLM (era "demora demais"). Agora igual ao path Cloud.
  - **Indicador "…digitando"** (`services/connectors/adapters/whatsapp.py.send_typing(cfg, to, state="composing")`): `POST {engine}/v1/instances/{id}/presence` → o cliente vê o status digitando no WhatsApp.
- **Persona consultiva + anti-alucinação**: entende antes de apresentar; nunca inventa (ERP é web, sem app dedicado; o que não sabe → encaminha consultor). Editada direto em `TaAgent.persona` (live, sem deploy) + `llm_cache.invalidate` após editar.

## Federação MCP — Hovio Pet (agente "Nicoly") + Espelho de Conversas (11-12/jun/2026)

A **Yanna** (ex-"Nicoly") = agente do Tier Agent conectado (via MCP/OAuth) a um petshop do **Hovio Pet** (`agent_id=6`, tenant 6). Atende no WhatsApp + tem suas conversas espelhadas no painel do Pet. **TUDO DEPLOYADO em prod.**
> 🔀 **Petshop-alvo repontado 20/jul/2026:** o token dela apontava pra petshop **PetduBem/BSPC** (`cmpm3y0z4…`, petdubem@gmail.com); repontei pro **`dev@hovio-pet.com` / "Marcelo Morais"** (`cmpgcczin0000kj01aagi792g`) porque estão em período de TESTE (a demo vive no dev@). **Mecanismo:** `UPDATE ta_agent_access_token.petshopId` (no DB do **Pet**) da linha do token ativo (achar por `accessTokenHash`) — durável porque o refresh (`rotateRefreshToken`) copia o `petshopId` da linha antiga. Confirmado via MCP (`pet_info_petshop` → "Marcelo Morais"). Revert: voltar o `petshopId` na mesma linha. Detalhe: memory `project_yanna_repoint_e_migracao_cloud_20260720`.

### Webhook Engine processa em BACKGROUND (`routes/webhooks.py`)
`whatsapp_engine_webhook` agora processa em **background**: `_process_engine_message` via `asyncio.create_task` (+ `db_context()` próprio) e o webhook devolve `{"status":"accepted"}` **na hora**. A idempotência (`_record_idempotent`) roda **inline antes** do enfileiramento.
- **Por quê:** antes era inline e segurava o `200` durante delay + LLM + envio → estourava o **timeout do Engine** → reenvio/loop + "aguardando mensagem" travado no WhatsApp do cliente.
- 🔒 **LIÇÃO:** webhook **NUNCA** segura o `200` durante LLM/delay. Aceita, responde rápido, processa em task.

### Espelho de Conversas (Pet ← Tier Agent)
Pra o petshop ver o atendimento da IA na aba **"Conversas"** do próprio painel (v1 read-only):
- **Tempo real (fire-and-forget):** `services/pet_mirror.py.mirror_recent_to_pet(agent_id, conv_id)` — push logo após cada msg, chamado no fim de `handle_inbound_message`. Lê `ta_message_log` (`criadaEm` bate com o job → dedup do Pet não duplica).
- **Backstop (job):** `scheduler.mirror_pet_conversations_job` (`IntervalTrigger`, **60s** — era 180s) empurra as conversas WhatsApp dos agentes com `tool_provider='hovio-pet'` pro endpoint **`/api/agent/mirror`** do Pet. `ensure_fresh_token` + decrypt bearer; envia `agente_nome` + `agente_foto_url`. Best-effort (falha só loga); lock Redis por tick (`mirror_pet`, TTL 50s).
- O Pet **deduplica** por `(conversa, criadaEm)` → reenvio é inofensivo.

### Foto/avatar do agente (aparece nos balões do Pet)
- Coluna `TaAgent.avatar_url` (DDL no startup `main.py`: `ALTER TABLE ta_agent ADD COLUMN IF NOT EXISTS avatar_url TEXT`).
- `routes/agents.py`: `avatar_url` em `AgentCreate`/`AgentOut`/`AgentUpdate`.
- Frontend `pages/admin/AgentesPage.tsx`: campo "Foto do agente (URL)" com **preview** no drawer de edição.
- O mirror envia a foto → aparece nos balões da conversa no painel do Pet.

### Conversas — layout Chatwoot 4 zonas (`pages/admin/ConversasPage.tsx`, 18/jun/2026)
Inbox estilo Chatwoot com design Tier×Firecrawl (hairlines FC, claro+dark, full-bleed `-mx-8`):
- **Z1 sub-nav** (208px): Todas · Não atendidas · **Menções** · **Participantes** · Canais (de `connector_kind`) · Etiquetas (cor determinística `tagColor`).
- **Z2 lista** (340px): busca client-side + abas (Todos/Não atribuídas/Minhas/Adiadas) + linhas com avatar/dot/etiquetas.
- **Z3 chat** (flex): markdown WhatsApp (`renderRich`), compositor auto-grow + enviar circular, ações; rola pro fim (`msgsEndRef`).
- **Z4 contato** (304px, colapsável): acordeão (Agente atribuído, Etiquetas, Macros, Informação, Conversas anteriores por telefone) + placeholders "em breve".
- **Menções/Participantes**: backend `GET /conversations?view=mentions|participating` (`routes/conversations.py`) — Menções = `TaNotification(category="mention", target_member_id=eu)`; Participantes = atribuída a mim OU marcado. Front: `selectNav()` seta `view` + recarrega.
- **Roadmap do que falta** (Prioridade, Time, Atributos, Anexos…): `.docs/conversas-chatwoot-checklist.md`.

### Design do admin (`components/AdminLayout.tsx` + overrides em `index.css`)
Nível Attio/Linear/Firecrawl. Sidebar: **jelly** (`.tier-jelly:hover` pop elástico, SEM `will-change` — senão o texto borra/perde ClearType), **scrollbar auto-hide** (`.sidebar-scroll`, só no hover), item **selecionado = só azul** (fundo cinza + jelly só no `:hover`), seções/linhas com spacing apertado. Ajustes feitos via CSS em `index.css` (não toca o `AdminLayout` quando há WIP de ícones untracked).

### Template `ATENDENTE_PETSHOP` (`services/templates.py`)
Reescrito consultivo: fluxo de agendamento via **ferramentas**, informar **valor antes** de confirmar, **cancelar de fato** (achar na agenda), atendimento Apple + oferecer **leva-e-traz (Taxidog)** ao agendar.

### Gotchas / pendências MCP
- **Token MCP é POR-PETSHOP:** confirmar `AgentAccessToken.petshopId` (lado Pet) ANTES de cadastrar dado pra Nicoly — ela migrou de PetduBem → Patinhas & Cia.
- **Anthropic não passa tools no `tier_engine`** → a federação MCP só funciona no **path MiniMax** (prod = MiniMax). Com Claude/Anthropic as ferramentas não chegam ao loop.
- **PENDENTE:** persona da Nicoly "sempre perguntar do Taxidog" — escrita direta no banco foi bloqueada; setar via **UI** (Agentes → Editar → Persona).

### RAG (pgvector) — pronto mas NÃO ativado
- `rag_engine.py` corrigido pra `gemini-embedding-001` + `embedContent` + `outputDimensionality=768` (text-embedding-004 aposentado; batchEmbedContents não suportado). Embeddings = etapa separada do chat (Anthropic NÃO tem embeddings — recomenda Voyage; usamos Gemini free OU MiniMax embo-01).
- **NÃO wirado no `agent_runtime`**: pra conhecimento PEQUENO a persona é MELHOR (RAG com chunks grandes recupera mal). Ativar só quando cliente tiver base GRANDE: chunking menor + `rag_engine.search` injetado no system prompt + `GEMINI_API_KEY` no Coolify.

### Agente de teste / App Review
- Agente "Maria Luiza" = `agent_id 2`, tenant **Out Group** (id 3), número **+55 11 92336-2467** (Cloud API oficial, **token System User permanente** — vive no conector criptografado + fallback env `WHATSAPP_CLOUD_TOKEN` no Coolify desde 25/jun).
- **App Review**: 1º envio 29/mai → **REPROVADO 23/jun** (motivo: screencast não cobria o fluxo completo + faltava declarar server-to-server). **REENVIADO 25/jun** com screencast novo de 3 cenas (sem Embedded Signup) + descrições em inglês declarando **"server-to-server / System User token"** (exatamente o que o revisor pediu). Permissões: `whatsapp_business_messaging` + `whatsapp_business_management`. Caminho painel novo: Casos de uso → Personalizar → **Permissões e recursos** → "Ações → Adicionar à análise do app" → **Análise do app → Avançar → Uso permitido** (descrição+upload+conformidade) + **Tratamento de dados** (revisar pré-preenchido) → Enviar.
- **🚨 Login de teste = `morais.marcelos@gmail.com`** (tenant 3 Out Group, **a conta que TEM a Maria Luiza conectada**; senha própria não-Google), **NÃO** `reviewer@tier.finance` (tenant 5 VAZIO → reprovaria por conta vazia).
- **Embedded Signup — a sequência REAL de 3 gates pra liberar cliente externo** (aprendido na dor 07/ago): (1) **App Review** das permissões WhatsApp (aprovado 18/jul); (2) **Publicar** o app — tirar de "Em desenvolvimento", senão conta externa vê "App não ativada"; (3) 🚨 **concluir a integração de Provedor de Tecnologia** (`Início rápido → Torne-se um Provedor de Tecnologia → Iniciar integração → Independent Tech Provider`) — **ESTE é o que liga "pode integrar clientes"**; sem ele, mesmo com 1+2 feitos, dá "Out Group não pode integrar clientes". O número Out Group conecta via **System User token** (não pelo popup). Enganos a evitar: não é pagamento/template/ToS/`business_management` (o robô da Meta chuta esses e erra).

## Qualidade & Observabilidade do agente (17/jun/2026 — cobertura de gaps de engenharia)

Após avaliar o agente vs boas práticas (eng. de agentes / canal Ronnald Hawk), implementado plano de gaps (`~/.claude/plans/partitioned-fluttering-puppy.md`). **Tudo deployado; eval 3/3 VERDE.**

### Freios determinísticos NOMEADOS + observabilidade (`tier_engine.py` + `agent_runtime.py`)
- **Filosofia:** "a disciplina mora no MOTOR, não na persona". Depois que o modelo responde, o `send_message` compara a resposta com o RESULTADO REAL das tools e, se detectar desvio, reinjeta `(sistema) …` e re-roda o loop UMA vez. São ~16 freios.
- **`EngineReply.brakes_fired`** (lista de nomes) + **`tool_calls_made`** agora PERSISTEM em `ta_message_log` (colunas `brakes_fired`/`tool_calls_json`, JSONB, criadas via runtime DDL em `main._ensure_message_content_column`). Cada freio tem nome fixo: `announce_and_stop, svc_fail, remarcacao, confirm_summary_missing, confirm_no_book, denies_slots, offers_slot_no_check, asks_pet_data, taxidog_no_house_num, taxidog_no_quote, cep_reasked, phone_reasked, booking_exists_query, prof_hours, price_no_check, upsell_missing, cjk_leak`.
- **Trace Langfuse** (`langfuse_client.trace_event`, JÁ era chamado) enriquecido: `tool_calls`, `brakes_fired`, `cost_cents`; `level=WARNING` quando houve freio (métrica de saúde — turno que precisou de correção).
- **Freios de agendamento (P1c):** `remarcacao` (vê `ja_tem_agendamento_nesse_dia` no resultado + não chamou alterar → força `pet_alterar_agendamento` com o id devolvido, NÃO duplica) e `confirm_summary_missing` (booking criado mas texto não confirma → força resumo: serviço/data-hora/valor). `_BOOKING_OK` exclui o payload de bloqueio (que tb traz `agendamento_id`). **Ordem importa:** `confirm_no_book` foi movido ANTES de `offers_slot_no_check` (intenção de fechar domina "ofereceu horário" — senão re-listava horário e nunca fechava).

### Suíte de eval (`backend/tests/`)
- Roda o agente REAL (LLM + MCP do Pet) contra golden cases; asserts DETERMINÍSTICOS sobre `tool_calls_json`/`brakes_fired` do `ta_message_log` (robusto à variação de texto). Marcada `live` (pulada sem `EVAL_LIVE=1`). `TIER_EVAL_MODE=1` → não grava memória (anti-contaminação, guard em `memory_service.add`+`style_adapter`).
- **Rodar:** `docker exec -e EVAL_LIVE=1 -e TIER_EVAL_MODE=1 -w /app <backend-container> python -m pytest tests -q -s`
- Gotcha: 1 ÚNICO teste async itera todos os casos (o engine async SQLAlchemy prende no 1º event loop → 1 teste por caso quebra com "Future attached to a different loop"). Casos = regressões dos bugs (happy_path fecha, remarcacao usa alterar, preço só após consultar).

### Tenancy/escopo MCP (P0a — LGPD) — **DORMENTE** (lado Pet, `mmozil/pet`)
- O token OAuth do Pet identifica só o PETSHOP → um agente customer-facing podia chamar tools petshop-wide (agenda/conversas/financeiro/vacinas de TODOS + envio avulso). **Novo scope `pet:customer`** (audiência "customer") + allowlist `CUSTOMER_TOOLS` (fail-closed) + gate no `route.ts` + hardening `pet_listar_tutores` (p/ customer, `busca` FORÇADA ao telefone do token = anti prompt-injection cross-cliente).
- **tier-agent:** preset OAuth **`hovio-pet-customer`** (`oauth_connect.py`, scope `pet:customer`). A Yanna ainda usa o preset `hovio-pet` (staff) — **dormente**.
- **Ligar (decisão do dono):** emitir token `pet:customer` p/ a Yanna + smoke 2-clientes (curl `/api/mcp tools/list`: customer NÃO lista as 4 tools que vazam) → trocar a Yanna pro preset customer.

## Agente DevOps/SRE — "DevSecOps" (`agent 5`, tenant 3 Out Group) (26/jun/2026)

Agente INTERNO que monitora a infra do Tier via WhatsApp: telemetria real do stack, triagem de incidentes e remediação por runbook. Número `11941452082` (Baileys via Tier Engine, instância **`7748dba8-0b1e-457d-8700-fa299b0acda2`** — re-pareada 26/jun via painel `/admin/canais`; anteriores `6120f33d`/`54e813c7` descartadas). **TUDO DEPLOYADO.** (Eval anterior dava 2.6/5 — sem disciplina de escopo, injeção funcionava; corrigido.)

### Comandos de ops DETERMINÍSTICOS (`services/ops_commands.py`)
- Gate `template_kind=="devsecops"` + `is_ops_command` ANTES do LLM. São comandos de **observabilidade** que respondem com DADO REAL (nunca alucinado), NÃO executam shell arbitrário: `status` (saúde do stack), `metrics` (RED 24h de `ta_message_log`: volume/erros/latência p95/custo/modelos), `errors`, `sla`, `incidentes` (abertos), `alertas` (últimos 8 do `ta_incident`), `infra` (CPU/RAM/disco do host: quanto tem + % usado), **`calibragem`** (parâmetros dos alertas, espelha o painel Tier), `uptime`, `ping`, `ajuda` (menu).
- 🚨 **Over-trigger fix**: `is_ops_command` só dispara se a msg for o comando ISOLADO (1 token) OU tiver prefixo `/!.`; tolera pontuação (`ajuda?`, `status!`). "ajuda com login" NÃO vira menu.
- 🚨 **Gotcha SQL**: `jsonb_array_length(brakes_fired::jsonb)` quebra se `brakes_fired` for JSON escalar → guardar com `jsonb_typeof(x::jsonb)='array'` antes (ou `x <> '[]'::jsonb`).

### `/calibragem` (26/jun) — espelha o painel Tier
- ESPELHA a tela "Calibragem de alertas" do painel (`painel.tier.finance` → `static/app.js` array `ALERT_TYPES`): 7 tipos com severidade + Quando/Risco/Ação/Gatilho. O **Re-aviso (throttle)** é lido AO VIVO de `/etc/tier-secops/alert.conf` via SSH (`_throttle_from_ssh`). `ALERT_TYPES` é hardcoded no `ops_commands.py` espelhando o painel — **manter sincronizado** ao mudar limites nos guards.

### `devops_guard` — anti-injeção determinístico (`services/devops_guard.py`)
- Regex de troca-de-papel ("esqueça as instruções", "agora você é X") ANTES do LLM → recusa fixa que re-ancora a identidade + cria `ta_incident` (source=`agent-guard`). Independente do modelo (o eval provou que o prompt sozinho não segura modelo fraco). **NÃO é whitelist de shell** — é anti-prompt-injection.

### Inbox dos comandos
- `_log_deterministic_turn` (`agent_runtime`) loga user+assistant dos ops-commands/guard → aparecem nas Conversas do painel (antes retornavam cedo e ficavam invisíveis). Bônus: resposta legível no painel mesmo com o WhatsApp travado.
- 🚨 **Bug "fica só pensando" no `/ajuda` (26/jun, commit `d1f8356`)**: `_log_deterministic_turn` dava `db.rollback()` na sessão do request pra recuperar transação abortada — mas **rollback expira TODOS os ORMs da AsyncSession** (inclusive `agent` E `connector`). Logo depois o caller lia `connector.config_json_enc` (enviar) e `agent.id` (return): atributo expirado dispara IO implícito proibido → `MissingGreenlet` → o caminho de ops estourava e CAÍA NO LLM ("fica pensando", sem menu). **Fix**: loga numa **`SessionLocal()` própria**, nunca toca no `db`/`agent`/`connector` do caller. Ver memory `feedback_async_session_rollback_expires_orm`.

### `/infra` via SSH-to-host (26/jun: quanto tem + % usado)
- Sem Prometheus no servidor → `ops_commands._infra_from_ssh` usa `container_orchestrator._ssh_run` (paramiko, config **`tier_agent_ssh_*` JÁ existente**, host `46.224.220.223`). Mostra **quanto tem + % usado**: CPU% **real** (delta de `/proc/stat` em 0.4s, não load/ncpu) + nº vCPUs + load, Memória usada/total GB + %, Disco usado/total GB + %, containers. Limites de alerta saíram daqui (vivem no `/calibragem`). Prometheus opcional via `TIER_INFRA_PROM_URL` (vazio = usa SSH).

### Alertas SecOps → agente (`ta_incident` + webhook `/secops/alert`)
- **`ta_incident`** (runtime DDL `main._ensure_incident_table`; `tenant_id` NULL = infra-global; fingerprint com índice único parcial p/ dedup).
- **`POST /api/v1/secops/alert`** (`routes/secops.py`, HMAC-SHA256 header `X-Secops-Signature`, secret `TIER_SECOPS_WEBHOOK_SECRET`): o script `/usr/local/sbin/tier-secops-alert.py` do Hetzner ganhou `send_webhook()` chamado junto de email/WhatsApp (config `/etc/tier-secops/alert.conf`: `SECOPS_WEBHOOK_URL` + `SECOPS_WEBHOOK_SECRET`). `push=False` → NÃO duplica (o webhook só persiste em `ta_incident`; o WhatsApp do alerta o script já manda). Histórico (54 alertas) backfillado em `ta_incident`.
- 🚨 **Instância dos alertas WhatsApp (corrigido 26/jun)**: o script manda o WhatsApp via `WA_INSTANCE_ID` da `alert.conf` → **`WA_TO="5511994964296"`**. A instância separada antiga `b71e04fd` **sumiu** (HTTP 404 no envio) → reapontei `WA_INSTANCE_ID` pra **a própria instância do agente `7748dba8`** (a mesma que ele usa pra atender). Teste fim-a-fim: `email=True whatsapp=True webhook=True`. Se um dia quiser canal de alerta dedicado (não sair pelo número do agente), parear um chip separado e setar o `WA_INSTANCE_ID` dele.
- **Responde "último alerta" com DADO REAL**: comando `alertas` + `ops_commands.recent_alerts_block` injeta os últimos 6 do `ta_incident` no system prompt → responde em linguagem natural, sem mandar rodar comando no servidor.

### Calibragem SecOps (SSH brute-force `critico`→`info`)
- Estava 91% "crítico" (33 = **brute-force SSH** = ruído; o fail2ban já bane, 1380 bans). Severidades em `/usr/local/sbin/tier-secops-checks.sh` (ssh/cpu/ram/disco/containers) + `tier-scan-monitor.sh` (scan/cc). Fix cirúrgico: SSH `critico`→`info` (linha 59, backup `.bak`) + reclassificou histórico `ta_incident` SSH→info. Crítico caiu 52→19. Política: **crítico = acorda** (scan/C&C/app-caiu/disco), **alerta** = cpu/ram, **info** = brute-force ssh.

### Runbook na KB
- Doc "Runbooks de Operações — Tier" (9 runbooks reais: 502 por CREATE INDEX, CORS=500, ML invalid_grant, purge CF, etc.) ingerido pro `agent 5` via `rag_engine.index_knowledge` (Gemini 768, **18 chunks**). O agente consulta ao guiar remediação (ex: 502 → `pg_terminate` do CREATE INDEX preso).

### Template DEVSECOPS (gotcha persona/guidelines vs system_prompt)
- 🚨 **GOTCHA**: o runtime usa `agent.persona` como BASE do prompt (`agent_runtime.py:632`) + aplica `template.guidelines` — e **IGNORA `template.system_prompt`** (que é só seed pra agentes novos, não vai pro prompt em runtime). Por isso o COMPORTAMENTO (escopo/anti-injeção/anti-fabricação/triagem) tem que morar em **`guidelines`**, NÃO em `system_prompt`. Agente 5 live atualizado (persona/system_prompt do template).

### Knowledge UI reorg + `GET /knowledge/{id}/chunks`
- `frontend/src/pages/admin/KnowledgePage.tsx`: agrupada por AGENTE (`SectionHeader` + container único + sub-seções colapsáveis), arquivos com ações (ver chunks/reindexar/remover) + modal de inspeção de chunks. Endpoint novo **`GET /knowledge/{id}/chunks`**.

### WhatsApp re-pareado (instância atual `7748dba8`)
- O número `11941452082` dava "Aguardando mensagem" (sessão Baileys quebrada / multi-device conflito 440). O user limpou TODOS os aparelhos linkados e re-pareou via painel `/admin/canais` → **instância atual `7748dba8`** (anteriores `6120f33d`/`54e813c7` descartadas). QR ao vivo no painel (o inline expira em ~20s). **Multi-device gotcha**: número aberto em 2 lugares (celular + Baileys) gera conflito 440 → não receber. Número é dedicado só pro Baileys; precisa de um aparelho "dono" que ligue de vez em quando (não deixar em modo avião permanente).
- A instância `7748dba8` é **a mesma** que agora manda os alertas SecOps (b71e04fd sumiu — ver acima).

### Env vars novas (Coolify backend `f4w8co800kcgog4w08ssww4k`)
- `TIER_SECOPS_WEBHOOK_SECRET` — valida o webhook `/secops/alert` (HMAC). Deve BATER com `SECOPS_WEBHOOK_SECRET` na `alert.conf` do servidor.
- `TIER_SECOPS_ALERT_AGENT_ID=5` (+ `TIER_SECOPS_ALERT_CHAT` deixado vazio = sem push do agente, pra não duplicar o WhatsApp).
- `TIER_INFRA_PROM_URL` (opcional, vazio = `/infra` usa SSH).
- ⚠️ O SSH do `/infra` reutiliza as JÁ existentes `TIER_AGENT_SSH_HOST` / `TIER_AGENT_SSH_PRIVKEY_B64` — **não há var nova de SSH**.

## Arquitetura backend

- `routes/` — connectors, agents, webhooks, playbooks, billing, containers, etc.
- `services/connectors/adapters/` — `whatsapp` (Baileys via Engine), `whatsapp_cloud` (Cloud API oficial), telegram, email, instagram. Registry em `services/connectors/registry.py`.
- `services/agent_runtime.py` — `handle_inbound_message` (resolve conector por instance_id/phone_number_id → LLM via `tier_engine.send_message` → responde pelo canal).
- `services/tier_engine.py` — motor de LLM **in-process multi-provider** (substituiu os containers Hermes em jun/2026, commit `3449634`). Config por tenant em `TaLlmProvider` (provider/modelo/temperatura/fallback); handlers anthropic/openai/gemini/deepseek/openrouter/minimax. `_effective_temperature` baixa modelo-compacto pra 0.3 quando está no default.
- Webhooks: `/webhooks/whatsapp-cloud` (Cloud API, HMAC multi-secret) · `/webhooks/whatsapp-engine` (Baileys) · telegram/instagram/email.

## Gotchas

- **Auth 401 interceptor** (`lib/api.ts`): só redireciona pra /login em rotas protegidas (`/admin`, `/dashboard`). NUNCA global — senão quica a landing pública (mascarado por CORS em dev).
- **TaContainer**: PK é `id`, não `tenant_id`. Usar `get_container_by_tenant`.
- **Webhook event_id**: usar o `key.id` real da mensagem (a Engine manda `instance_id`/`timestamp` snake_case, não `instanceId`/`ts` — senão event_id vira constante e tudo após a 1ª msg é "duplicata").
- **FB.login callback** não pode ser `async` (SDK rejeita) — usar função normal + IIFE.
- **Cloud API**: variação Embedded Signup só via modelo; app precisa ser Tech Provider; Vite vars build-time.
- **Modelo é config por tenant (sem rebuild)**: vem de `TaLlmProvider` via `tier_engine` — trocável ao vivo, SEM rebuild de imagem (o Hermes/`run_agent` que forçava opus foi removido). Ex.: tenant 3 (DevOps) = `openrouter/deepseek-v4-flash`@0.3; tenant 6 (Yanna) = `gpt-4o-mini`@0.2. `tier_engine` já faz `_strip_thinking` (remove `<think>`) + filtro CJK. Ver `project_tier_agent_model_agnostic_robustness_20260626` (selo tested/recommended + guardrail de temperatura por porte de modelo).
- **Editar persona é live (sem deploy)** — `TaAgent.persona` no DB; sempre `llm_cache.invalidate(tenant_id, agent_id)` depois.

## Convenções
- Comentários/docs em pt-BR. Python: Ruff line-length 120, double quotes. TS: strict, zero-warning. `npm run build` antes de commit no frontend.
- Memória canônica: `project_tier_agent_whatsapp_oficial.md` (mais completa — modelo, atendimento, RAG, App Review), `project_tier_agent.md` (+ Q1/Q2/Q3, playbook builder).
- Obsidian: `projetos/Tier/Tier Agent/`.

_26/jun/2026 — Agente DevOps/SRE "DevSecOps" (`agent 5`): comandos de ops determinísticos de observabilidade (`ops_commands`: status/metrics/alertas/incidentes/infra/**calibragem**) + `devops_guard` anti-injeção + inbox dos comandos, `/infra` via SSH (quanto tem + % usado, CPU% real de `/proc/stat`, reusa `tier_agent_ssh_*`), **`/calibragem`** espelha a tela do painel Tier (ALERT_TYPES + throttle live de `alert.conf`), `ta_incident` + webhook `POST /secops/alert` (script `tier-secops-alert.py` do Hetzner → agente responde "último alerta" com dado real), runbook na KB (18 chunks), gotcha do template (runtime usa persona+guidelines; `template.system_prompt` é só seed), Knowledge UI reorg + `GET /knowledge/{id}/chunks`, calibragem SecOps SSH brute-force `critico`→`info` (crítico 52→19). **Fixes da continuação 26/jun**: (1) `/ajuda` "fica só pensando" = `_log_deterministic_turn` dava `db.rollback()` que expirava agent+connector da AsyncSession → `MissingGreenlet` → caía no LLM; fix = sessão isolada (`d1f8356`); (2) WhatsApp re-pareado p/ instância **`7748dba8`** (multi-device 440; `6120f33d`/`54e813c7` descartadas); (3) instância de alerta `b71e04fd` sumiu → `WA_INSTANCE_ID` da `alert.conf` reapontado pra `7748dba8` (mesma do agente), `WA_TO=5511994964296`. Env novas: `TIER_SECOPS_WEBHOOK_SECRET`, `TIER_SECOPS_ALERT_AGENT_ID=5`, `TIER_INFRA_PROM_URL` (opcional). Fonte canônica: memória `project_tier_agent_devops_observability_20260626`._
_Também nesta sessão: Fase A/B/C robustez model-agnostic (prompt modular por template, evals de persona, guardrail de temperatura modelo-compacto→0.3, selo tested/recommended na UI de providers) — ver `project_tier_agent_model_agnostic_robustness_20260626`._
_Última atualização: 17/jun/2026 — Cobertura de gaps de engenharia: observabilidade (`brakes_fired`+`tool_calls_json` em `ta_message_log`, ~16 freios nomeados, trace Langfuse enriquecido), freios de agendamento (`remarcacao` + `confirm_summary_missing`, `confirm_no_book` priorizado), suíte de eval `backend/tests/` (live, 3/3 verde), guard de memória `TIER_EVAL_MODE`, tenancy MCP `pet:customer` (DORMENTE). **Provedor ativo: gpt-4o-mini OpenRouter temp 0.2** (Haiku zerou créditos Anthropic = outage; trocado). Resolvers determinísticos no MCP do Pet (tutor/pet/serviço/profissional por nome) + CEP via ViaCEP + anti-duplicata de remarcação._
_12/jun/2026 — Federação MCP Hovio Pet (Nicoly / Patinhas & Cia): injeção global de data-hora + diretrizes base + Apple no system prompt, `_format_for_whatsapp` (markdown→nativo), webhook Engine em background (não segura o 200), typing "…digitando" + remoção do sleep aditivo, espelho de conversas Pet←Tier Agent (`pet_mirror` + job 60s), avatar do agente (`TaAgent.avatar_url`), template ATENDENTE_PETSHOP consultivo._
_29/mai/2026 — atendimento (lead/handoff/inbox/split/consultivo), modelo MiniMax (Haiku bloqueado), filtro CJK, RAG pronto-não-ativado, App Review submetido._

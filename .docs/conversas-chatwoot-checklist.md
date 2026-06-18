# Conversas (Chatwoot-style) — Checklist de Desenvolvimento

Roadmap das features da página de Conversas (`frontend/src/pages/admin/ConversasPage.tsx`),
modelada no layout do Chatwoot com design Tier × Firecrawl. Vamos acompanhando aqui.

> Layout entregue (4 zonas): sub-nav · lista · chat · painel de contato. Commit `8d9a5ea`.

---

## ✅ Pronto (já funcionando em prod)

- [x] **Layout 4 zonas** (sub-nav 208 · lista 340 · chat flex · contato 304, colapsável)
- [x] **Todas as conversas** (sub-nav) — filtro principal
- [x] **Não atendidas** (sub-nav) — abertas + sem atendente (contador)
- [x] **Canais** (sub-nav) — derivado de `connector_kind`, com contagem
- [x] **Etiquetas** (sub-nav) — cor determinística por nome, com contagem
- [x] **Busca** na lista (client-side: nome + prévia)
- [x] **Abas de fila** (Todos / Não atribuídas / Minhas / Adiadas)
- [x] **Agente atribuído** (painel) — `saveAssign`
- [x] **Etiquetas da conversa** (painel) — `saveTags`, com cores
- [x] **Macros** (painel) — `applyMacro`
- [x] **Informação da conversa** (painel) — status, contagem, canal, CSAT
- [x] **Conversas anteriores** (painel) — derivado por telefone (`external_id`)
- [x] **Chat** — markdown WhatsApp, compositor auto-grow, ações (assumir/resolver/adiar)

---

## ⬜ A construir (em ordem sugerida)

### 1. Menções 🔸 (P1 — pequeno)
Conversas onde o atendente atual foi **marcado numa nota interna** (`@nome`).
- **Backend** (`backend/routes/conversations.py`): aceitar `?view=mentions` no `GET /conversations`
  → filtrar conversas que têm nota com `mentions` contendo o `member_id` do usuário logado.
- **Frontend**: o item "Menções" já existe (hoje placeholder) — trocar pra `setNavFilter({type:'mentions'})`
  que dispara `load` com `view=mentions` (ou filtro client se a contagem for pequena).
- **Esforço**: ~pequeno (já temos `mentions` nas notas).

### 2. Participantes 🔸 (P1 — pequeno/médio)
Conversas em que o user **participou** (atribuído OU comentou OU foi mencionado).
- **Backend**: `?view=participating` → união (assigned_member_id = me) ∪ (tem nota minha) ∪ (mencionado).
- **Frontend**: item "Participantes" → `view=participating`.
- **Esforço**: ~pequeno/médio (query de união).

### 3. Prioridade 🔸 (P1 — pequeno)
Prioridade da conversa: nenhuma / baixa / média / alta / urgente.
- **Backend**: coluna `priority` em `conversations` + `PATCH /conversations/{id}/priority`.
- **Frontend**: select no painel "Ações da conversa" (hoje placeholder "em breve").
- **Bônus**: ordenar/filtrar a lista por prioridade; badge na linha.
- **Esforço**: ~pequeno.

### 4. Notas do contato 🔹 (P2 — médio)
Notas a **nível de contato** (persistem entre conversas do mesmo telefone).
- **Backend**: tabela `contact_notes` (external_id, agent_id, texto, autor, created_at) + CRUD.
- **Frontend**: lista + adicionar no painel.
- **Esforço**: ~médio.

### 5. Atributos do contato 🔹 (P2 — médio)
Campos customizados chave/valor por contato (ex: empresa, cargo, plano).
- **Backend**: `contact_attributes` (JSON no contato OU tabela) + endpoints.
- **Frontend**: lista editável no painel.
- **Esforço**: ~médio.

### 6. Anexos 🔹 (P2 — depende de mídia)
Arquivos trocados na conversa (imagens, docs, áudios).
- **Backend**: já recebemos/armazenamos mídia das mensagens? Se sim, listar por conversa.
- **Frontend**: grid de anexos no painel + preview.
- **Esforço**: ~médio (depende de mídia já estar persistida).

### 7. Participantes da conversa 🔹 (P2 — pequeno)
Avatares dos atendentes envolvidos na conversa específica.
- **Backend**: derivar de quem foi atribuído + quem comentou.
- **Frontend**: pilha de avatares no painel.
- **Esforço**: ~pequeno.

### 8. Time atribuído 🔻 (P3 — grande)
Equipes (grupos de atendentes) atribuíveis à conversa.
- **Backend**: tabelas `teams` + `team_members` + coluna `team_id` em conversations + CRUD de times.
- **Frontend**: CRUD de times (config) + select no painel.
- **Esforço**: ~grande (feature nova de gestão de equipe).

### 9. ~~Problemas do Linear vinculados~~ ❌ (descartar)
Chatwoot integra com Linear; **não usamos Linear no Tier Agent** → não portar.

---

## Notas técnicas

- **Sub-nav reflete o escopo carregado**: Canais/Etiquetas derivam dos `convs` já carregados
  (escopo da aba). Em "Todos" mostram tudo. Se quiser global independente do escopo, precisa
  de um endpoint de agregados (`GET /conversations/facets`) — backlog.
- **Cores de etiqueta**: determinísticas por hash do nome (`tagColor`). Quando houver backend
  de cor por etiqueta, trocar pra cor real.
- **Placeholders "em breve"**: os itens não construídos mostram estado honesto (dashed / "em breve"),
  decisão de produto (não fingir funcionalidade).

_Atualizado: 18/jun/2026._

# Roadmap — Paridade Chatwoot + Conhecimento completo da Maria Luiza

> Levantado em 05/jun/2026 a partir de um Chatwoot real (conta CCDA/Esneper).
> Objetivo: (1) listar as features do Chatwoot que o Tier Agent ainda não tem;
> (2) listar o conhecimento completo que a Maria Luiza (atendimento Tier Empresas)
> precisa saber. Status: ✅ temos · ⚠️ parcial · ❌ falta.

---

## PARTE 1 — Paridade de features com o Chatwoot

### 1.1 Navegação principal

| Feature Chatwoot | Tier Agent | Obs |
|---|---|---|
| **Caixa de Entrada** (visão unificada: minhas + não lidas) | ⚠️ | Temos `/admin/conversas` com abas, mas não uma "Caixa de Entrada" focada no atendente (só o que é dele + não lido) |
| **Conversas** (Todas / Menções / Participantes / Não atendidas) | ⚠️ | Temos Conversas + abas Minhas/Não-atribuídas/Todos. **Faltam views: Menções, Participantes, Não atendidas** |
| Filtro por **canal** e por **etiqueta** na sidebar | ❌ | Chatwoot lista canais + tags clicáveis na navegação |
| **Capitão** (Captain AI — copilot do atendente) | ⚠️ | Temos copilot (AgentOptimus). Confirmar paridade (sugestão de resposta, resumo) |
| **Contatos** (CRM de contatos) | ❌ | Temos Leads, mas **falta uma página de Contatos** (lista de pessoas, histórico, atributos) |
| **Campanhas** (disparos outbound) | ❌ | Confirmar — no tier-finance há Disparos; no Tier Agent **falta página de Campanhas** |
| **Central de Ajuda** (Help Center público / base de artigos) | ❌ | **Falta** — portal de ajuda público com artigos |
| Configurações | ✅ | `/admin/configuracoes` |

### 1.2 Relatórios (Chatwoot tem 9 sub-relatórios)

| Relatório Chatwoot | Tier Agent | Obs |
|---|---|---|
| **Visão geral** (tempo real: Abertas, Não atendidas, Não atribuídas, **Pendentes**; **Status do agente** Disponível/Ocupado/Desconectado; **heatmap de tráfego**; **heatmap de resoluções**; Conversas por agentes; Conversas por times) | ⚠️ | Temos Visão Geral + Métricas. **Faltam: Pendentes, status Ocupado, heatmap de resoluções, "por time"** |
| **Conversas** (volume, por período) | ⚠️ | Confirmar granularidade |
| **Agentes** (desempenho por atendente) | ⚠️ | Parcial em relatorios-atendimento |
| **Etiquetas** (volume por tag) | ❌ | **Falta** relatório por etiqueta |
| **Caixa de Entrada** (por canal) | ❌ | **Falta** relatório por canal |
| **Time** (por equipe) | ❌ | **Falta** relatório por time |
| **CSAT** (satisfação) | ⚠️ | Temos CSAT; confirmar relatório dedicado |
| **SLA** (cumprimento) | ⚠️ | Temos SLA; confirmar relatório dedicado |
| **Robôs** (desempenho do bot: resolvidas pela IA, deflection) | ❌ | **Falta** relatório de bot (taxa de resolução pela IA) |

### 1.3 Configurações (Chatwoot tem ~17 seções)

| Seção Chatwoot | Tier Agent | Obs |
|---|---|---|
| Conta | ✅ | |
| Agentes | ✅ | `/admin/agentes` |
| Times | ✅ | `/admin/equipe` |
| Caixas de Entrada (canais) | ✅ | `/admin/canais` |
| Etiquetas (gestão de tags) | ⚠️ | Usamos tags; confirmar tela de gestão (criar/editar/cor) |
| **Atributos Personalizados** (custom fields no contato/conversa) | ❌ | **Falta** |
| **Automação** (regras: se X então Y — auto-tag, auto-atribuir, auto-resposta) | ⚠️ | Temos Playbooks (parecido mas diferente). **Falta** automação estilo "regra simples" |
| Robôs (bots) | ✅ | Agentes IA |
| **Macros** (sequência de ações pré-definida pra o atendente) | ❌ | **Falta** |
| Respostas Prontas (canned) | ✅ | |
| Integrações | ⚠️ | Temos MCP/marketplace; confirmar catálogo de integrações |
| **Auditoria** (audit log de ações) | ❌ | **Falta** log de auditoria por usuário |
| **Funções Personalizadas** (dashboard apps / custom functions) | ❌ | **Falta** |
| SLA | ✅ | |
| Fluxo de Conversa | ✅ | Playbooks |
| Segurança | ⚠️ | Confirmar (2FA, sessões) |
| Cobrança | ✅ | `/admin/cobranca` |

### 1.4 Inbox / Conversa — recursos do atendente

| Recurso Chatwoot | Tier Agent | Obs |
|---|---|---|
| Atribuir a agente/time | ✅ | |
| Status: Aberta / Pendente / Resolvida / Adiada (snooze) | ⚠️ | Temos active/handed_off/closed/snooze. **Falta "Pendente"** explícito |
| Notas internas + @menção | ✅ | |
| Etiquetas na conversa | ✅ | |
| Status do atendente: Disponível / **Ocupado** / Ausente | ⚠️ | Temos online/offline. **Falta "Ocupado"** |
| Participantes (vários atendentes na conversa) | ❌ | **Falta** |
| Atributos da conversa/contato | ❌ | **Falta** (ligado a Atributos Personalizados) |

### 1.5 Prioridade sugerida (gap → valor)

1. **Fila de atenção clara** ("Precisa de você": handoff + leads + não atendidas num lugar) — operacional crítico.
2. **Relatórios faltantes** (bot/deflection, por etiqueta, por canal, por time, heatmap resoluções).
3. **Automação simples** (regra se→então) + **Macros**.
4. **Contatos** (CRM) + **Atributos personalizados**.
5. **Auditoria**, **Funções personalizadas**, **Central de Ajuda**, **Campanhas**.

---

## PARTE 2 — Conhecimento completo da Maria Luiza (carregar na Base `/admin/knowledge`)

> A persona fica enxuta (quem + como). TODO o detalhe de features vai para a
> **Base de Conhecimento (RAG)** — ela busca o que precisa por pergunta. Isso
> elimina os "vou confirmar com a equipe" para coisas que a Tier faz.

### Fiscal
- NF-e, NFC-e, NFS-e; cancelamento, carta de correção (CC-e), inutilização, manifestação/distribuição
- Regimes: MEI, Simples Nacional, Lucro Presumido, Lucro Real
- SPED; preparação Reforma Tributária 2026 (IBS/CBS)
- NF-e automática nos pedidos de marketplace; Mercado Livre Full (3 NF-e automáticas)

### Marketplaces (pedidos, estoque e preços sincronizados)
- Mercado Livre, Shopee, Magazine Luiza, TikTok Shop, Loja Integrada, Yampi
- Sincronização de estoque, preço e pedidos; emissão de NF-e por pedido

### Produtos e estoque
- Tipos: Simples, Variável (tamanho/cor), Kit (composição/BOM), Serviço
- Múltiplos depósitos, alerta de estoque mínimo, GTIN/EAN, SEO do anúncio

### Tier Pay (recebimento)
- Pix, cartão e boleto; **link de pagamento** para enviar no WhatsApp
- Assinaturas/recorrência; payment links; carteira de cartões (PCI-friendly)

### CRM e atendimento
- Atendimento WhatsApp, funil de vendas, disparos, bot SDR

### Financeiro
- Contas a pagar e a receber, conciliação, fluxo de caixa, relatórios

### Frete
- Melhor Envio: cotação, etiquetas, sugestão de embalagem

### Catálogo / Loja online
- Catálogo próprio; **domínio próprio** (aponta o domínio da loja); publicação automática de produtos com estoque; fotos; checkout Pix/cartão

### Plataforma
- Acesso 100% web (navegador), inclusive celular (não é app dedicado)
- Migração de Bling/Olist sem custo no onboarding
- Segurança/LGPD; mensal sem fidelidade

### Ecossistema Tier (direcionar, não detalhar)
- Tier Investimentos (carteira RV + IR), Tier Pay, Tier Personal, Tier Emissor (NFe-only)

### Planos (já na persona, manter)
- Lite R$199 · Pro R$399 · Business R$899

---

## Como executar a Parte 2 (conhecimento)
1. Quebrar cada bloco acima em artigos curtos na Base (`/admin/knowledge`) → indexação pgvector.
2. Manter a persona enxuta; ela cita a Base via RAG.
3. Cada novo "vou confirmar com a equipe" que aparecer no atendimento real → vira um artigo novo na Base.

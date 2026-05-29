# WhatsApp Cloud API — Setup (Tier Agent)

> Guia operacional pra plugar o **canal oficial** (Meta Cloud API) no Tier Agent.
> Sem Baileys, sem QR, sem sessão caindo, sem ban por automação. Só REST + webhook.
> Atualizado: 2026-05-29.

---

## Visão geral (2 fases)

| Fase | Objetivo | Quem |
|---|---|---|
| **A — Teste** | registrar 1 número da Tier e validar fluxo ponta a ponta | Marcelo (setup Meta) + Claude (conector) |
| **B — Produto** | cada cliente conecta o próprio número sozinho via Embedded Signup | Claude (build) |

**Regra de ouro:** número de CLIENTE vai no **CNPJ/marca do cliente** (Tier é o "Tech Provider" por cima). Número de teste/interno vai no CNPJ da Tier.

---

## FASE A — Setup de teste (número da Tier)

### Pré-requisitos (juntar ANTES de começar)
- [ ] **CNPJ da Tier** + comprovante de endereço (pra verificação de negócio).
- [ ] **Chip NOVO e dedicado** — número que **nunca** foi/não está em WhatsApp comum ou Business app. Capaz de receber **OTP** (SMS ou ligação). ⚠️ **NÃO usar o 11 92336-2467** (foi usado no Baileys e restringido — número "queimado").
- [ ] Cartão/forma de pagamento (a fatura pode vir R$0 num mês só de atendimento, mas a Meta exige cadastro).

### Passo a passo (cliques na Meta)

**1. Meta Business Manager**
- Acessar https://business.facebook.com
- Criar/usar o Business da Tier → preencher razão social, CNPJ, endereço.

**2. Verificação de Negócio** ← *o gargalo (2–10 dias)*
- Em **Configurações do Negócio → Central de Segurança → Iniciar verificação**.
- Subir CNPJ + comprovante de endereço da empresa.
- Aguardar aprovação da Meta (sem isso: limite de 250 conversas/dia).

**3. App no Meta for Developers**
- Acessar https://developers.facebook.com → **Meus Apps → Criar App**.
- Tipo: **Negócios** (Business).
- Adicionar o produto **WhatsApp** → isso cria a **WABA** (WhatsApp Business Account).

**4. Adicionar o número**
- Em **WhatsApp → Configuração da API** → **Adicionar número de telefone**.
- Informar o chip dedicado → verificar por **OTP** (SMS/ligação).
- ⚠️ Depois disso o número **sai do app do celular** (vive só na API).

**5. Display name (nome de exibição)**
- Definir o nome que o cliente final vê (ex: "Tier"). Passa por aprovação da Meta (~1 dia).

**6. Token permanente (System User)**
- **Configurações do Negócio → Usuários → Usuários do sistema → Criar** (papel admin).
- Gerar token com permissões `whatsapp_business_messaging` + `whatsapp_business_management`.
- Guardar o token (vai nas env vars do Engine — criptografado).

**7. Webhook**
- Em **WhatsApp → Configuração → Webhook**:
  - Callback URL: `https://api-agent.tier.finance/api/v1/webhooks/whatsapp-cloud` (Claude cria essa rota)
  - Verify token: string secreta (env var)
  - Assinar campo `messages`.

**8. Forma de pagamento**
- **WhatsApp → Configuração → Faturamento** → adicionar cartão.

### Variáveis de ambiente (Engine) — Claude configura
```
WHATSAPP_CLOUD_TOKEN=<system user token>
WHATSAPP_CLOUD_PHONE_NUMBER_ID=<id do número na WABA>
WHATSAPP_CLOUD_WABA_ID=<id da WABA>
WHATSAPP_CLOUD_VERIFY_TOKEN=<string do passo 7>
WHATSAPP_CLOUD_APP_SECRET=<app secret, pra validar webhook HMAC>
```

---

## FASE B — Produto (Embedded Signup, multi-cliente)

Construído **uma vez**, reusado por todos os clientes (igual Tier Pay com recebedores Pagar.me).

1. Tier entra no **Tech Provider Program** da Meta.
2. Implementar **Embedded Signup**: botão "Conectar WhatsApp Oficial" em `/admin/canais`.
3. Cliente clica → loga na conta Meta dele → escolhe/cria número → autoriza → conecta sozinho (~3 min).
4. Cada cliente: **próprio CNPJ, próprio número, própria marca**. Tier orquestra via API.

---

## Custo (modelo por mensagem, desde jul/2025)

| Tipo | Quando | Custo Brasil |
|---|---|---|
| **Service** (resposta na janela 24h) | cliente chamou primeiro | **GRÁTIS** ilimitado |
| **Utility** na janela 24h | lembrete/status | GRÁTIS |
| **Marketing** (disparo ativo) | template aprovado + opt-in | ~$0,0625/msg |
| **Authentication** (OTP) | template | baixo |

**Agente de atendimento reativo = praticamente R$0.** Só paga disparo ativo de marketing.

---

## Arquitetura (como pluga no Tier)

```
Tier Agent ──▶ Tier Engine ──┬─▶ whatsapp        (Baileys — entrada/PME, risco ban)
 (persona/LLM)                └─▶ whatsapp_cloud  (Cloud API — produção, zero ban) ◀── NOVO
```

- Novo conector `whatsapp_cloud` no Engine (`src/engine/` ou service dedicado).
- Send: `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages`.
- Receive: webhook Meta → `/webhooks/whatsapp-cloud` → mesmo `agent_runtime` do Baileys.
- Tier Agent: seletor de canal por instância (Baileys ou Oficial). Persona/playbooks idênticos.

---

## Gotchas
- Número na API **não funciona no app** do celular simultaneamente.
- **Janela 24h**: fora dela, só dá pra mandar **template aprovado** (não texto livre).
- Disparo de marketing exige **opt-in** — lista fria viola política e pode restringir até a conta oficial.
- Webhook valida **HMAC SHA-256** com `app_secret` (X-Hub-Signature-256).
- Verificação de negócio é **pré-requisito** pra sair do limite de 250 conversas/dia.

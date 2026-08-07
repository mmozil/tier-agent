# WhatsApp Oficial (Cloud API) + Embedded Signup — Tier Agent

> Estado canônico da integração WhatsApp oficial do Tier Agent.
> Atualizado: 2026-08-07 (**onboarding de cliente LIBERADO** — destravou ao **concluir a integração de Provedor de Tecnologia**, NÃO pelo App Review; ver "🚨 Por que dava 'não pode integrar clientes'" abaixo).

---

## Visão geral

O Tier Agent atende clientes via **WhatsApp Cloud API oficial da Meta** (sem Baileys/QR/sessão, zero ban). Dois modos:
1. **White-glove** (hoje) — Tier configura o número do cliente manualmente.
2. **Self-service (Embedded Signup)** — cliente clica "Conectar WhatsApp Oficial", loga no Facebook e conecta o próprio número sozinho. **LIVE desde 07/ago/2026** (destravou ao concluir a integração de Provedor de Tecnologia — ver seção do bloqueio abaixo).

---

## Apps na Meta (developers.facebook.com)

| App | App ID | App Secret | Uso |
|---|---|---|---|
| **Tier Agent API Oficial** | `1644748586815003` | `7a4144ef8217be00eb1bea85ddeae313` | **Produção / Embedded Signup** (Tech Provider). Empresa: Out Group (verificada) |
| APP-API-TIER (legado/teste) | `1042084538480511` | `c9c1c8315284bb73f836003d090c62ea` | Teste: número Tier 92336 (Maria Luiza respondendo). Empresa: Out Group |

- Ambos sob a empresa **Out Group** (`business_id=173693864655266`), que está **verificada** (verificação vale pra os dois apps).
- O app de produção foi criado limpo (só caso de uso "Conectar-se com clientes pelo WhatsApp") e inscrito como **Provedor de Tecnologia (Tech Provider)** — pré-requisito do Embedded Signup.

## Embedded Signup Configuration

- **Config ID:** `876861955432555`
- Criada via **modelo** "Configuração do cadastro incorporado do WhatsApp com token de expiração em 60 dias" (Login do Facebook para Empresas → Configurações → Modelos).
  - Variação: **Cadastro incorporado do WhatsApp** (não aparece na criação manual — só via modelo OU Tech Provider).
  - Token: usuário do sistema, 60 dias.
  - Ativo: **Contas do WhatsApp**.
  - Asset Task Permissions: MANAGE, DEVELOP, MANAGE_TEMPLATES, VIEW/MANAGE_PHONE_ASSETS, VIEW_TEMPLATES, **MESSAGING**.
- Products no config: **WhatsApp Cloud API** (só esse).
- **Domínios SDK JavaScript** (Login do Facebook → Configurações de OAuth): `agent.tier.finance` + "Entrar com SDK JavaScript" ativo + "Forçar HTTPS".

## Número de teste (legado, funcionando)

- Número: **+55 11 92336-2467** (verified_name "Tier"), **CONNECTED**.
- Phone Number ID: `1105955629273371` · WABA ID: `1306815574284515` (sob o app legado 1042084538480511).
- PIN de registro: `180585`.
- Webhook do app legado → `https://api-agent.tier.finance/api/v1/webhooks/whatsapp-cloud`, assinado com o secret legado.

## Implementação (backend tier-agent)

- **Conector** `whatsapp_cloud` (`services/connectors/adapters/whatsapp_cloud.py`): send (texto/imagem/doc/áudio/template) + `mark_read_and_typing` (tique azul + "digitando…") + `resolve_media_url` + validate.
- **Webhook** `routes/webhooks.py::whatsapp_cloud_webhook` (GET verify + POST receive). HMAC valida **múltiplos secrets** (`WHATSAPP_CLOUD_APP_SECRET` novo + `WHATSAPP_CLOUD_APP_SECRET_LEGACY` antigo).
- **Onboard (Embedded Signup)** `routes/connectors.py::onboard_whatsapp_cloud` → `POST /connectors/whatsapp-cloud/onboard`: troca o `code` por token permanente (System User) + assina app na WABA + cria conector.
- **Botão frontend** `components/ConnectWhatsAppCloud.tsx`: FB SDK + `FB.login(config_id)` → captura code + waba_id/phone_number_id (postMessage) → chama onboard. ⚠️ Callback do FB.login **NÃO pode ser async** (SDK rejeita) — usa função normal + IIFE.
- Resolução de conector por `phone_number_id` em `agent_runtime.resolve_connector_by_instance`.

## Env vars (Coolify)

**Backend** (`f4w8co800kcgog4w08ssww4k`):
```
WHATSAPP_CLOUD_APP_ID=1644748586815003
WHATSAPP_CLOUD_APP_SECRET=7a4144ef8217be00eb1bea85ddeae313
WHATSAPP_CLOUD_APP_SECRET_LEGACY=c9c1c8315284bb73f836003d090c62ea
WHATSAPP_CLOUD_VERIFY_TOKEN=tier-wpp-2026
```
**Frontend** (`p88cwcwgs4kg84goow4s0w8w`, build-time p/ Vite):
```
VITE_WHATSAPP_CONFIG_ID=876861955432555
VITE_FB_APP_ID=1644748586815003
```

## Assets do App Review (já preenchidos)

- Política de Privacidade: `https://agent.tier.finance/privacy`
- Exclusão de dados: `https://agent.tier.finance/data-deletion`
- Ícone 1024×1024 transparente (`tier-icon-meta-1024-transparente.png`)
- Categoria: "Bots do Messenger para empresas"
- Email contato/DPO: `privacidade@tier.finance` (alias → hello@tier.finance)

## Status

| Item | Status |
|---|---|
| Agente no WhatsApp oficial (Maria Luiza respondendo) | ✅ |
| App produção + Tech Provider + Config ID | ✅ |
| Domínios SDK + botão + backend + envs | ✅ |
| Embedded Signup popup (abre, fluxo roda) | ✅ provado |
| App Review (Advanced Access) | ✅ **APROVADO** 18/jul/2026 — Advanced access a `whatsapp_business_messaging` + `whatsapp_business_management` + `public_profile` renovada |
| App publicado (sair de "Em desenvolvimento") | ✅ **07/ago/2026** — corrigiu o erro "App não ativada" que contas externas viam |
| **Integração de Provedor de Tecnologia concluída** | ✅ **07/ago/2026** — "Torne-se um Provedor de Tecnologia → Iniciar integração → **Independent Tech Provider**". **ESTE foi o passo que liberou o onboarding** |
| Onboard de cliente externo | ✅ **LIBERADO 07/ago/2026** — antes dava "Out Group não pode integrar clientes"; NÃO era o App Review nem permissão, era a integração de Tech Provider inacabada |
| Migrar Yanna (agent 6) Baileys → Cloud | 🔲 **a fazer** — ver [`migracao-yanna-baileys-para-cloud-20260720.md`](migracao-yanna-baileys-para-cloud-20260720.md) |

## Custo (modelo por mensagem, jul/2025+)
- Atendimento reativo (resposta na janela 24h) = **grátis**.
- Marketing/disparo ativo = pago (~$0,0625/msg BR), exige opt-in.
- **Cada cliente paga as próprias mensagens** (WABA dele) → Tier sem responsabilidade financeira. Limite nativo Meta: 250 conversas/dia (conta nova), escala por qualidade.

## 🚨 Por que dava "Out Group não pode integrar clientes" (RESOLVIDO 07/ago/2026)

Eram **DUAS travas empilhadas**, e a segunda tinha mensagem **enganosa** (parece problema de permissão/aprovação, mas não é):

1. **App em "Em desenvolvimento"** → conta externa via *"App não ativada. O programador da app está consciente do problema."* → **Fix: Publicar** o app (Publicar → botão azul; exige Política de Privacidade, que já temos).
2. **Integração de Provedor de Tecnologia NÃO concluída** → *"[Parceiro] não pode integrar clientes neste momento"* (oferece só "partilhar contato"). → **Fix: `Casos de uso → Conectar-se com clientes pelo WhatsApp → Início rápido → "Torne-se um Provedor de Tecnologia" → Continuar/Iniciar integração → escolher "Independent Tech Provider" → aceitar os Termos de Provedor de Tecnologia`.**

**O que enganou (não perder tempo com isso de novo):**
- **Verificação da empresa** + **Análise do app** apareciam **verdes** → parecia completo. Mas o botão dizia "Continuar a integração" = a integração em si nunca foi finalizada.
- A mensagem "não pode integrar clientes" **NÃO era** falta de permissão. Descartados por eliminação: `whatsapp_business_messaging`/`_management` **aprovadas** (18/jul); forma de pagamento **presente** (MasterCard na WABA Tier); template `hello_world` **Ativo**; Termos **aceitos**; `business_management` **não era necessária**. O robô "Assistente do Desenvolvedor" da Meta deu resposta genérica (ToS/pagamento/template) que **não** era o caso.
- **Regra de ouro:** *App Review aprovado + app publicado **NÃO basta** pra onboardar clientes.* Tem que **concluir a integração de Provedor de Tecnologia** — é o interruptor que liga "pode integrar clientes".

## Como onboardar um cliente (2 formas, ambas liberadas após Tech Provider)

Painel: `Casos de uso → Conectar-se com clientes pelo WhatsApp → Integração de Provedor de Tecnologia`.
1. **"Sem necessidade de integração" (zero-código):** copia a URL pronta `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=1644748586815003&...` e manda pro cliente. Ele configura e a WABA é **compartilhada direto com a Tier**. Bom pra colocar 1 cliente rápido.
2. **Embedded Signup no nosso site (white-label):** botão "Conectar WhatsApp Oficial" em `agent.tier.finance/admin/canais` (config `876861955432555`). Mantém o cliente dentro do produto. É o caminho de produção.
- Também aparece: **"Migrar clientes"** (migrar WABAs existentes) e **"Reivindicar conta de sandbox"** (testar sem número real).

## Gotchas
- Variação "Cadastro incorporado do WhatsApp" só aparece via **modelo** ou Tech Provider — na criação manual da config só tem General (e General não lista o ativo WhatsApp).
- FB.login callback não pode ser async.
- Vite env vars precisam `is_buildtime=true` no Coolify pra entrar no bundle.
- App em "Em desenvolvimento" + sem App Review = não onboarda cliente externo (mostra "não pode integrar clientes no momento"). **MAS** publicar + App Review ainda NÃO basta — falta concluir a **integração de Tech Provider** (ver seção acima).

# WhatsApp Oficial (Cloud API) + Embedded Signup — Tier Agent

> Estado canônico da integração WhatsApp oficial do Tier Agent.
> Atualizado: 2026-05-29.

---

## Visão geral

O Tier Agent atende clientes via **WhatsApp Cloud API oficial da Meta** (sem Baileys/QR/sessão, zero ban). Dois modos:
1. **White-glove** (hoje) — Tier configura o número do cliente manualmente.
2. **Self-service (Embedded Signup)** — cliente clica "Conectar WhatsApp Oficial", loga no Facebook e conecta o próprio número sozinho. **Funciona tecnicamente; aguarda App Review pra liberar clientes externos.**

---

## Apps na Meta (developers.facebook.com)

| App | App ID | App Secret | Uso |
|---|---|---|---|
| **Tier Agent API Oficial** | `1644748586815003` | `7a4144ef8217be00eb1bea85ddeae313` | **Produção / Embedded Signup** (Tech Provider). Empresa: Out Group (verificada) |
| APP-API-TIER (legado/teste) | `1042084538480511` | `c9c1c8315284bb73f836003d090c62ea` | Teste: número Tier 92336 (Sofia respondendo). Empresa: Out Group |

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
| Agente no WhatsApp oficial (Sofia respondendo) | ✅ |
| App produção + Tech Provider + Config ID | ✅ |
| Domínios SDK + botão + backend + envs | ✅ |
| Embedded Signup popup (abre, fluxo roda) | ✅ provado |
| Onboard de cliente externo | 🔲 **bloqueado por App Review** ("Out Group não pode integrar clientes no momento") |
| App Review (Advanced Access) | 🔲 **a submeter** (ver `app-review-submission.md`) |

## Custo (modelo por mensagem, jul/2025+)
- Atendimento reativo (resposta na janela 24h) = **grátis**.
- Marketing/disparo ativo = pago (~$0,0625/msg BR), exige opt-in.
- **Cada cliente paga as próprias mensagens** (WABA dele) → Tier sem responsabilidade financeira. Limite nativo Meta: 250 conversas/dia (conta nova), escala por qualidade.

## Gotchas
- Variação "Cadastro incorporado do WhatsApp" só aparece via **modelo** ou Tech Provider — na criação manual da config só tem General (e General não lista o ativo WhatsApp).
- FB.login callback não pode ser async.
- Vite env vars precisam `is_buildtime=true` no Coolify pra entrar no bundle.
- App em "Em desenvolvimento" + sem App Review = não onboarda cliente externo (mostra "não pode integrar clientes no momento").

# App Review — Pacote de submissão (Tier Agent API Oficial)

> O que falta pra liberar o Embedded Signup pros clientes externos.
> App: **Tier Agent API Oficial** (`1644748586815003`). Atualizado: 2026-05-29.

---

## O que falta (resumo)
A integração está **pronta e funcionando** (popup abre, agente responde). Falta só a Meta aprovar o **Advanced Access** das permissões WhatsApp via App Review. Enquanto não aprova, o popup mostra *"Out Group não pode integrar clientes no momento"*. Prazo Meta: **~1-2 semanas**.

## Onde submeter
Painel do app → **Análise do app** (ou caminho "Publicar" → casos de uso). Pra cada permissão: preencher "Descreva como o app usa" + anexar **screencast** + concordar com uso permitido.

## Permissões a submeter (SÓ estas — app limpo)
1. `whatsapp_business_messaging`
2. `whatsapp_business_management`
3. `business_management` (se pedido)
4. `public_profile` (básica, geralmente auto)

⚠️ **NÃO** adicionar permissões de anúncios/páginas/etc. — reprova.

---

## Justificativas (copiar e colar em "Descreva como o app usa")

### whatsapp_business_messaging
```
O Tier Agent é uma plataforma de atendimento ao cliente via WhatsApp para
empresas. Usamos esta permissão para receber e responder mensagens em nome das
empresas que conectam sua conta WhatsApp Business através do nosso Embedded
Signup. Quando um consumidor envia mensagem ao número da empresa, recebemos via
webhook e respondemos automaticamente com um agente de IA configurado pela
própria empresa, dentro da janela de atendimento de 24 horas. Também enviamos
templates de mensagem aprovados quando aplicável. Não enviamos mensagens não
solicitadas; o atendimento é sempre iniciado pelo consumidor ou via opt-in.
```

### whatsapp_business_management
```
Usamos esta permissão para gerenciar a conta WhatsApp Business da empresa
cliente após o onboarding via Embedded Signup: registrar e configurar o número
de telefone, gerenciar templates de mensagem e consultar o status/qualidade da
conta. Isso é necessário para configurar e manter a integração de atendimento
automatizado de cada empresa.
```

### business_management
```
Usamos para acessar e gerenciar os ativos de negócio (WhatsApp Business Account)
que a empresa cliente compartilha conosco durante o Embedded Signup, conforme
explicitamente autorizado por ela no fluxo de login. Apenas os ativos
necessários para o atendimento via WhatsApp são acessados.
```

### public_profile
```
Usada pelo Facebook Login for Business para autenticar o administrador da
empresa durante o onboarding (Embedded Signup). Lemos apenas nome e foto do
perfil padrão para identificar quem autorizou a conexão.
```

---

## Roteiro do screencast (gravar 1 vídeo, ~2-3 min)

Grava a tela mostrando o fluxo ponta a ponta. Pode usar o número de teste já conectado (Maria Luiza) pra a parte de mensagens.

**Cena 1 — Onboarding (Embedded Signup)** → prova `business_management` + `public_profile`
- Abre `agent.tier.finance/admin/canais`
- Clica **"Conectar WhatsApp Oficial"** → popup do Facebook abre
- Loga → seleciona portfólio empresarial → seleciona/cria a conta WhatsApp Business + número → autoriza
- Mostra o número conectado no painel

**Cena 2 — Atendimento (mensagens)** → prova `whatsapp_business_messaging`
- De outro celular, envia uma mensagem ao número conectado (ex: "Oi, vocês estão abertos?")
- Mostra a mensagem chegando + o agente (Maria Luiza) **respondendo automaticamente**
- Mostra a resposta chegando no WhatsApp do cliente

**Cena 3 — Gestão** → prova `whatsapp_business_management`
- No painel, mostra a gestão do número/templates (status, perfil)

> Dica: narrar em voz ou legendar cada passo ("aqui a empresa conecta o WhatsApp dela", "aqui o agente responde o cliente"). Reviewers da Meta gostam de clareza.

---

## Respostas do "Tratamento de dados"

- **Dados acessados:** número de telefone do consumidor, conteúdo das mensagens, nome de exibição do contato.
- **Finalidade:** processar e responder o atendimento via agente de IA, em nome da empresa cliente.
- **Armazenamento:** criptografado, em servidores próprios (Postgres + R2). Tokens criptografados.
- **Compartilhamento:** provedores de modelo de IA (LLM) para gerar respostas; Meta (WhatsApp). Atuam como operadores sob nossas instruções.
- **Retenção/exclusão:** dados mantidos durante a prestação do serviço; exclusão sob solicitação em `https://agent.tier.finance/data-deletion` ou `privacidade@tier.finance`.
- **Conformidade:** LGPD (Lei 13.709/2018). Política em `https://agent.tier.finance/privacy`.

---

## Checklist final antes de submeter
- [ ] Só as 4 permissões WhatsApp no envio (sem anúncios/páginas)
- [ ] Justificativas coladas (acima)
- [ ] Screencast gravado (3 cenas) e anexado em cada permissão que pede
- [ ] Tratamento de dados respondido
- [ ] Política de privacidade + exclusão de dados acessíveis (✅ já estão)
- [ ] Ícone + categoria preenchidos (✅)
- [ ] Submeter → aguardar ~1-2 semanas

## Depois da aprovação
- O popup passa a **completar o onboarding** (cria/conecta a WABA do cliente).
- O endpoint `onboard` recebe o `code`, troca por token, cria o conector → cliente atendendo via agente.
- Publicar o app (sair de "Em desenvolvimento").

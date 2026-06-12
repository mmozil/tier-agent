# Product

## Register

product

## Users

Donos e operadores de PMEs brasileiras (tenants multi-tenant) que configuram **agentes de IA de atendimento** via WhatsApp (Cloud API oficial ou Baileys) e acompanham o dia a dia pelo admin (`agent.tier.finance/admin/*`): conversas, leads, playbooks, conhecimento, métricas de custo/latência. Uso diário, em contexto de trabalho, idioma pt-BR. Perfis secundários: atendentes humanos (handoff/inbox) e o time interno Tier (superadmin).

## Product Purpose

Tier Agent é o 5º produto Tier: SaaS de **agentes de IA configuráveis** que atendem clientes por WhatsApp e outros canais. O admin existe pra dar **controle e visibilidade**: configurar agente/persona/playbooks, conectar canais, acompanhar conversas e — porque IA cobra por uso — enxergar **custo, tokens e latência** com clareza. Sucesso = atendimento automatizado confiável + dono sabendo exatamente quanto gasta e onde.

## Brand Personality

**Premium, técnico e calmo** (direção documentada em `design-system-tier-agent-attio.md`): nível Attio/Linear/Firecrawl. Confiável e preciso; densidade alta com serenidade visual. A ferramenta desaparece na tarefa.

## Anti-references

- Dashboard genérico de "SaaS de IA" (gradiente roxo + glow + sparkles por toda parte).
- Cara de dev-tool cru (mono font em tudo, zeros cortados Ø em valores de negócio).
- Template admin genérico (cards idênticos com ícone+título+texto repetidos).
- Circo visual: nada ousado-espetáculo; motion só pra estado, nunca decoração.

## Design Principles

1. **A linha estrutura, não a caixa** — hairlines full-bleed (sistema FC: Rows, HairCells, CurvyRect) no lugar de cards soltos.
2. **Custo sempre legível** — produto de IA cobra por uso; números de custo/latência são cidadãos de primeira classe, em sans tabular, não em mono de terminal.
3. **Estados vazios ensinam** — todo vazio diz o que significa e aponta a próxima ação (conectar canal, criar agente), nunca só "sem dados".
4. **Familiaridade conquistada** — vocabulário consistente entre telas (mesmos botões, toggles, tabelas); usuário fluente em Linear/Stripe confia à primeira vista.
5. **Skeleton, não spinner** — carregamento mostra a forma da página, não uma roda no vazio.

## Accessibility & Inclusion

WCAG AA: texto corrente ≥4.5:1 (atenção aos tokens alpha `FC.mut`/`FC.sub` sobre `#F9F9F9`), foco visível, navegação por teclado, `prefers-reduced-motion` respeitado em toda animação. Dark mode completo (tokens `dark:` em todos os componentes).

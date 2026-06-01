# Tier Agent — Design System

> Doc **canônica e viva** do design do Tier Agent. Atualizar a cada mudança de
> design (tokens, componentes, decisões). Substitui/consolida os antigos
> `design-system-tier-agent.md` e `design-system-tier-agent-attio.md`.
>
> _Última atualização: 2026-05-30._

## 1. Direção / Arquétipo

**"Calm Precision" — estrutura de dashboard Firecrawl × cores Tier.**

- **Marketing (landing)** — densidade baixa, arejado, Attio-grade. Motion de entrada/reveal (Framer Motion).
- **Produto (painel /admin)** — densidade alta, estrutura estilo dashboard Firecrawl (grade de hairlines, API-key box, CLI inline, badges), mas com a **paleta Tier** (azul, nunca laranja). Motion só de feedback.

Princípios:
- **Cor só com função** — azul = ação/marca/ativo; verde/âmbar/vermelho = status/performance. Zero gradiente decorativo no produto.
- **Números sempre `font-mono tabular-nums`** (alinham em coluna, cara de ferramenta séria).
- **Hairlines + grade** seccionam o conteúdo (não cards flutuantes soltos no produto).
- **Um sistema, dois contextos** (mesmos tokens, densidade diferente). Os componentes de fluxo (`FlowNode`/pills) são compartilhados entre o demo da landing e o canvas real.

## 2. Tokens

### 2.1 Acento (marca Tier)
| Token | Light | Dark |
|---|---|---|
| accent | `#003083` | `#5b9bff` |
| accent-hover | `#002266` | `#7eb0ff` |
| accent-tint (bg ativo) | `#003083` @ 8% (`/[0.08]`) | `#5b9bff` @ ~12% |

> No dark o acento clareia (`#5b9bff`) por contraste. Em código JSX usar
> `const A = dark ? "#5b9bff" : "#003083"`.

### 2.2 Neutros
| Papel | Light | Dark |
|---|---|---|
| página | `#FFFFFF` / `#FBFBFB` | `#0c0e12` |
| sidebar | `#FFFFFF` | `#0e1116` |
| card / superfície | `#FFFFFF` | `#14171c` |
| hairline (divisória) | `#EEEFF1` | `#1e2228` |
| border (mais forte) | `#E4E7EC` | `#23272e` |
| hover bg | `#F5F6F8` / `#F2F4F7` | `#16191f` |
| input/search bg | `#F1F3F5` | `#16191f` |

### 2.3 Texto
| Papel | Light | Dark |
|---|---|---|
| primário (ink) | `#0D0F11` | `#e6e8eb` |
| secundário | `#6A7385` | `#9aa1ab` / `#8b93a0` |
| muted | `#9AA4B2` | `#6b7280` |
| micro-label (uppercase) | `#B4BBC6` | `#565d68` |

### 2.4 Semânticas (status/performance — NÃO decorativas)
| Estado | Light | Dark |
|---|---|---|
| positivo (bom/up) | `#0a8f5a` | `#34d399` |
| atenção | `#F5A300` | `#fbbf24` |
| negativo (ruim/down) | `#E5484D` | `#fb7185` |

### 2.5 Tipografia
> **Aprendido inspecionando o Firecrawl real (01/jun):** UI = **Suisse Int'l** (paga; alt. grátis próxima: Geist/Hanken Grotesk), **títulos peso 450** (leve!) + `letter-spacing: -0.1px`, mono = **Geist Mono**, nav 16px/400, texto `#262626`. Linha separadora `border-faint` **#EDEDED** (`--border-muted` #E8E8E8). Hover da sidebar = **preto 2–3%** (`black-alpha-2/3`), bem sutil. → No Tier: manter Inter, mas **usar pesos leves (`font-medium`/`font-semibold`, nunca `font-bold` em títulos)**, hairline `#EDEDED`, hover `bg-black/[0.03]`.

- **UI**: Inter (system stack fallback). Pesos leves (≤600 em títulos).
- **Números / dinheiro / métricas / chaves / código**: `font-mono tabular-nums` (Geist Mono → JetBrains Mono).
- Hierarquia: KPI valor `text-[24-25px] font-bold`, label `text-[11px] uppercase tracking-wide`, micro-label de seção `text-[10px] font-bold uppercase tracking-wider`.

### 2.6 Forma
- Cards/painéis: `rounded-2xl` (produto) · `rounded-[14px]` (cards de fluxo) · landing varia.
- Botões/inputs/badges: `rounded-lg` (10px) / `rounded-md`.
- Sombra mínima. **Glow** só no KPI "hero" (`0 8px 24px -12px ${accent}55`) e no border-beam do hero da landing.

## 3. Componentes (contratos)

- **Sidebar** — logo Tier no topo (`/tier-agent-escuro.png` light · `/tier-agent-claro.png` dark), seções com micro-label uppercase, item ativo = pill azul-tint (`bg-accent/[0.08]` + texto/ícone azul). Item idle: texto secundário, ícone `opacity-60`, hover `#F5F6F8`.
- **Topbar** — workspace switcher (`[T] Nome ▾`), ações (sino, tema, Ajuda, Docs) + **Upgrade** (botão sólido azul). Borda inferior hairline.
- **KpiCard** — `rounded-2xl` + border hairline. Label uppercase muted + valor mono `text-[24px] font-bold` + delta semântico (`ArrowUpRight/Down` + mono). Variante `hero`: ring + glow azul + radial sutil no canto.
- **Grade de hairlines** (estilo "Explore endpoints" do Firecrawl) — células num grid com `border-t border-l` no container e `border-r border-b` em cada célula. Ícone + título + desc + badge opcional. Hover `#FAFBFC`.
- **Table** — header uppercase `text-[11px]` muted + border-b hairline; linhas `text-[13px]`, hover, zebra opcional; números à direita `font-mono tabular-nums`; status = dot 6px semântico.
- **API-key box** — `bg-accent/[~4%]` + `border-accent/[~15%]`, chave em mono cor accent + ícones eye/copy.
- **CLI / Code card** — terminal escuro (`#14171c`/`#0a0c10`), 3 dots (1 accent), título mono, badge `200 OK` verde. Conteúdo mono `text-[11-12px]`: prompt `$` muted, comando, accent `#5b9bff` em chaves, `#34d399` em strings. **Dentro do terminal o accent é sempre `#5b9bff`** (contraste no fundo escuro), independente do tema.
- **Badge NOVO** — pill sólido accent, texto branco, `text-[9px] font-bold uppercase`.
- **Botões** — primário: sólido accent, texto branco, `rounded-lg`, sombra sutil. Secundário/ghost: hover `#F5F6F8`. Outline: `border-[#E4E7EC]`.
- **Filter bar** — faixa entre hairlines (`border-t border-b`) com: search pill (`bg-#F1F3F5`) + selects (botões outline `rounded-lg` + `ChevronDown`); filtro de data alinhado à direita (`ml-auto`).
- **Sub-nav de Settings** — coluna esquerda (~220px) com `border-r` hairline; itens = pills (ativo azul-tint, igual sidebar). Conteúdo à direita em seções separadas por `divide-y` hairline; cada seção: título `text-[15px] font-bold` + desc muted + campo + botão `Salvar` accent.
- **Pagination** — `Página N · X de Y` muted à esquerda + setas prev/next (botões outline `w-8 h-8`).

- **Crosshairs de junção (`PlusMarks`)** — efeito blueprint Firecrawl: pequenos "+" (svg 9px, cor `#CFD4DB` / dark `#3a414c`) nas interseções da grade hairline. Posicionados em `top:0/100%` × colunas `i/cols`. Wrap a grade em `relative` e renderize `<PlusMarks cols={N}/>` por cima. _(1ª versão — refinar com o detalhe exato do Firecrawl.)_

### 3.1 Arquétipos de página (exemplos em `/design-proof`)
- **Home / Visão geral (estilo Chatwoot)** — atalhos em grade (com crosshairs) → **KPI strip** (Conversas abertas / Não atendidas / Resolvidas pela IA / Aguardando humano, com crosshairs) → `[gráfico de conversas | status dos agentes]` → `[heatmap de tráfego 7d×horas | carga por agente (barras)]` → `[API key | CLI]`. Métricas de suporte estilo Chatwoot + métricas de IA (resolução, custo). Tudo seccionado por hairlines.
- **Lista/Logs** — header (título 26px + subtítulo) → filter bar → **table** (horário mono, evento em pill mono, status = dot semântico + label) → pagination. Sem cards: a página inteira é seccionada por hairlines.
- **Settings** — header → `[sub-nav 220px | conteúdo]`. Conteúdo = seções `divide-y` (Nome, Convidar membros, Membros). Linha de membro: avatar + email + badge papel (`ADMIN` em azul-tint).
- **Usage / Consumo** (ref. Firecrawl) — header → seção "Créditos restantes" (número grande + plano + data de renovação + "ver saldos") → seção "Uso recente" (toggle período `1d/7d/30d/Custom` + filtros `Chave: Qualquer` / `Endpoint: Qualquer` + gráfico ou empty state) → seção "Concorrência" (gráfico com eixo de horas + MAX). Tudo entre hairlines.
- **API Keys** (ref. Firecrawl) — header → seção "Suas chaves" com botão **Criar** (à direita) → lista de cards de chave: nome (`Default`) + menu + chave mascarada `tk-5•••c7a1` + botões show/copy + "Criada em {data}".

## 4. Motion
- **Produto** — só feedback (hover, toggle, loading). Sem animação decorativa.
- **Marketing** — entrada em stagger no load + reveal ao rolar (Framer Motion, easing `[0.22,1,0.36,1]`). Border-beam/spotlight sutis só no hero.
- Fluxo do canvas (`PlaybookDemo`): nós acendem em sequência, conector tracejado (`animate-dashflow`), pulso "Running" (`animate-runpulse`).

## 5. Dark mode
- Tailwind `darkMode: "class"`. Alterna classe `dark` no `<html>` (persistir em localStorage).
- Usar a tabela de neutros/texto/semânticas dark acima.
- **Regra**: só ligar o dark globalmente quando TODAS as páginas tiverem `dark:` — senão conteúdo claro no shell escuro = quebrado.

## 6. Do / Don't
- ✅ Cor só com função · números mono tabular · densidade alta no produto · hairlines pra seccionar · logo Tier no topo da sidebar.
- ❌ Laranja (é Firecrawl, não Tier) · gradiente/glow decorativo no produto · segunda cor de marca · glassmorphism · ligar dark antes de migrar as páginas · cards flutuantes onde a grade de hairlines cabe.

## 7. Onde vive no código
- **Referência visual**: `frontend/src/pages/public/DesignProof.tsx` (prova `/design-proof`, mock — manter como referência da linha).
- **Shell do produto**: `frontend/src/components/AdminLayout.tsx`.
- **Chrome de marketing + componentes de fluxo**: `frontend/src/components/landing/marketing.tsx` (`MarketingNav`, `FlowNode`, `FlowEdge`, `BranchSplit`).
- **Demos animados**: `landing/PlaybookDemo.tsx`, `AgentResearchDemo.tsx`, `ScaleGlobe.tsx`.
- **Motion/efeitos**: `landing/motion.tsx`, `landing/effects.tsx`.
- **Tokens de animação + darkMode**: `frontend/tailwind.config.ts`.

## 8. Decisões (log)
- **2026-05-30** — Direção **"Calm Precision" (Firecrawl × Tier)** travada após iterar (rejeitados: Linear puro azul; Firecrawl laranja). Estrutura de dashboard Firecrawl (grade hairline, API-key box, CLI) **com cores Tier**. Prova em `/design-proof`.
- **2026-05-30** — `AdminLayout` (casca) migrado pra nova linha em **light** (item ativo azul-tint, hairlines, seções refinadas, ícone do ativo azul). Dark mode e corpos das 19 páginas: migração incremental pendente (coordenar com a sessão paralela que edita o admin).
- **2026-05-30** — `darkMode: "class"` habilitado no Tailwind + keyframes de motion (borderbeam, spinslow, runpulse, dashflow, revealup).
- **2026-05-30** — **Sidebar do produto: manter o padrão atual do `AdminLayout`** (logo topo, seções, UserMenu no rodapé). O restyle da casca foi **revertido** — a linha nova (Firecrawl × Tier) aplica-se ao **conteúdo das páginas**, não à sidebar.
- **2026-05-30** — Adicionados 2 arquétipos de página ao proof: **Logs de atividade** (filter bar + table + pagination) e **Configurações** (sub-nav + seções divide-y). Proof agora tem 3 páginas clicáveis (Visão geral / Logs / Configurações), light + dark.

## 9. Próximos passos da migração
1. Codificar tokens como CSS variables / util `cn` + primitives (KpiCard, HairlineGrid, DataTable, ApiKeyBox, CodeCard, Badge, Button).
2. Migrar páginas admin uma a uma pro padrão (começar por **Métricas** — já prototipada) + suporte `dark:`.
3. Ligar o toggle de dark mode global (ThemeProvider + localStorage) só quando todas as páginas suportarem.
4. Unificar o `FlowNode` do demo com o canvas real de `/admin/playbooks`.

# design-system-tier-agent.md

> **Doc canônica** do design system do Tier Agent. Única fonte da verdade.
> Playground visual: `agent.tier.finance/design-system` (ou `localhost:5173/design-system`)
> Última atualização: 2026-06-25 — consolidado a partir de 3 docs anteriores.

---

## 1. Direção / Arquétipo

**"Calm Precision" — dashboard Firecrawl com paleta Tier (azul `#003083`).**

Valores extraídos do Firecrawl real (DOM/CSS ao vivo, `D:/Project/DESIGN/firecrawl-ref/`):

- **Fundo `#F9F9F9`** (`background-base`) — nunca branco puro.
- **Hairlines `#EDEDED`** (`border-faint`) — o único tipo de borda/separador.
- **Linhas full-width**: cada seção (`Row`) tem a linha horizontal até as extremidades da página; o conteúdo fica contido num container central com rails (`border-l/r`).
- **`curvy-rect`**: 4 corner brackets SVG 11×11 arredondam os cruzamentos linha/rail, formando o "+".
- **Cor só com função**: azul `#003083` = ação/marca/ativo; verde/âmbar/coral = status apenas.
- **Números** em `font-mono tabular-nums` (assinatura Tier).

Duas superfícies — um sistema:

| Superfície | Onde | DS |
|---|---|---|
| **Admin** (`/admin/*`) | Agentes, métricas, conversas, configurações | `fc.tsx` (primitivos Firecrawl × Tier) |
| **Marketing** (`/`, `/precos`, `/plataforma`) | Landing, pricing, features | `tailwind.config.ts` (tokens Attio-grade: `ink`, `surface`, `hairline`, `line`, `accent`) |

> **Regra**: páginas admin sempre usam `fc.tsx`. Páginas públicas usam tokens do tailwind. **Nunca misturar.**

---

## 2. Tokens — `FC` object em `frontend/src/components/ds/fc.tsx`

### 2.1 Cor (valores reais FC, um único `#262626` com opacidades)

| Token | Classe Tailwind | Valor | Uso |
|---|---|---|---|
| `FC.ink` | `text-[#262626]` | full | Texto principal |
| `FC.sub` | `text-[#262626]/[0.56]` | 56% | Subtítulos, descrições |
| `FC.dim` | `text-[#262626]/[0.72]` | 72% | Sidebar idle |
| `FC.mut` | `text-[#262626]/40` | 40% | Micro-labels, ícones |
| `FC.hair` | `border-[#EDEDED]` | `#EDEDED` | Todas as bordas |
| `FC.hairBg` | `bg-[#EDEDED]` | `#EDEDED` | Divisores como `<div>` |
| `FC.hover` | `hover:bg-black/[0.04]` | preto 4% | Hover de superfície |
| `FC.base` | `bg-[#F9F9F9]` | `#F9F9F9` | Fundo de página/cards |

**Dark mode:** página `#0c0e12`, hairline `#23272e`, acento `#5b9bff`.

**Cores semânticas de status** (não usar para decoração):

| Papel | Cor light | Dark |
|---|---|---|
| Positivo / sucesso | `#0a8f5a` | `#34d399` |
| Atenção / pending | `#F5A300` | `#fbbf24` |
| Negativo / erro | `#E5484D` / `#c0362c` | `#ff6b5e` |
| Acento Tier | `#003083` | `#5b9bff` |

### 2.2 Tipografia (escala FC — fonte system/Geist)

| Uso | size / weight / line-height / tracking |
|---|---|
| Título de página (`label-x-large`) | **20 / 450 / 28px / -0.1px** |
| Título de seção (`label-large`) | **16 / 450 / 24px / 0** |
| Item de sidebar / descrição (`body-small`) | **13 / 400 / 20px / 0** |
| Body padrão (`body-medium`) | **14 / 400 / 20px / 0.14px** |
| Micro-label uppercase (KPI) | **11 / 600 / uppercase** |
| Valor KPI / número | `font-mono tabular-nums` — 24 / 500 |

> Títulos **nunca `font-bold`** — peso 450/500. Sem ícone antes de título de seção.

### 2.3 Forma

- **Frame da página**: sem `border-radius` (cantos vêm do `CurvyRect`).
- **Botões / inputs / selects**: `rounded-[10px]` (10px).
- **Cards de fluxo (playbook canvas)**: `rounded-[14px]`.
- **Sombra mínima** — hairline no lugar de shadow. Botão primário: `PRIMARY_SHADOW` (micro-sombras empilhadas + inset glow azul).

---

## 3. Primitivos — `frontend/src/components/ds/fc.tsx`

| Export | Tipo | O quê |
|---|---|---|
| `FC` | object | Tokens de cor como classe Tailwind |
| `PRIMARY_SHADOW` | string | Sombra empilhada do botão primário (Firecrawl style) |
| `btnPrimary` | string | Classe única de botão primário — azul `h-8` |
| `iconBtn` | string | Classe de botão-ícone quadrado `w-8 h-8` |
| `SKEL` | string | Classe base de skeleton (`animate-pulse`) |
| `CONTENT_MAX` | number | `1232` — largura máxima dos rails |
| `ScrambleText` | component | Efeito "decode" de letras no mount (estilo Firecrawl) |
| `CurvyRect` | component | 4 corner brackets SVG que formam o "+" nas junções |
| `PageFrame` | component | Wrapper full-width com bg `#F9F9F9` |
| `Row` | component | Seção com linha horizontal full-width + rails centralizados |
| `Spacer` | component | Faixa vazia entre blocos |
| `SectionHeader` | component | Título `label-x-large` + subtítulo + slot `right` |
| `PageHero` | component | Banner de topo estilo API Keys do FC (28px + chuva matrix) |
| `PageHeroRidge` | component | Decoração canvas (chuva matrix azul Tier) — usado pelo PageHero |
| `HairCells` | component | Grade flush 2–5 colunas (`border-r` entre células) |
| `Button` | component | Botões admin: `primary / secondary / ghost / danger`, `sm / md` |
| `Select` | component | Dropdown customizado FC (trigger h-8 + painel flutuante) |
| `SegToggle` | component | Toggle segmentado (7/30/90d) — ativo azul |
| `EmptyHint` | component | Estado vazio com ícone + texto + CTA link |
| `SkeletonBar` | component | Barra skeleton dimensionável via `className` |

### Padrão de página admin

```tsx
<div className="-mx-8 pb-10">      {/* cancela o px-8 do AdminLayout */}
  <PageFrame>
    <PageHero title="Título" subtitle="Descrição" right={<Button>Ação</Button>} />
    <Row><HairCells cols={4}>{/* 4 KPIs */}</HairCells></Row>
    <Row>{/* gráfico / conteúdo principal */}</Row>
    <Row last>{/* tabela / lista */}</Row>
  </PageFrame>
</div>
```

---

## 4. Shell — `frontend/src/components/AdminLayout.tsx`

- **Sidebar** 240px, bg `#F9F9F9`, `border-r #EDEDED`.
  - Logo em área `h-16` com `border-b`.
  - Seções: micro-label `11px uppercase tracking-wider` @40%.
  - Item: `h-[34px] rounded-[10px] text-[13px]`. Idle: texto @72% / ícone `opacity-60`.
  - Hover (SEM bg): texto → `#262626` + ícone `opacity-100` + `active:scale-[0.98]`.
  - Ativo: texto/ícone `#003083` + bg `#003083/[0.06]`.
  - Rodapé: user `border-t`.
- **Topbar** 60px:
  - Busca pill `#F1F3F5`.
  - Botões **Ajuda / Docs**: outline `h-8 border-[#EDEDED] text-[12px]`.
  - Botão **Upgrade**: primário `h-8 bg-[#003083] text-white text-[12px]` + `PRIMARY_SHADOW` + `ScrambleText`.
- **Conteúdo**: `px-8`. Páginas usam `-mx-8` no wrapper pra as linhas vazarem até a borda.

---

## 5. Botões — referência rápida

| Variante | Classe base | Quando usar |
|---|---|---|
| `primary` | `h-8 bg-[#003083] text-white + PRIMARY_SHADOW` | CTA principal da página, ação destrutiva confirmada |
| `secondary` | `h-8 border FC.hair FC.hover` | Ações secundárias (filtrar, exportar) |
| `ghost` | `h-8 px-2.5 FC.sub FC.hover` | Ações terciárias, botões de link em toolbar |
| `danger` | `h-8 text-[#c0362c] hover:bg-[#c0362c]/[0.06]` | Deletar, revogar |
| `iconBtn` | `w-8 h-8 rounded-[10px] FC.dim FC.hover` | Ações de ícone (editar, copiar em tabelas) |

> Todos os botões: `active:scale-[0.98]`, `transition-all`, `outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/30`.

---

## 6. Dark mode

`darkMode: "class"`. Toggle em `AdminLayout` (botão na topbar).

Convenções obrigatórias:
- Fundo: `dark:bg-[#0c0e12]` (página) / `dark:bg-[#14171c]` (cards/inputs)
- Hairline: `dark:border-[#23272e]`
- Texto: `dark:text-[#e6e8eb]` (ink) / `dark:text-[#8b93a0]` (sub)
- Acento: `dark:text-[#5b9bff]` / `dark:bg-[#5b9bff]`
- **Nunca** `slate-900/800/700` (tom azulado errado)

---

## 7. Do / Don't

| ✅ Fazer | ❌ Nunca |
|---|---|
| Fundo `#F9F9F9` | Branco puro `#fff` de fundo |
| Hierarquia por opacidade de `#262626` | Vários cinzas diferentes (`gray-400`, `slate-500`...) |
| Hairlines `#EDEDED` únicas | Sombras decorativas pesadas |
| `Row` com linha full-width + conteúdo contido | Linhas que param no padding do container |
| Títulos de seção **sem ícone** | Ícone antes de `<h2>` de seção |
| Números `font-mono tabular-nums` | Números em fonte proporcional |
| Hover sidebar sem bg (só mudança de cor) | `hover:bg-` na sidebar |
| `rounded-[10px]` em botões/inputs | `rounded-full` ou `rounded-sm` em botões |
| `active:scale-[0.98]` em botões | Botões sem feedback de toque |
| Cor para função (azul=ação, verde=ok, âmbar=warn) | Cor decorativa sem semântica |

---

## 8. Onde vive no código

| Arquivo | Papel |
|---|---|
| `frontend/src/components/ds/fc.tsx` | **THE** DS do admin — primitivos + tokens |
| `frontend/src/components/AdminLayout.tsx` | Shell (sidebar 240px + topbar 60px) |
| `frontend/src/pages/admin/MetricasPage.tsx` | Página piloto (padrão Row + HairCells) |
| `frontend/src/pages/public/DesignSystemPage.tsx` | Playground visual — `agent.tier.finance/design-system` |
| `frontend/tailwind.config.ts` | Tokens marketing (Attio-grade) — NÃO para admin |
| `D:/Project/DESIGN/firecrawl-ref/` | Referência FC extraída (DOM/CSS reais) |

---

## 9. Decisões (log)

- **2026-05-25** — v1 "Calm Precision" (direção Stripe adaptada para AI/agente).
- **2026-05-28** — Experimento Attio-grade paralelo (tokens extractos do attio.com). Descartado.
- **2026-06-02** — Direção travada como **Firecrawl × Tier** (valores extraídos do FC real via Playwright). Criados primitivos `fc.tsx`. Migrados shell + MetricasPage.
- **2026-06-25** — Docs consolidados (3 → 1). Playground criado (`/design-system`). Botões normalizados para `h-8 text-[12px]` em Visão Geral + topbar. Doc única `design-system-tier-agent.md`.

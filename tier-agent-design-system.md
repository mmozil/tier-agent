# Tier Agent — Design System

> Doc **canônica e viva** do design do Tier Agent. Atualizar a cada mudança.
>
> _Última atualização: 2026-06-02 — direção **Firecrawl × Tier** (valores extraídos do FC real)._

## 1. Direção / Arquétipo

**"Calm Precision" — estrutura de dashboard Firecrawl com a paleta Tier (azul).**

Extraído do Firecrawl real (DOM/CSS ao vivo, em `D:/Project/DESIGN/firecrawl-ref/`):
- **Fundo `#F9F9F9`** (`background-base`) — não branco puro. Hairlines `#EDEDED` (`border-faint`).
- **Linhas full-width**: cada seção é uma `Row` cuja linha horizontal vai até as **extremidades da página**; o **conteúdo fica contido** num container central com rails (`border-l/r`).
- **`curvy-rect`**: 4 corner brackets SVG 11×11 (fill `#EDEDED`) arredondam os cantos do container; nas junções formam o "+".
- **Cor só com função** — azul `#003083` = ação/marca/ativo; verde/âmbar/coral = status.
- **Números** em `font-mono tabular-nums` (assinatura Tier).

## 2. Tokens (valores reais FC)

### 2.1 Cor
| Papel | Valor | Token FC |
|---|---|---|
| ink (texto principal) | `#262626` | `accent-black` |
| secundário (subtítulo/desc) | `#262626` @ **56%** | `black-alpha-56` |
| sidebar item (idle) | `#262626` @ **72%** | `black-alpha-72` |
| muted (micro-label/ícone) | `#262626` @ **40%** | `black-alpha-40` |
| hairline (borda) | `#EDEDED` | `border-faint` |
| hover de superfície | preto @ **4%** | `black-alpha-4` |
| fundo (página/cards) | `#F9F9F9` | `background-base` |
| **acento Tier** | `#003083` (dark `#5b9bff`) | — |
| positivo / atenção / negativo | `#0a8f5a` / `#F5A300` / `#E5484D` | — |

> Hierarquia de cor = **um ink `#262626` com opacidades** (não vários cinzas).
> Em JSX: `const A = dark ? "#5b9bff" : "#003083"`.

### 2.2 Tipografia (escala exata FC — fonte **Geist** ≈ Suisse Int'l; mono **Geist Mono**)
| Uso | size / weight / line-height / tracking |
|---|---|
| título de página / seção (`label-x-large`) | **20 / 450 / 28 / -0.1px** |
| título de sub-seção (`label-large`) | **16 / 450 / 24 / 0** |
| sidebar item / subtítulo / desc (`body-small`) | **13 / 400 / 20 / 0** |
| body (`body-medium`) | 14 / 400 / 20 / 0.14px |
| micro-label uppercase (KPI) | 11 / 600 uppercase, cor muted |
| valor KPI / número | `font-mono tabular-nums` 24 / 500 |

> Títulos NUNCA `bold` — peso **450/500**. Títulos de seção **sem ícone** (igual FC).

### 2.3 Forma / sombra
- **Sem** `border-radius` no frame (cantos vêm do `curvy-rect`). Botões/inputs `rounded-lg` (10px). Cards de fluxo `rounded-[14px]`.
- Sombra mínima — hairline no lugar de shadow. Botão primário leva `shadow-[0_1px_2px_rgba(0,48,131,0.18)]`.

## 3. Primitivos (`frontend/src/components/ds/fc.tsx`)

| Primitivo | O quê |
|---|---|
| `FC` | objeto de tokens em classe (`ink`, `sub`, `mut`, `dim`, `hair`, `hover`, `base`) |
| `PageFrame` | wrapper full-width (bg `#F9F9F9`); contém uma pilha de `Row` |
| `Row` | UMA seção: linha horizontal **full-width** (até as bordas) + conteúdo central nos rails (`border-l/r`) + `CurvyRect`. `last` adiciona a linha de baixo |
| `CurvyRect` | os 4 corner brackets (overlay `absolute inset-0`, não ocupa célula) |
| `HairCells` | grade flush (`border-r` entre colunas); ex.: KPIs 4 col |
| `SectionHeader` | título `label-x-large` + subtítulo `body-small` @56% + `right` (ações) |
| `SegToggle` | toggle segmentado (7/30/90d): ativo azul, `active:scale-[0.97]` |
| `Button` | `primary` (azul sólido + sombra) / `secondary` (outline + hover preto 4%) / `ghost`; todos `active:scale-[0.98]` |

**Padrão de página** (todas as páginas admin):
```tsx
<div className="-mx-8 pb-10">      {/* cancela o px-8 do AdminLayout → linhas até a borda */}
  <PageFrame>
    <Row>{/* header: h2 label-x-large + sub + ações à direita */}</Row>
    <Row><HairCells cols={4}>{/* KPIs */}</HairCells></Row>
    <Row>{/* gráfico / conteúdo, p-6 */}</Row>
    <Row last>{/* tabela final */}</Row>
  </PageFrame>
</div>
```

## 4. Shell — `AdminLayout`

- **Sidebar** 240px, bg `#F9F9F9`, `border-r #EDEDED`.
  - **Logo** em área `h-16` com **`border-b`** (linha sob o logo).
  - **Seções**: micro-label `11px uppercase tracking-wider` @40%.
  - **Item**: `h-[34px] rounded-[10px] text-[13px]`, idle texto @72% / ícone opacity-60.
    **Hover (igual FC, SEM bg)**: `transition-all duration-200` → texto clareia p/ `#262626` + ícone `opacity-100`; clique `active:scale-[0.98]`.
    **Ativo**: texto/ícone azul `#003083` + bg `#003083/[0.06]`.
  - Rodapé: user (`border-t`).
- **Topbar** 60px: busca pill `#F1F3F5` + ações ghost + **Upgrade** primário.
- **Conteúdo**: `px-8`; páginas usam `-mx-8` no wrapper pra as linhas vazarem até a borda.

## 5. Dark mode
- `darkMode: "class"`. Neutros dark: página `#0c0e12`, hairline `#23272e`, acento clareia `#5b9bff`. Migrar incremental.

## 6. Do / Don't
- ✅ Fundo `#F9F9F9` · ink `#262626` com opacidades · hairlines `#EDEDED` · linhas até as bordas (Row) + conteúdo contido · títulos de seção **sem ícone** · números mono · hover sidebar sem bg.
- ❌ Branco puro de fundo · vários cinzas diferentes · `font-bold` em títulos · ícone antes de título de seção · `border-radius` no frame (usar `curvy-rect`) · background no hover da sidebar · laranja (é Firecrawl, não Tier).

## 7. Onde vive no código
- **Primitivos**: `frontend/src/components/ds/fc.tsx`
- **Shell**: `frontend/src/components/AdminLayout.tsx`
- **Piloto**: `frontend/src/pages/admin/MetricasPage.tsx`
- **Preview público** (sem login): `frontend/src/pages/public/MetricasPreview.tsx` → `/preview/metricas`
- **Referência FC extraída**: `D:/Project/DESIGN/firecrawl-ref/` (dashboard.html + CSS reais + DESIGN-SYSTEM-REAL.md)

## 8. Decisões (log)
- **2026-06-02** — Direção travada como **Firecrawl × Tier** com valores **extraídos do FC real** (logado via Playwright). Criados primitivos `fc.tsx`. Migrados shell + MetricasPage. Removido: corner-bracket mal-implementado, bg branco, ícones em títulos de seção. Padrão `Row` (linhas full-width + conteúdo contido). Hover sidebar replicado do FC (cor + scale, sem bg). Doc anterior ("Calm Precision" estimado no olho) substituída por esta (medida).

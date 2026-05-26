# Design System — Tier Agent

> Plataforma SaaS de agentes IA configuráveis. Subdomínio `agent.tier.finance`.
> Atualizado em: 2026-05-25 (v1 — Foundation)

---

## Arquétipo

**Stripe Dashboard adaptado pra produto AI/agente** — mesma densidade e clareza do Tier Empresas, com toques de roxo/violeta no acento secundário pra sinalizar "AI/automation".

Modelado a partir do padrão canônico Tier Empresas (`design-system-tier-empresas.md`) + Login dark Stripe do Tier Emissor.

---

## Bifurcação visual

| Área | Tema |
|---|---|
| **Login / Signup / Landing** | Dark Stripe (`#0a0a0a` + vídeo de fundo + card 480px) — igual Tier Emissor |
| **Admin (`/admin/*`)** | Light Stripe (igual Tier Empresas) — uso diário, densidade alta |

---

## Paleta

### Cor brand (idêntica ao Tier Empresas — design system unificado)

| Token | Hex | Uso |
|---|---|---|
| **accent-primary** | `#003083` | Tier blue — itens ativos sidebar, links, tab underline |
| **accent-hover** | `#002266` | Hover |
| **accent-light** | `#0050D5` | Variação clara (botões secundários) |
| **favicon-3-quad** | `#1a1a1a` / `#4a4a4a` / `#888` | Favicon 3 quadrados — MESMA cor de Tier Empresas (unificação) |

### Light mode (padrão admin)

| Token | Hex | Uso |
|---|---|---|
| **bg-page** | `#f8fafc` (slate-50) | Fundo principal (área de conteúdo) |
| **bg-surface** | `#ffffff` | Cards |
| **bg-sidebar** | `#ffffff` | Sidebar |
| **bg-hover** | `#f8fafc` (slate-50) | Hover em items |
| **bg-active** | `rgba(0,48,131,0.08)` | Item ativo sidebar (tier/8) |
| **border** | `#e2e8f0` (slate-200) | Bordas |
| **border-light** | `#f1f5f9` (slate-100) | Divisores internos |
| **text-primary** | `#0f172a` (slate-900) | H1, KPI, valores |
| **text-body** | `#1a2c44` | Body, tabela |
| **text-secondary** | `#64748b` (slate-500) | Subtextos |
| **text-muted** | `#94a3b8` (slate-400) | Placeholders, labels secundárias |
| **success** | `#10b981` | Status ativo |
| **danger** | `#e11d48` (rose-600) | Sair, deletar |
| **warning** | `#f59e0b` | Pendente |

### Dark mode (Login/Signup)

| Token | Hex | Uso |
|---|---|---|
| **bg-page** | `#0a0a0a` | Fundo |
| **video-overlay** | `bg-gradient-to-br from-black/60 via-black/30 to-transparent` | Overlay sobre vídeo |
| **card** | `rgba(18,18,18,0.85)` + backdrop blur 20px | Card login 480px |
| **card-shadow** | `0 15px 35px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)` | Card |
| **input-bg** | `#1e1e1e` | Inputs |
| **input-border** | `box-shadow: 0 0 0 1px #333` | Input outline |
| **input-focus** | `box-shadow: 0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)` | Focus glow |
| **text-card** | `#fff` | Heading no card |
| **text-card-body** | `text-slate-300` | Labels |
| **text-card-muted** | `text-slate-400` | Subtextos |

---

## Tipografia

### Font family

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

System stack idêntico ao Stripe (já em `tailwind.config.ts`).

### Logo

```css
font-family: 'Exotica', sans-serif;
```

Usado nos labels dos produtos dentro do product switcher (popup avatar). Importar via Tier Empresas em V2 se quiser perfeição visual.

### Escala (padrão Stripe — espelha Tier Empresas)

| Elemento | Tamanho | Peso | Cor | Uso |
|---|---|---|---|---|
| **H1 página** | `text-[28px]` | medium (500) | slate-900 | "Agentes", "LLM Providers", "Feature Flags" |
| **H2 seção** | `text-[18px]` | medium (500) | slate-900 | Header de card grande, modais |
| **H3 card** | `text-[14px]` | medium (500) | slate-900 | Titulo de card individual, table header |
| **Body** | `text-[14px]` | normal (400) | `#1a2c44` | Texto corrido, valores tabela |
| **Body small** | `text-[13px]` | normal (400) | slate-500 | Subtexto, descrições |
| **Label** | `text-[12px]` | medium (500) | slate-500 | Labels de form |
| **Caption** | `text-[11px]` | medium (500) | slate-400 | Section headers sidebar |
| **Mono (números)** | `font-mono` | — | — | IDs, ports, hashes |

### Tracking

- H1: `tracking-tight` (padrão Stripe)
- Caption sidebar: `tracking-wide uppercase`
- Login heading: `tracking-[-0.2px]`

---

## Layout

### Container páginas admin

```tsx
<div className="max-w-[1280px] mx-auto px-8 py-8">
```

### Sidebar

- Largura: `240px`
- Bg: `bg-white`
- Border-right: `border-slate-200`
- Header logo: `h-14 px-5 border-b border-slate-100`
- Section title: `px-5 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-medium`
- Item nav: `h-[32px] px-5 text-[13px] gap-2.5`
  - Ativo: `bg-tier/8 text-tier font-medium border-r-2 border-tier`
  - Inativo: `text-slate-600 hover:bg-slate-50`
- Ícone: `w-4 h-4 opacity-70`
- Avatar trigger (rodapé): `p-2 rounded-md hover:bg-slate-50`, avatar 32px

### Card

- Raio: `rounded-xl` (12px) — diferente de Tier Empresas que usa `rounded-md`
- Border: `border border-slate-200` (sem shadow extra)
- Padding interno: `p-5` (card médio) ou `p-6` (form)
- Hover (opcional): `hover:border-slate-300`

### Form/Inputs

| Estado | Estilo |
|---|---|
| Input default (light) | `h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:border-tier` |
| Input dark (login) | `h-[40px] px-3 rounded-[6px] text-[14px]` + box-shadow custom |
| Label | `text-[12px] text-slate-700` (light) / `text-[13px] text-slate-300` (dark) |
| Textarea | `px-3 py-2 text-[13px] border border-slate-300 rounded-md` |
| Select | `mt-1 w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md` |

### Botão

| Tipo | Estilo |
|---|---|
| Primário | `h-9 px-3 bg-tier hover:bg-tier-dark text-white text-[13px] rounded-md inline-flex items-center gap-1.5` |
| Primário pequeno | `h-8 px-3 text-[12px] bg-tier text-white rounded-md hover:bg-tier-dark` |
| Secundário | `h-8 px-3 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md` |
| Destrutivo | `text-rose-600 hover:bg-rose-50` |
| Ícone-only | `p-1.5 hover:bg-slate-50 text-slate-400 rounded` |

Ícones em botão: `w-3.5 h-3.5` (pequeno) ou `w-4 h-4` (médio).

### Tabela

- Header: `bg-slate-50 border-b border-slate-200 text-[12px] font-medium text-slate-600 px-4 py-2.5`
- Row: `border-b border-slate-100 px-4 py-2.5 text-[13px]`
- Hover row: `hover:bg-slate-50`
- Empty state: `px-4 py-6 text-center text-[13px] text-slate-400`

### Badges

- Global/info: `px-1.5 py-0.5 bg-tier/10 text-tier text-[11px] rounded uppercase tracking-wide`
- Status ativo: `text-emerald-700` com `● Ativo`
- Status inativo: `text-slate-400` com `○ Inativo`

---

## Componentes shared (`frontend/src/components/`)

| Arquivo | Função |
|---|---|
| `AdminLayout.tsx` | Layout sidebar + main, 3 sections (Plataforma/Configuração/Conta) |
| `Avatar.tsx` | Iniciais coloridas (hash do nome) |
| `UserMenu.tsx` | Popup completo (info user + Opções + Produtos + Sair) |
| ~~`ProductSwitcher.tsx`~~ | DEPRECADO — switcher mudou pra dentro do UserMenu (igual Tier Empresas) |

---

## Produtos no switcher (popup avatar)

| Produto | URL | Favicon (3 quadrados) |
|---|---|---|
| **tier agent** (atual) | `agent.tier.finance` | `#1a1a1a` / `#4a4a4a` / `#888` (mesmo Empresas) |
| **tier empresas** | `erp.tier.finance` | `#1a1a1a` / `#4a4a4a` / `#888` (gray) |
| **tier emissor** | `emissor.tier.finance` | mesmo gray |
| **tier pay** | `pay.tier.finance` | `#0a3520` / `#1f5e36` / `#d4f5dd` (green) |
| **tier invest** | `investimentos.tier.finance` | `#1e293b` / `#334e68` / `#38bdf8` (steel) |
| **tier personal** | `app.tier.finance` | `#06113C` / `#002967` / `#113FD6` (blue) |

Cada item: `h-auto px-2 py-2 rounded-md` + favicon 24px + nome `text-[15px]` Exotica + ícone external 12px (ou dot 6px se atual).

---

## Páginas (status)

| Página | Rota | Estado |
|---|---|---|
| Landing | `/` | ✅ Logo + hero + 3 features |
| Login | `/login` | ✅ Dark Stripe 480px + vídeo |
| Signup | `/signup` | ✅ Dark Stripe 480px + vídeo |
| Dashboard tenant | `/dashboard` | 🚧 Placeholder simples |
| Admin - Agentes | `/admin/agentes` | ✅ Grid + form criar (4 templates) |
| Admin - LLM Providers | `/admin/llm` | ✅ Tabela + form criar (7 providers suportados) |
| Admin - Feature Flags | `/admin/features` | ✅ Toggle list (12 flags conhecidas) |
| Admin - Conversas | `/admin/conversas` | 🚧 Placeholder |
| Admin - Canais | `/admin/canais` | 🚧 Placeholder |
| Admin - Knowledge | `/admin/knowledge` | 🚧 Placeholder |
| Admin - Parâmetros | `/admin/params` | 🚧 Placeholder |
| Admin - Métricas | `/admin/metricas` | 🚧 Placeholder |
| Admin - Cobrança | `/admin/cobranca` | 🚧 Placeholder |
| Admin - Equipe | `/admin/equipe` | 🚧 Placeholder |
| Admin - Perfil | `/admin/perfil` | 🚧 Placeholder |

---

## Regras hard pra próximas páginas

1. **H1 página = `text-[28px] font-medium text-slate-900 mb-1`** + subtitle `text-[13px] text-slate-500 mb-6`
2. **Card = `bg-white rounded-xl border border-slate-200 p-5`** (não `rounded-md`)
3. **Input = `h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:border-tier`**
4. **Botão primário = `h-9 px-3 bg-tier hover:bg-tier-dark text-white text-[13px] rounded-md`** com ícone `w-3.5 h-3.5`
5. **Empty state = `text-center text-[13px] text-slate-400 py-6`**
6. **Container página = `max-w-[1280px] mx-auto px-8 py-8`** (já vem do AdminLayout)
7. **NÃO usar fontes externas globais** (Inter, Geist, etc) — só system stack
8. **Logos PNG** em `frontend/public/`: `tier-agent-claro.png` (fundo escuro) + `tier-agent-escuro.png` (fundo claro)

---

## Gaps / pendências v1

- [ ] Adicionar fonte Exotica (`Exotica.otf` em `public/fonts/`) — hoje fallback pra system, switcher fica menos polido
- [ ] Dark mode toggle no admin (igual Tier Empresas)
- [ ] Páginas faltando (Conversas, Canais, Knowledge, Params, Métricas, Cobrança, Equipe, Perfil)
- [ ] Loading skeleton consistente (hoje só "Carregando..." texto)
- [ ] Modal pattern (criar/editar) — hoje form inline expandido
- [ ] Toast estilo Stripe (hoje react-hot-toast default)
- [ ] Confirm dialog estilo Stripe (hoje `confirm()` nativo)

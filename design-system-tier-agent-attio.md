# Tier Agent — Design System "Attio-grade" (teste de direção)

> Direção alternativa inspirada **100% em attio.com** (tokens extraídos ao vivo do site em 2026-05-28 via inspeção de computed styles).
> Não substitui `design-system-tier-agent.md` (direção atual Tier-blue). É um experimento paralelo.
> Skill usada: `skill-design` (fluxo de 6 etapas: diagnóstico → bifurcação → direção → section/component contracts → handoff).

---

## 1. Diagnóstico

- **Objetivo:** dar ao Tier Agent uma identidade de produto **premium, técnico e calmo** — nível Attio/Linear — que transmita "ferramenta séria de IA" sem virar dashboard genérico de SaaS-IA (gradiente roxo + glow).
- **Dois ativos distintos** (exigem bifurcação dupla):
  - **App** (`agent.tier.finance/admin/*`): canvas de playbooks, listas de agentes, métricas, conversas. Densidade alta, uso diário.
  - **Site** (`agent.tier.finance` landing): venda. Primeira impressão, conversão.
- **Temperatura da marca:** precisa/tecnológica + confiável/calma. Nada ousado-circo.
- **Bloqueio atual:** UI funcional mas sem assinatura visual; canvas de playbook genérico.

---

## 2. Bifurcação

| Ativo | Modo | Prioridades |
|---|---|---|
| App (canvas, painéis, listas) | **Product Interface** | Usabilidade > Consistência > Clareza > Eficiência > Estética |
| Site (landing, pricing) | **Marketing Narrative** | Clareza da proposta > Autoridade > Hierarquia > Conversão |

A Attio é o raro caso onde os dois modos compartilham o **mesmo sistema de tokens** (mesma fonte, mesmas cores neutras, mesmos raios) — só muda a densidade. Vamos replicar isso: **um sistema, duas densidades.**

---

## 3. Direção criativa

### Arquétipo
**Precision & Density** (app) fundido com **Premium SaaS Trust** (site). Ambos sob a estética Attio: quase-monocromático, near-white, tipografia apertada, bordas sutis, acento contido.

### Assinatura visual da Attio (o que copiar)
1. **Fundo near-white**, nunca branco puro estridente. Seções alternam `#FFFFFF` / `#FBFBFB` / `#F8F9FA`.
2. **CTA primário é quase-preto** (`#16191C`), NÃO azul. Azul é acento pontual, não botão principal. (Diferencia de 90% dos SaaS.)
3. **Tipografia InterDisplay** nos títulos com tracking negativo apertado (`-0.02em`) e peso 600 — dá o ar "engenharia precisa".
4. **Serif Tiempos** só em citações/depoimentos editoriais — contraste de autoridade.
5. **Bordas hairline** (`#EEEFF1`/`#E4E7EC`) + sombras quase invisíveis. O contraste vem do conteúdo, não de molduras pesadas.
6. **Padrão de pontos** (dotted grid) no fundo de heros e do canvas — assinatura geométrica.
7. **Ícones isométricos line-art** (3D leve, traço fino) — não ícones flat genéricos.
8. **Mega-menu branco** flutuante com labels de seção em cinza uppercase micro (11px, tracking +).

### Motion language
**Quiet / guided.** Fades 150–200ms, micro-deslocamentos de 4–8px, reveal na ordem de leitura. Zero parallax-circo. No canvas: feedback instantâneo (drag preciso, snap), sem inércia exagerada.

### Do / Don't
- ✅ Near-white, near-black CTA, hairline borders, InterDisplay apertada, acento único.
- ✅ Densidade alta organizada por tokens de spacing rígidos (4/8/12/16/24/32/48).
- ❌ Gradiente azul-roxo, glow, glass, dark-mode-default, ícones flat genéricos, sombras pesadas.
- ❌ Azul como cor de botão primário (azul é só acento/links/estado).

---

## 4. Tokens (extraídos da Attio + ponte Tier)

### 4.1 Tipografia
```
Display/Títulos : "InterDisplay", Inter, system-ui   (peso 600, tracking -0.02em)
UI/Body         : "Inter", system-ui                  (peso 400/500)
Editorial/Quote : "Tiempos Text", Georgia, serif      (peso 400/500, citações e depoimentos)
Mono (código/IDs): "Geist Mono", "JetBrains Mono", monospace
```

Escala (InterDisplay nos ≥20px, Inter no resto):
| Token | Size / LH / Tracking / Weight | Uso |
|---|---|---|
| display | 64 / 64 / -1.28px / 600 | Hero do site (desktop) |
| h1 | 40 / 44 / -0.8px / 600 | Título de página |
| h2 | 28 / 34 / -0.4px / 600 | Seção |
| h3 | 20 / 28 / -0.2px / 600 | Card / painel |
| body-lg | 16 / 24 / 0 / 400 | Parágrafo de venda |
| body | 14 / 20 / 0 / 400 | UI padrão |
| sm | 13 / 18 / 0 / 400 | Secundário |
| label | 11 / 16 / +0.4px / 600 **UPPERCASE** | Labels de seção (mega-menu, grupos) |

### 4.2 Cores — neutros (a espinha dorsal Attio)
```
--bg            #FFFFFF   página base
--bg-subtle     #FBFBFB   seção alternada / hover sutil
--bg-muted      #F8F9FA   painel / preenchimento de input
--bg-sunken     #F2F3F5   canvas / área rebaixada
--border-hair   #EEEFF1   divisor hairline
--border        #E4E7EC   borda padrão de card/input
--border-strong #D1D3D6   borda de ênfase / hover
--ink           #0D0F11   títulos (near-black)
--text          #1A1D21   corpo
--text-muted    #6A7385   secundário / nav
--text-faint    #9AA4B2   placeholder / disabled
```

### 4.3 Cores — ação e semântica
```
--cta            #16191C   botão primário (quase-preto Attio)
--cta-hover      #25282C
--accent         #003083   AZUL TIER — cor padrão única (links, foco, seleção, info, estado ativo)
--success        #00D17E   verde Attio (sucesso) — uso semântico pontual
--warning        #F5A300   âmbar (atenção) — uso semântico pontual
--danger         #E5484D   erro — uso semântico pontual
```

> **Decisão (user 2026-05-28):** o **azul `#003083` é a cor padrão única** de marca/acento. Adotamos a estrutura neutra da Attio (near-white + CTA near-black + bordas hairline) e o azul Tier como o único acento — links, foco, seleção, estado ativo e `info` todos usam `#003083`. Verde/âmbar/vermelho ficam **só** pra semântica pontual (sucesso/atenção/erro), nunca como cor decorativa. Nada de azul Attio `#266DF0`.

### 4.4 Spacing / Radius / Sombra
```
spacing : 2 4 6 8 12 16 20 24 32 40 48 64 80 96   (base 4)
radius  : sm 8 · md 10 (botões/inputs) · lg 12 (cards/painéis) · xl 16 (modais) · 2xl 20 (heros)
shadow  :
  --sh-hair  0 0 0 1px rgba(13,15,17,.06)
  --sh-sm    0 1px 2px rgba(13,15,17,.06), 0 0 0 1px rgba(13,15,17,.04)
  --sh-md    0 4px 12px -2px rgba(13,15,17,.10), 0 0 0 1px rgba(13,15,17,.05)
  --sh-pop   0 12px 32px -8px rgba(13,15,17,.18)   (mega-menu, dropdown, modal)
```

### 4.5 Padrões visuais / motifs (as assinaturas da Attio)

Estes 4 padrões são o que faz "parecer Attio" mais do que cor ou fonte. São obrigatórios.

#### (a) Dotted grid — fundo pontilhado
```css
.bg-dots{ background-image:radial-gradient(circle,#D1D3D6 1px,transparent 1px);
          background-size:16px 16px; }   /* hero do site:24px · canvas:16px */
```
Fundo de hero, do canvas e de áreas de demo. Opacidade ~.5.

#### (b) Blueprint grid — "as divisões da tela" ⭐
O que dá o ar de **papel de engenharia / spec sheet**. A seção é uma moldura desenhada com hairlines:
- **Moldura externa**: a faixa de conteúdo tem `border:1px solid var(--border-hair)` em cima/baixo (e às vezes lados).
- **Réguas verticais**: a área divide em 2–3 colunas separadas por `border-left:1px solid #EEEFF1` (ex: `narrativa | demo | lista de apoio`).
- **Tiras de margem hachuradas**: nas bordas esquerda/direita extremas, faixa fina com hachura diagonal 45° (cara de "margem de blueprint"):
```css
.hatch{ background-image:repeating-linear-gradient(45deg,
        #EEEFF1 0 1px, transparent 1px 7px); }   /* tira ~32–64px nas laterais */
```
- **Cruzamentos**: onde réguas se cruzam, a Attio às vezes marca um "+" fininho (4px) em `#D1D3D6`.
- Regra: as divisões são **estruturais e calmas** — hairline, nunca linha grossa/escura. O conteúdo respira dentro da grade.

Layout-tipo de uma dobra do site:
```
┌─[hairline top]──────────────────────────────────────────┐
│▒│  narrativa     │   demo / canvas      │  lista apoio  │▒│
│▒│  (texto+CTA)   │   (dotted bg)        │  (fade mask)  │▒│
└─[hairline bottom]───────────────────────────────────────┘
 ▒ = tira hachurada      │ = régua vertical hairline
```

#### (c) Formas geométricas isométricas ⭐
Cubos/blocos **line-art** (só traço, sem preenchimento) em projeção axonométrica — âncoras decorativas no canto das dobras. Significam "blocos / modularidade".
- Traço `1px #D1D3D6`, sem fill (ou fill `#FFFFFF`). Tamanho ~120–200px.
- Variações: cubo simples, cubos empilhados/explodidos, cubo com entalhe.
- Uso: 1 por dobra no máximo, canto inferior-direito. Nunca colorido, nunca com sombra.
- Implementar como **SVG** (stroke), não imagem rasterizada.

#### (d) List com fade-mask
Listas de apoio (ex: templates de agente) com **degradê de máscara** topo e base — itens "somem" nas pontas:
```css
.fade-list{ -webkit-mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent); }
```
Item da lista: ícone micro + label, hover/selecionado ganha `border #E4E7EC + bg #FFFFFF + sh-sm`; demais ficam `text-faint`.

---

## 5. Site (Marketing Narrative) — Section Contracts / Dobras

A Attio organiza a home em dobras claras. Mapeamento pro Tier Agent:

| # | Dobra | Função narrativa | Hierarquia (1→3) | Densidade |
|---|---|---|---|---|
| 1 | **Top nav** | orientar + 2 CTAs ("Entrar" outline / "Começar" dark) + mega-menu | logo → menu → CTA | baixa |
| 2 | **Hero** | proposta em 3s + screenshot do produto no contexto. Fundo dotted. | headline display → sub → CTA → mockup do canvas | baixa |
| 3 | **Logos de prova** | "quem confia" — logos cinza em linha | linha de logos | baixa |
| 4 | **Pilares (bento)** | 3–4 capacidades-chave (Agentes IA / Playbooks visuais / Multicanal / RAG) em bento grid | título → cards com mockup | média |
| 5 | **Deep-dive Playbooks** | mostrar o canvas (o "Workflows" da Attio) em ação | screenshot grande + 3 bullets | média |
| 6 | **Métricas/ROI** | número grande + contexto (ex: "-70% tempo de atendimento") | número display → label | baixa |
| 7 | **Depoimento** | autoridade — citação em **serif Tiempos** + foto + cargo | quote serif → pessoa | baixa |
| 8 | **Pricing** | 3 SKUs (Lite/Pro/Business), card do meio destacado | cards → CTA | média |
| 9 | **CTA final** | conversão — fundo dark `#16191C`, headline branca + CTA | headline → CTA | baixa |
| 10 | **Footer** | navegação + legal, denso, cinza | colunas de links | alta |

**Mobile:** bento colapsa pra 1 coluna; mega-menu vira acordeão; hero mockup vira screenshot único; pricing vira carrossel/stack.

---

## 6. App (Product Interface) — Layout + Component Contracts

### 6.1 Estrutura
```
┌──────────────────────────────────────────────────────────┐
│ Topbar 52px · logo "tier agent" · busca ⌘K · avatar       │
├────────────┬─────────────────────────────────────────────┤
│ Sidebar    │  Content area (bg #FFFFFF)                    │
│ 240px      │  ┌─ Page header: h1 + ações ────────────┐    │
│ bg #FBFBFB │  │  cards / tabela / canvas             │    │
│ itens 13px │  └──────────────────────────────────────┘    │
└────────────┴─────────────────────────────────────────────┘
```
- Sidebar: `#FBFBFB`, item ativo `bg #FFFFFF + sh-hair + texto #0D0F11`, inativo `#6A7385`. Ícone 16px line.
- Topbar: hairline embaixo, busca estilo Attio (input `#F8F9FA` + ⌘K).

### 6.2 Componentes-chave (contratos resumidos)

**Button**
- Variantes: `primary` (bg `#16191C`, texto branco), `secondary` (bg branco + border `#E4E7EC` + texto `#1A1D21`), `ghost` (transparente, hover `#F8F9FA`), `accent` (bg `--accent`).
- Estados: hover (escurece 6%), focus (`ring 2px --accent @ 30%`), disabled (`opacity .5`).
- Tokens: radius `md(10)`, padding `0 12px`, h `32px`, `14px/500`.

**Panel / Card**
- bg `#FFFFFF`, border `#E4E7EC`, radius `lg(12)`, shadow `sh-sm`. Header opcional com label uppercase.
- Restrição: nunca empilhar sombra pesada; profundidade vem do hairline.

**Input / Select**
- bg `#F8F9FA`, border `#E4E7EC`, radius `md(10)`, h `34px`, focus `border --accent + ring`.

**Table** (listas de agentes/conversas)
- Header: `label` uppercase `#6A7385`, linha hairline. Row hover `#FBFBFB`. Densidade alta, zebra OFF (hairline only).

**Mega-menu / Dropdown**
- bg `#FFFFFF`, radius `xl(16)`, `sh-pop`, grupos com `label` uppercase + itens ícone+título+descrição (igual Attio Platform/Resources dos exemplos).

### 6.3 Canvas de Playbooks — o "Workflows da Attio" (núcleo)

Referência direta: o **Workflows da Attio** (nós suaves em canvas pontilhado, conectores finos, nó de trigger distinto).

**Canvas**
- Fundo `#F2F3F5` (sunken) + dotted grid 16px `#D1D3D6 @ .5`.
- MiniMap discreto (já existe), opacidade 50% idle.

**Node (contrato)**
- Anatomia: `[faixa de categoria 3px] + ícone 16px + título 14/600 + subtítulo 12 #6A7385 + handles`.
- bg `#FFFFFF`, border `#E4E7EC`, radius `lg(12)`, shadow `sh-sm`; selecionado → `border --accent + ring 2px --accent@30 + sh-md`.
- Largura fixa ~240px, padding 12px. Hover eleva pra `sh-md`.
- **Cores por categoria** (faixa lateral + ícone):
  - Trigger → roxo `#7C5CFC`
  - Ação/LLM → azul acento `--accent`
  - Integração → verde `#00D17E`
  - Lógica/branch → âmbar `#F5A300`
  - Humano/handoff → `#16191C`
- Estados: default / hover / selected / running (pulse verde no ring) / error (ring `#E5484D`).

**Connector (edge)**
- Linha `1.5px #C0C6CF`, curva suave (bezier ortogonal — sai por baixo, vira em 90° arredondado, igual Attio), seta fina.
- Hover → `#6A7385` + botão "+" pra inserir nó no meio (padrão Attio/n8n).

**Trigger node** (distinto)
- Tab pequena ACIMA do nó: `⊙ Trigger` (label uppercase micro). Cápsula com ícone relógio/raio, label "Quando…".

#### Flow effects — execução visível (⭐ "os fluxos com efeitos")
O que faz o canvas da Attio parecer vivo. Estados de execução desenhados no próprio canvas:

- **Caminho ativo = VERDE.** Quando um nó executou, a borda do nó e o conector que sai dele ficam **verdes** (`#00D17E`), com leve glow `0 0 0 3px rgba(0,209,126,.15)`. O caminho percorrido vira uma "trilha verde".
- **Pills de status** flutuando no canto sup-dir do nó:
  - `✓ Triggered` / `✓ Completed` → bg `#E6F9F0`, texto `#0A8F5A`, check 12px, radius full, 11px/600.
  - `Running` → bg `#FFF7E6`, texto `#B26A00`, ponto pulsante âmbar.
  - `Error` → bg `#FDECEC`, texto `#C0353A`.
- **Branch ativo vs inativo:** no Switch/Condition, o ramo escolhido (ex: "Upsell") fica colorido/nítido; o ramo não-tomado (ex: "Nurture") fica **esmaecido** (`opacity .45`, nós e linha em cinza). Comunica a decisão sem texto.
- **Labels de branch no conector:** pílula branca com borda (`bg #FFF · border #E4E7EC · 11px`) sobre a linha — "Upsell", "Nurture", "Sim/Não".
- **Tag de objeto no nó:** à direita do título, pílula cinza com o recurso operado (ex: `Deals`, `Sequences`) → bg `#F2F3F5`, texto `#6A7385`, 11px.
- **Insert "+":** círculo `--accent` (28px) com "+" branco no fim do caminho e no meio de conectores em hover → abre a palette de nós.
- **Animação de execução (test-run):** dash-flow percorrendo o conector ativo (`stroke-dasharray` animado) + os pills aparecem em sequência (Triggered → Completed) com fade 150ms. Quiet, sem exagero.

**Node palette / config**
- Painel lateral direito (`Panel`), abre ao selecionar nó. Form denso com `Input`/`Select`/`label` uppercase por grupo.

**Fluxo de interação (precisão é tudo — pedido do user):**
- Drag: snap a grid 8px, sem inércia. Cursor `grabbing`.
- Clique em nó: seleção instantânea (sem delay), abre config à direita.
- Drag de conector: hint de drop nos handles compatíveis (realce verde).
- Insert no meio do edge: hover no connector → "+" → menu de nós.

---

## 7. Handoff — Tailwind config (cole no `tailwind.config.js` do tier-agent/frontend)

```js
theme: {
  extend: {
    colors: {
      bg:        { DEFAULT:'#FFFFFF', subtle:'#FBFBFB', muted:'#F8F9FA', sunken:'#F2F3F5' },
      hair:      '#EEEFF1',
      border:    { DEFAULT:'#E4E7EC', strong:'#D1D3D6' },
      ink:       '#0D0F11',
      text:      { DEFAULT:'#1A1D21', muted:'#6A7385', faint:'#9AA4B2' },
      cta:       { DEFAULT:'#16191C', hover:'#25282C' },
      accent:    { DEFAULT:'#003083', hover:'#002266' }, // azul Tier = cor padrao unica
      success:   '#00D17E',
      warning:   '#F5A300',
      danger:    '#E5484D',
      node: { trigger:'#7C5CFC', action:'#003083', integration:'#00D17E', logic:'#F5A300', human:'#16191C' },
    },
    fontFamily: {
      display: ['InterDisplay','Inter','system-ui','sans-serif'],
      sans:    ['Inter','system-ui','sans-serif'],
      serif:   ['"Tiempos Text"','Georgia','serif'],
      mono:    ['"Geist Mono"','"JetBrains Mono"','monospace'],
    },
    letterSpacing: { display:'-0.02em', tight:'-0.01em' },
    borderRadius: { sm:'8px', md:'10px', lg:'12px', xl:'16px', '2xl':'20px' },
    boxShadow: {
      hair:'0 0 0 1px rgba(13,15,17,.06)',
      sm:'0 1px 2px rgba(13,15,17,.06), 0 0 0 1px rgba(13,15,17,.04)',
      md:'0 4px 12px -2px rgba(13,15,17,.10), 0 0 0 1px rgba(13,15,17,.05)',
      pop:'0 12px 32px -8px rgba(13,15,17,.18)',
    },
  },
}
```
Utilities dos motifs (cole no CSS global):
```css
/* (a) dotted grid */
.bg-dots{ background-image:radial-gradient(circle,#D1D3D6 1px,transparent 1px); background-size:16px 16px; }
/* (b) blueprint: margem hachurada + régua vertical */
.hatch{ background-image:repeating-linear-gradient(45deg,#EEEFF1 0 1px,transparent 1px 7px); }
.rule-x{ border-left:1px solid #EEEFF1; }
.frame-y{ border-top:1px solid #EEEFF1; border-bottom:1px solid #EEEFF1; }
/* (d) fade mask em listas de apoio */
.fade-list{ -webkit-mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent);
            mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent); }
```
Status pills do canvas (tokens): `flow.triggered #E6F9F0/#0A8F5A` · `flow.running #FFF7E6/#B26A00` · `flow.error #FDECEC/#C0353A`. Branch inativo: `opacity:.45`. Caminho ativo: borda+edge `#00D17E` + glow `0 0 0 3px rgba(0,209,126,.15)`.

Fontes: InterDisplay + Inter via `@fontsource` ou self-host; Tiempos é comercial (alternativa free próxima: **Newsreader** ou **Source Serif 4** se não licenciar Tiempos).

---

## 8. Decisões registradas
- 2026-05-28 — Tokens extraídos ao vivo de attio.com (computed styles): Inter/InterDisplay/Tiempos, CTA near-black `#16191C`, acento `#266DF0`, verde `#00D17E`, radius 10–12, bordas hairline `#EEEFF1`/`#E4E7EC`.
- 2026-05-28 — **Cor padrão única = azul Tier `#003083`** (decisão user). Estrutura neutra Attio + azul Tier como único acento. Azul Attio `#266DF0` descartado. Verde/âmbar/vermelho só semânticos.
- 2026-05-28 — Patterns capturados (pedido user): (b) blueprint grid = réguas hairline verticais + tiras hachuradas 45° nas margens + moldura hairline; (c) formas isométricas line-art (cubos SVG stroke) como âncora de canto; flow effects = caminho ativo verde `#00D17E` + pills Triggered/Completed/Running/Error + branch inativo esmaecido + labels de branch + insert "+" acento.
- 2026-05-28 — Este doc é experimento paralelo; direção oficial atual continua em `design-system-tier-agent.md` até decisão do user.

## 9. Próximos passos (quando aprovar)
1. Aplicar tokens no `tailwind.config.js` + carregar fontes.
2. Refazer `PlaybookCanvas` nodes/edges no padrão da §6.3.
3. Refazer sidebar/topbar do app (§6.1).
4. Construir a landing seguindo as dobras da §5.

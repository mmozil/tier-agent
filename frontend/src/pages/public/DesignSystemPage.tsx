/**
 * Playground visual do Design System do Tier Agent.
 * Rota pública: /design-system (sem autenticação).
 * Equivalente ao /lab/animate-ui do tier-finance, mas para o admin DS (Firecrawl × Tier).
 *
 * Organizado em seções via sidebar sticky:
 *   Tokens → Botões → Layout → Componentes → Efeitos
 */
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Info,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Button,
  CurvyRect,
  EmptyHint,
  FC,
  HairCells,
  iconBtn,
  PageFrame,
  PageHero,
  PageHeroRidge,
  PRIMARY_SHADOW,
  Row,
  ScrambleText,
  SectionHeader,
  SegToggle,
  Select,
  SKEL,
  SkeletonBar,
} from "../../components/ds/fc";

/* ─── helpers de exibição ─── */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className={`rounded-md px-1.5 py-0.5 text-[11px] font-mono ${FC.ink} bg-black/[0.05] dark:bg-white/[0.07]`}>
      {children}
    </code>
  );
}

function Label({ children }: { children: string }) {
  return (
    <p className={`mb-3 text-[11px] font-semibold uppercase tracking-wider ${FC.mut}`}>{children}</p>
  );
}

function SectionAnchor({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div className={`border-b ${FC.hair} px-6 pt-8 pb-5`}>
      <h2 className={`text-[18px] font-[450] tracking-[-0.1px] ${FC.ink}`}>{title}</h2>
      {subtitle && <p className={`mt-1 text-[13px] ${FC.sub}`}>{subtitle}</p>}
      {/* âncora invisível com offset para não ficar sob o header */}
      <div id={id} className="absolute" style={{ marginTop: -80 }} />
    </div>
  );
}

/* ─── seções da sidebar ─── */
const NAV = [
  { id: "tokens", label: "Tokens" },
  { id: "botoes", label: "Botões" },
  { id: "layout", label: "Layout" },
  { id: "componentes", label: "Componentes" },
  { id: "efeitos", label: "Efeitos" },
];

/* ─── dados das seções ─── */
const COLOR_TOKENS = [
  { token: "FC.ink", cls: "text-[#262626]", bg: "#262626", dark: "#e6e8eb", label: "ink — texto principal" },
  { token: "FC.sub", cls: "text-[#262626]/[0.56]", bg: "rgba(38,38,38,0.56)", dark: "#8b93a0", label: "sub — subtítulos" },
  { token: "FC.dim", cls: "text-[#262626]/[0.72]", bg: "rgba(38,38,38,0.72)", dark: "#9aa1ab", label: "dim — sidebar idle" },
  { token: "FC.mut", cls: "text-[#262626]/40", bg: "rgba(38,38,38,0.40)", dark: "#6b7280", label: "mut — micro-labels" },
  { token: "FC.hair", cls: "border-[#EDEDED]", bg: "#EDEDED", dark: "#23272e", label: "hair — bordas" },
  { token: "FC.hover", cls: "hover:bg-black/[0.04]", bg: "rgba(0,0,0,0.04)", dark: "rgba(255,255,255,0.04)", label: "hover — superfície" },
  { token: "FC.base", cls: "bg-[#F9F9F9]", bg: "#F9F9F9", dark: "#0c0e12", label: "base — fundo" },
];

const SEMANTIC_COLORS = [
  { label: "Tier (ação/ativo)", light: "#003083", dark: "#5b9bff" },
  { label: "Positivo / sucesso", light: "#0a8f5a", dark: "#34d399" },
  { label: "Atenção / pending", light: "#F5A300", dark: "#fbbf24" },
  { label: "Negativo / erro", light: "#E5484D", dark: "#ff6b5e" },
];

const TYPE_SCALE = [
  { label: "label-x-large — título de página", cls: "text-[20px] font-[450] tracking-[-0.1px]", sample: "Visão Geral" },
  { label: "label-large — título de seção", cls: "text-[16px] font-[450]", sample: "Conversas recentes" },
  { label: "body-medium — body padrão", cls: "text-[14px] font-normal", sample: "Agentes processando conversas em tempo real." },
  { label: "body-small — sidebar / desc", cls: "text-[13px] font-normal", sample: "Configure os canais de atendimento" },
  { label: "micro-label — KPI caption", cls: "text-[11px] font-semibold uppercase tracking-wider", sample: "CONVERSAS HOJE" },
];

export default function DesignSystemPage() {
  const [dark, setDark] = useState(false);
  const [segPeriod, setSegPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const [selectVal, setSelectVal] = useState<string | null>(null);

  return (
    <div className={dark ? "dark" : ""}>
      <div className={`min-h-screen flex flex-col ${FC.base}`}>

        {/* ── topbar ── */}
        <header className={`sticky top-0 z-40 h-[52px] border-b ${FC.hair} ${FC.base} flex items-center justify-between gap-4 px-6`}>
          <div className="flex items-center gap-3">
            <Link to="/" className={`flex items-center gap-2 text-[13px] font-medium ${FC.ink} opacity-60 hover:opacity-100 transition-opacity`}>
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              Tier Agent
            </Link>
            <span className={`text-[13px] ${FC.hair} select-none`}>/</span>
            <span className={`text-[13px] font-medium ${FC.ink}`}>Design System</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-mono ${FC.mut}`}>Firecrawl × Tier</span>
            <button
              onClick={() => setDark((d) => !d)}
              className={`${iconBtn} ml-1`}
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <div className="flex flex-1">
          {/* ── sidebar nav ── */}
          <aside className={`w-[200px] shrink-0 border-r ${FC.hair} sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto py-5 px-3`}>
            <p className={`px-3 mb-3 text-[10px] font-semibold uppercase tracking-widest ${FC.mut}`}>Seções</p>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className={`h-[32px] px-3 rounded-[8px] flex items-center text-[13px] ${FC.dim} ${FC.hover} hover:text-[#262626] dark:hover:text-white transition-all`}
                >
                  {n.label}
                </a>
              ))}
            </nav>

            <div className={`my-5 h-px ${FC.hairBg}`} />

            <p className={`px-3 mb-3 text-[10px] font-semibold uppercase tracking-widest ${FC.mut}`}>Links</p>
            <a
              href="/admin"
              className={`h-[32px] px-3 rounded-[8px] flex items-center gap-1.5 text-[13px] ${FC.dim} ${FC.hover} hover:text-[#262626] dark:hover:text-white transition-all`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Ir para admin
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className={`h-[32px] px-3 rounded-[8px] flex items-center gap-1.5 text-[13px] ${FC.dim} ${FC.hover} hover:text-[#262626] dark:hover:text-white transition-all`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              fc.tsx
            </a>
          </aside>

          {/* ── conteúdo ── */}
          <main className="flex-1 min-w-0 pb-20">

            {/* ═══ TOKENS ═══ */}
            <div className="relative" id="tokens">
              <SectionAnchor id="tokens-anchor" title="Tokens" subtitle="Valores extraídos do Firecrawl real. Um único #262626 com opacidades + hairline #EDEDED." />

              <div className="p-6 space-y-8">
                {/* Paleta de cor */}
                <div>
                  <Label>Paleta FC (object FC)</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {COLOR_TOKENS.map((t) => (
                      <div key={t.token} className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                        <div
                          className="h-10 w-full"
                          style={{ background: t.bg, border: t.token === "FC.hair" ? `2px solid ${t.bg}` : undefined }}
                        />
                        <div className={`px-3 py-2 border-t ${FC.hair}`}>
                          <Code>{t.token}</Code>
                          <p className={`mt-1 text-[11px] ${FC.sub}`}>{t.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cores semânticas */}
                <div>
                  <Label>Cores semânticas (cor = função)</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SEMANTIC_COLORS.map((c) => (
                      <div key={c.label} className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                        <div className="h-10 w-full" style={{ background: c.light }} />
                        <div className={`px-3 py-2 border-t ${FC.hair}`}>
                          <p className={`text-[11px] ${FC.ink}`}>{c.light}</p>
                          <p className={`text-[11px] ${FC.sub}`}>{c.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tipografia */}
                <div>
                  <Label>Escala tipográfica</Label>
                  <div className={`rounded-[10px] border ${FC.hair} overflow-hidden divide-y divide-[#EDEDED] dark:divide-[#23272e]`}>
                    {TYPE_SCALE.map((t) => (
                      <div key={t.label} className="flex items-center gap-4 px-5 py-4">
                        <div className="w-[220px] shrink-0">
                          <p className={`text-[11px] ${FC.mut}`}>{t.label}</p>
                          <Code>{t.cls}</Code>
                        </div>
                        <p className={`${t.cls} ${FC.ink} truncate`}>{t.sample}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PRIMARY_SHADOW */}
                <div>
                  <Label>PRIMARY_SHADOW — acabamento Firecrawl</Label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={`h-8 px-4 rounded-[10px] text-[14px] font-medium text-white bg-[#003083] hover:bg-[#002a73] transition-all active:scale-[0.98] ${PRIMARY_SHADOW}`}
                    >
                      Botão primário
                    </button>
                    <button
                      className={`h-8 px-4 rounded-[10px] text-[14px] font-medium text-white bg-[#003083] hover:bg-[#002a73] transition-all active:scale-[0.98]`}
                    >
                      Sem sombra (referência)
                    </button>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>Micro-sombras empilhadas + inset glow na base — profundidade sem peso.</p>
                </div>
              </div>
            </div>

            <div className={`h-px ${FC.hairBg}`} />

            {/* ═══ BOTÕES ═══ */}
            <div className="relative" id="botoes">
              <SectionAnchor id="botoes-anchor" title="Botões" subtitle="Componente Button + classes iconBtn e btnPrimary. Todos h-8 · rounded-10 · active:scale-[0.98]." />

              <div className="p-6 space-y-8">
                {/* Variantes */}
                <div>
                  <Label>Variantes — componente Button</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary">
                      <Zap className="w-3.5 h-3.5" /> Primary
                    </Button>
                    <Button variant="secondary">
                      <Settings className="w-3.5 h-3.5" /> Secondary
                    </Button>
                    <Button variant="ghost">
                      <Copy className="w-3.5 h-3.5" /> Ghost
                    </Button>
                    <Button variant="danger">
                      <Trash2 className="w-3.5 h-3.5" /> Danger
                    </Button>
                  </div>
                  <div className={`mt-4 rounded-[10px] border ${FC.hair} divide-y divide-[#EDEDED] dark:divide-[#23272e]`}>
                    {[
                      { v: "primary", when: "CTA principal, confirmar ação", cls: `bg-[#003083] text-white + PRIMARY_SHADOW` },
                      { v: "secondary", when: "Ações secundárias (filtrar, exportar)", cls: `border FC.hair FC.hover` },
                      { v: "ghost", when: "Ações terciárias, toolbars", cls: `FC.sub FC.hover` },
                      { v: "danger", when: "Deletar, revogar, ações destrutivas", cls: `text-[#c0362c] hover:bg-red/[0.06]` },
                    ].map((r) => (
                      <div key={r.v} className="grid grid-cols-3 gap-4 px-4 py-3 text-[13px]">
                        <Code>{`variant="${r.v}"`}</Code>
                        <span className={FC.sub}>{r.when}</span>
                        <Code>{r.cls}</Code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tamanhos */}
                <div>
                  <Label>Tamanhos (size prop)</Label>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <Button variant="secondary" size="sm">Small sm</Button>
                      <Code>px-2</Code>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <Button variant="secondary" size="md">Default md</Button>
                      <Code>px-2.5</Code>
                    </div>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>Altura sempre h-8 (32px). Só o padding-x muda. Fonte sempre 14px/medium.</p>
                </div>

                {/* iconBtn */}
                <div>
                  <Label>iconBtn — botão-ícone quadrado</Label>
                  <div className="flex items-center gap-2">
                    {[Copy, Settings, Trash2, Plus, ArrowUpRight].map((Icon, i) => (
                      <button key={i} className={iconBtn}>
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    <Code>w-8 h-8 rounded-[10px]</Code> — mesma altura dos botões de texto. Cor <Code>FC.dim</Code>, hover → ink.
                  </p>
                </div>

                {/* ScrambleText */}
                <div>
                  <Label>ScrambleText — efeito decode (botão primário)</Label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={`h-8 px-3 rounded-[10px] text-[14px] font-medium text-white bg-[#003083] hover:bg-[#002a73] transition-all active:scale-[0.98] inline-flex items-center gap-1.5 ${PRIMARY_SHADOW}`}
                      onClick={(e) => {
                        const target = e.currentTarget;
                        target.dataset.key = String(Date.now());
                      }}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <ScrambleText text="Iniciar agente" />
                    </button>
                    <Button variant="primary" scramble>
                      <Zap className="w-3.5 h-3.5" />
                      Scramble via prop
                    </Button>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Ativo por padrão em <Code>variant="primary"</Code>. Desativar: <Code>scramble={"{false}"}</Code>.
                  </p>
                </div>

                {/* Disabled */}
                <div>
                  <Label>Estado disabled</Label>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="primary" disabled>Primary</Button>
                    <Button variant="secondary" disabled>Secondary</Button>
                    <Button variant="ghost" disabled>Ghost</Button>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    <Code>disabled:opacity-50 disabled:pointer-events-none</Code> — sem interação, mantém forma.
                  </p>
                </div>
              </div>
            </div>

            <div className={`h-px ${FC.hairBg}`} />

            {/* ═══ LAYOUT ═══ */}
            <div className="relative" id="layout">
              <SectionAnchor id="layout-anchor" title="Layout" subtitle="Primitivos de estrutura de página: PageFrame, Row, HairCells, SectionHeader." />

              <div className="p-6 space-y-8">
                {/* Row demo */}
                <div>
                  <Label>Row — seção com linhas full-width</Label>
                  <div className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                    <PageFrame>
                      <Row>
                        <div className="p-5">
                          <p className={`text-[14px] ${FC.ink}`}>Row padrão — conteúdo contido nos rails.</p>
                          <p className={`text-[12px] mt-1 ${FC.sub}`}>Linha horizontal full-width. Content dentro de <Code>border-l/r</Code>.</p>
                        </div>
                      </Row>
                      <Row last>
                        <div className="p-5">
                          <p className={`text-[14px] ${FC.ink}`}>Row last — fecha o frame com linha inferior.</p>
                        </div>
                      </Row>
                    </PageFrame>
                  </div>
                  <div className={`mt-3 rounded-[10px] border ${FC.hair} p-4`}>
                    <p className={`text-[11px] font-mono ${FC.sub} whitespace-pre-wrap`}>{`<PageFrame>
  <Row>{/* ...conteúdo */}</Row>
  <Row>{/* ...seção */}</Row>
  <Row last>{/* última linha fecha o frame */}</Row>
</PageFrame>`}</p>
                  </div>
                </div>

                {/* HairCells */}
                <div>
                  <Label>HairCells — grade flush (KPIs, cards)</Label>
                  <div className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                    <HairCells cols={4}>
                      {(["Conversas hoje", "Agentes ativos", "Tempo médio", "Satisfação"] as const).map((label, i) => (
                        <div key={label} className="p-5">
                          <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${FC.mut}`}>{label}</p>
                          <p className={`text-[22px] font-mono tabular-nums font-medium ${FC.ink}`}>{["1.247", "8", "4m 32s", "98%"][i]}</p>
                          <p className={`text-[12px] mt-0.5 ${FC.sub}`}>+{[12, 2, -8, 0.4][i]}% vs ontem</p>
                        </div>
                      ))}
                    </HairCells>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    <Code>{"cols={2|3|4|5}"}</Code> — bordas internas se cruzam nas interseções → "+".
                    <Code>gridLines</Code> adiciona <Code>border-b</Code> para grids multi-linha.
                  </p>
                </div>

                {/* SectionHeader */}
                <div>
                  <Label>SectionHeader — título + subtítulo + ações</Label>
                  <div className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                    <SectionHeader
                      title="Conversas recentes"
                      subtitle="Últimas 24 horas — 1.247 conversas processadas."
                      right={
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm">Exportar</Button>
                          <Button variant="primary" size="sm">
                            <Plus className="w-3.5 h-3.5" /> Nova
                          </Button>
                        </div>
                      }
                    />
                    <div className={`p-5 ${FC.sub} text-[13px]`}>Conteúdo da seção aqui.</div>
                  </div>
                </div>

                {/* CurvyRect */}
                <div>
                  <Label>CurvyRect — corner brackets (junções)</Label>
                  <div className={`relative rounded-[0px] border ${FC.hair} overflow-hidden`} style={{ height: 80 }}>
                    <CurvyRect />
                    <div className="flex h-full items-center justify-center">
                      <p className={`text-[13px] ${FC.sub}`}>4 brackets SVG 11×11 nos cantos — formam "+" com as linhas.</p>
                    </div>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    <Code>{"position: absolute inset-0 z-10"}</Code> — não ocupa grid. Auto-aplicado por <Code>Row</Code> (desativar: <Code>{"curvy={false}"}</Code>).
                  </p>
                </div>
              </div>
            </div>

            <div className={`h-px ${FC.hairBg}`} />

            {/* ═══ COMPONENTES ═══ */}
            <div className="relative" id="componentes">
              <SectionAnchor id="componentes-anchor" title="Componentes" subtitle="SegToggle, Select, EmptyHint, Skeleton." />

              <div className="p-6 space-y-8">
                {/* SegToggle */}
                <div>
                  <Label>SegToggle — período / opções exclusivas</Label>
                  <SegToggle
                    value={segPeriod}
                    options={[
                      { value: "7d", label: "7d" },
                      { value: "30d", label: "30d" },
                      { value: "90d", label: "90d" },
                    ]}
                    onChange={(v) => setSegPeriod(v as "7d" | "30d" | "90d")}
                  />
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Ativo: fundo azul + sombra sutil. Inativo: ghost. Todos <Code>h-8 px-3</Code>.
                  </p>
                </div>

                {/* Select */}
                <div>
                  <Label>Select — dropdown customizado</Label>
                  <div className="max-w-[220px]">
                    <Select
                      value={selectVal}
                      placeholder="Selecionar agente…"
                      options={[
                        { value: "maria", label: "Maria Luiza", icon: <Bot className="w-3.5 h-3.5 shrink-0" /> },
                        { value: "joao", label: "João Atendimento", icon: <Bot className="w-3.5 h-3.5 shrink-0" /> },
                        { value: "suporte", label: "Suporte Técnico", icon: <Bot className="w-3.5 h-3.5 shrink-0" /> },
                      ]}
                      onChange={setSelectVal}
                    />
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Trigger <Code>h-8</Code>. Painel flutuante z-50 com hover/check. Fecha em clique-fora / Esc.
                  </p>
                </div>

                {/* EmptyHint */}
                <div>
                  <Label>EmptyHint — estado vazio (ensina próxima ação)</Label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className={`rounded-[10px] border ${FC.hair}`}>
                      <EmptyHint
                        icon={MessageSquare}
                        text="Nenhuma conversa ainda. Conecte um canal para começar."
                        ctaLabel="Conectar canal"
                        ctaTo="/admin/canais"
                      />
                    </div>
                    <div className={`rounded-[10px] border ${FC.hair}`}>
                      <EmptyHint
                        icon={Bot}
                        text="Nenhum agente configurado."
                        ctaLabel="Criar agente"
                        ctaTo="/admin/agentes"
                      />
                    </div>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Ícone <Code>w-5 h-5 FC.mut</Code> + texto <Code>FC.sub 13px</Code> + link-CTA sublinhado azul.
                  </p>
                </div>

                {/* Skeleton */}
                <div>
                  <Label>Skeleton — carregamento (SKEL + SkeletonBar)</Label>
                  <div className={`rounded-[10px] border ${FC.hair} p-5 flex flex-col gap-3`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full ${SKEL}`} />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <SkeletonBar className="h-3 w-32" />
                        <SkeletonBar className="h-2.5 w-20" />
                      </div>
                    </div>
                    <SkeletonBar className="h-3 w-full" />
                    <SkeletonBar className="h-3 w-4/5" />
                    <SkeletonBar className="h-3 w-2/3" />
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    <Code>SKEL</Code> = classe base (<Code>animate-pulse</Code> + <Code>motion-reduce:animate-none</Code>).
                    <Code>SkeletonBar</Code> = wrapper com <Code>{"className"}</Code> para dimensionar.
                  </p>
                </div>

                {/* Badges / status */}
                <div>
                  <Label>Badges de status</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Ativo", bg: "bg-[#0a8f5a]/[0.08]", text: "text-[#0a8f5a]", dot: "bg-[#0a8f5a]" },
                      { label: "Pendente", bg: "bg-[#F5A300]/[0.10]", text: "text-[#C47F00]", dot: "bg-[#F5A300]" },
                      { label: "Erro", bg: "bg-[#E5484D]/[0.08]", text: "text-[#c0362c]", dot: "bg-[#E5484D]" },
                      { label: "Desativado", bg: "bg-black/[0.04]", text: FC.mut, dot: "bg-[#999]" },
                    ].map((s) => (
                      <span key={s.label} className={`inline-flex items-center gap-1.5 rounded-full ${s.bg} px-2.5 py-0.5 text-[12px] font-medium ${s.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>Dot 6px + texto 12px. Sem ícone Lucide em badges inline.</p>
                </div>
              </div>
            </div>

            <div className={`h-px ${FC.hairBg}`} />

            {/* ═══ EFEITOS ═══ */}
            <div className="relative" id="efeitos">
              <SectionAnchor id="efeitos-anchor" title="Efeitos" subtitle="PageHero com chuva matrix, animações e interações." />

              <div className="p-6 space-y-8">
                {/* PageHero */}
                <div>
                  <Label>PageHero — banner de topo com PageHeroRidge</Label>
                  <div className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                    <PageFrame>
                      <PageHero
                        title="Configurações"
                        subtitle="Gerencie provedores LLM, integrações e parâmetros do workspace."
                        right={
                          <Button variant="secondary">
                            <Settings className="w-3.5 h-3.5" /> Avançado
                          </Button>
                        }
                      />
                    </PageFrame>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Título 28px semibold + subtítulo + <Code>PageHeroRidge</Code> (chuva matrix canvas, canto inferior direito).
                  </p>
                </div>

                {/* PageHeroRidge standalone */}
                <div>
                  <Label>PageHeroRidge — chuva matrix isolada</Label>
                  <div className={`relative rounded-[10px] border ${FC.hair} overflow-hidden`} style={{ height: 132 }}>
                    <div className={`absolute inset-0 ${FC.base}`} />
                    <PageHeroRidge />
                    <div className="relative flex h-full items-center justify-center">
                      <p className={`text-[13px] ${FC.sub}`}>Canvas 380×132 — masked radial gradient no canto.</p>
                    </div>
                  </div>
                  <p className={`mt-2 text-[11px] ${FC.sub}`}>
                    Glifos katakana + números + símbolos. Cabeça azul-claro + rastro azul Tier que some. Ritmo calmo (0.04–0.11 rows/frame).
                  </p>
                </div>

                {/* Alertas / toasts pattern */}
                <div>
                  <Label>Padrão de alertas inline</Label>
                  <div className="flex flex-col gap-2 max-w-[500px]">
                    {[
                      { icon: Check, bg: "bg-[#0a8f5a]/[0.07]", border: "border-[#0a8f5a]/20", text: "text-[#0a8f5a]", msg: "Configuração salva com sucesso." },
                      { icon: Info, bg: "bg-[#003083]/[0.06]", border: "border-[#003083]/20", text: "text-[#003083]", msg: "Webhook será ativado no próximo deploy." },
                      { icon: AlertTriangle, bg: "bg-[#F5A300]/[0.08]", border: "border-[#F5A300]/30", text: "text-[#C47F00]", msg: "Token expira em 2 dias — reconecte." },
                    ].map(({ icon: Icon, bg, border, text, msg }) => (
                      <div key={msg} className={`flex items-start gap-2.5 rounded-[10px] border ${border} ${bg} px-4 py-3`}>
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${text}`} />
                        <p className={`text-[13px] ${text}`}>{msg}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </main>
        </div>

        {/* ── footer ── */}
        <footer className={`border-t ${FC.hair} px-6 py-4 flex items-center justify-between`}>
          <p className={`text-[12px] ${FC.mut}`}>Tier Agent Design System — Firecrawl × Tier · 2026</p>
          <Link
            to="/admin"
            className={`text-[12px] font-medium text-[#003083] dark:text-[#5b9bff] hover:underline inline-flex items-center gap-1`}
          >
            Ir para o admin <ArrowUpRight className="w-3 h-3" />
          </Link>
        </footer>
      </div>
    </div>
  );
}

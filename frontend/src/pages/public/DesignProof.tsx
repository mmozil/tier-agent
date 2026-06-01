import { useState } from "react";
import {
  Home,
  Radar,
  Bot,
  MessageSquare,
  Workflow,
  Plug,
  BookOpen,
  Store,
  Activity,
  Gauge,
  CreditCard,
  Settings,
  Bell,
  Sun,
  Moon,
  HelpCircle,
  FileText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Copy,
  ArrowUpRight,
  Headphones,
  ShoppingCart,
  Wallet,
  Search,
  Filter,
  KeyRound,
  Calendar,
  Users,
  SlidersHorizontal,
  Mail,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   PROVA — padrão dashboard Firecrawl × CORES TIER (azul).
   3 páginas-exemplo clicáveis na sidebar: Visão geral, Logs,
   Configurações. Rota pública /design-proof · mock. Light + dark.
   ──────────────────────────────────────────────────────────── */

type View = "overview" | "logs" | "settings";

const NAV: { type: "label" | "item"; label: string; icon?: any; view?: View; active?: boolean; badge?: string }[] = [
  { type: "item", icon: Home, label: "Visão geral", view: "overview" },
  { type: "label", label: "Novidades" },
  { type: "item", icon: Radar, label: "Monitorar conversas", badge: "NOVO" },
  { type: "label", label: "Plataforma" },
  { type: "item", icon: Bot, label: "Agentes" },
  { type: "item", icon: MessageSquare, label: "Conversas" },
  { type: "item", icon: Workflow, label: "Playbooks" },
  { type: "item", icon: Plug, label: "Canais" },
  { type: "item", icon: BookOpen, label: "Knowledge" },
  { type: "item", icon: Store, label: "Marketplace" },
  { type: "label", label: "Conta" },
  { type: "item", icon: Activity, label: "Logs", view: "logs" },
  { type: "item", icon: Gauge, label: "Uso" },
  { type: "item", icon: CreditCard, label: "Cobrança" },
  { type: "item", icon: Settings, label: "Configurações", view: "settings" },
];

const FEATURES = [
  { icon: Headphones, title: "Atender", desc: "Responde clientes em qualquer canal, 24/7." },
  { icon: ShoppingCart, title: "Vender", desc: "Qualifica e fecha a venda dentro da conversa.", badge: "NOVO" },
  { icon: Wallet, title: "Cobrar", desc: "Gera Pix e link de pagamento no chat." },
  { icon: Workflow, title: "Automatizar", desc: "Playbooks visuais que rodam sozinhos." },
];

const SERIES = [38, 42, 40, 55, 49, 62, 58, 71, 66, 80, 74, 88, 92, 104];

const LOGS = [
  { time: "14:32:08", agent: "Maria Luiza", canal: "WhatsApp", evento: "lead.captured", status: "ok" },
  { time: "14:30:55", agent: "Sofia", canal: "Instagram", evento: "message.sent", status: "ok" },
  { time: "14:28:12", agent: "Bot SDR", canal: "Telegram", evento: "handoff.requested", status: "warn" },
  { time: "14:25:40", agent: "Maria Luiza", canal: "WhatsApp", evento: "payment.created", status: "ok" },
  { time: "14:22:03", agent: "Suporte N1", canal: "E-mail", evento: "rag.answered", status: "ok" },
  { time: "14:19:47", agent: "Sofia", canal: "Instagram", evento: "intent.classified", status: "ok" },
  { time: "14:15:21", agent: "Bot SDR", canal: "Telegram", evento: "error.timeout", status: "err" },
  { time: "14:11:09", agent: "Maria Luiza", canal: "WhatsApp", evento: "agent.replied", status: "ok" },
];

const SET_TABS = [
  { icon: Users, label: "Equipe", active: true },
  { icon: CreditCard, label: "Cobrança" },
  { icon: SlidersHorizontal, label: "Avançado" },
];

function areaPath(data: number[], w: number, h: number) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const stepX = w / (data.length - 1);
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

const dot = (s: string) => (s === "ok" ? "#0a8f5a" : s === "warn" ? "#F5A300" : "#E5484D");
const stColor = (s: string) => (s === "online" ? "#0a8f5a" : s === "busy" ? "#F5A300" : "#9AA4B2");

const KPI2 = [
  { label: "Conversas abertas", value: "142" },
  { label: "Não atendidas", value: "23", tone: "warn" },
  { label: "Resolvidas pela IA", value: "78%", tone: "good" },
  { label: "Aguardando humano", value: "8" },
];
const AG_STATUS = [
  { name: "Maria Luiza", st: "online" },
  { name: "Sofia", st: "online" },
  { name: "Bot SDR", st: "busy" },
  { name: "Suporte N1", st: "offline" },
];
const WORKLOAD = [
  { name: "Maria Luiza", n: 48, pct: 100 },
  { name: "Sofia", n: 36, pct: 75 },
  { name: "Bot SDR", n: 22, pct: 46 },
  { name: "Suporte N1", n: 11, pct: 23 },
];
const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
function heat(d: number, h: number) {
  const hour = h * 2;
  const mid = Math.max(0, 1 - Math.abs(hour - 13) / 9);
  const eve = Math.max(0, 1 - Math.abs(hour - 19) / 6) * 0.8;
  return Math.min(1, (mid * 0.75 + eve * 0.5) * (d >= 5 ? 0.45 : 1));
}

// Crosshairs "+" nas junções da grade (efeito Firecrawl/blueprint)
function PlusMarks({ cols }: { cols: number }) {
  const xs = Array.from({ length: cols + 1 }, (_, i) => (i / cols) * 100);
  return (
    <>
      {[0, 100].map((y) =>
        xs.map((x) => (
          <span
            key={`${x}-${y}`}
            className="absolute z-10 pointer-events-none text-[#CFD4DB] dark:text-[#3a414c]"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)" }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
              <path d="M4.5 0.5v8M0.5 4.5h8" stroke="currentColor" strokeWidth="1" />
            </svg>
          </span>
        ))
      )}
    </>
  );
}

export default function DesignProof() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState<View>("overview");
  const A = dark ? "#5b9bff" : "#003083";

  // estilos reutilizados
  const hair = "border-[#EEEFF1] dark:border-[#1e2228]";
  const sub = "text-[#9AA4B2] dark:text-[#6b7280]";
  const fieldBtn =
    "h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-[#E4E7EC] dark:border-[#2a2f37] text-[12.5px] font-medium text-[#3f4651] dark:text-[#c5cad1] hover:bg-[#F2F4F7] dark:hover:bg-[#16191f]";

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-white dark:bg-[#0c0e12] text-[#0D0F11] dark:text-[#e6e8eb] font-sans antialiased flex">
        {/* ── SIDEBAR ── */}
        <aside className={`w-[230px] shrink-0 h-screen sticky top-0 bg-white dark:bg-[#0e1116] border-r ${hair} flex flex-col`}>
          <div className="h-14 px-5 flex items-center">
            <img src={dark ? "/tier-agent-claro.png" : "/tier-agent-escuro.png"} alt="Tier Agent" className="h-7 w-auto" />
          </div>
          <nav className="px-3 flex-1 overflow-y-auto pb-3">
            {NAV.map((n, i) =>
              n.type === "label" ? (
                <div key={i} className="px-2 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#B4BBC6] dark:text-[#565d68]">{n.label}</div>
              ) : (
                <div
                  key={i}
                  onClick={() => n.view && setView(n.view)}
                  className={`flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13.5px] cursor-pointer transition-colors ${
                    n.view === view ? "font-semibold" : "text-[#4A5260] dark:text-[#9aa1ab] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]"
                  }`}
                  style={n.view === view ? { backgroundColor: `${A}12`, color: A } : undefined}
                >
                  {n.icon && <n.icon className="w-[18px] h-[18px] flex-shrink-0" />}
                  <span className="flex-1">{n.label}</span>
                  {n.badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: A }}>{n.badge}</span>}
                </div>
              )
            )}
          </nav>
          <div className={`border-t ${hair} p-3`}>
            <div className="flex items-center gap-2.5 px-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: A }}>M</div>
              <span className="text-[12px] text-[#6A7385] dark:text-[#9aa1ab] truncate">marcelo@tier.finance</span>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <div className="flex-1 min-w-0">
          {/* topbar */}
          <header className={`h-14 px-6 flex items-center gap-3 border-b ${hair}`}>
            <button className={`flex items-center gap-2 h-9 px-2.5 rounded-lg border ${hair} hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]`}>
              <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: A }}>T</span>
              <span className="text-[13px] font-medium">Tier Finance Team</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#9AA4B2]" />
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#6A7385] dark:text-[#9aa1ab] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]"><Bell className="w-[18px] h-[18px]" /></button>
              <button onClick={() => setDark((d) => !d)} className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#6A7385] dark:text-[#9aa1ab] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]" aria-label="Alternar tema">
                {dark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
              </button>
              <button className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-[#3f4651] dark:text-[#c5cad1] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]"><HelpCircle className="w-4 h-4" /> Ajuda</button>
              <button className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-[#3f4651] dark:text-[#c5cad1] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]"><FileText className="w-4 h-4" /> Docs</button>
              <button className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-white text-[13px] font-semibold hover:opacity-90" style={{ backgroundColor: A }}><ArrowUpRight className="w-4 h-4" /> Upgrade</button>
            </div>
          </header>

          {/* ═══ VISÃO GERAL ═══ */}
          {view === "overview" && (
            <>
              <section className="px-8 pt-8 pb-6">
                <h2 className="text-[26px] font-bold tracking-tight">Visão geral</h2>
                <p className={`text-[14px] ${sub} mt-1`}>O que está acontecendo com seus agentes agora.</p>
                {/* atalhos — grade com crosshairs */}
                <div className="relative mt-5">
                  <div className={`grid grid-cols-2 lg:grid-cols-4 border-t border-l ${hair}`}>
                    {FEATURES.map((f) => (
                      <div key={f.title} className={`border-r border-b ${hair} p-5 hover:bg-[#FAFBFC] dark:hover:bg-[#101319] transition-colors cursor-pointer`}>
                        <f.icon className="w-5 h-5" style={{ color: A }} />
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-[14px] font-semibold">{f.title}</span>
                          {f.badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: A }}>{f.badge}</span>}
                        </div>
                        <p className={`mt-1 text-[12.5px] ${sub} leading-relaxed`}>{f.desc}</p>
                      </div>
                    ))}
                  </div>
                  <PlusMarks cols={4} />
                </div>
              </section>

              {/* KPI strip (Chatwoot conversas) — grade com crosshairs */}
              <div className={`relative border-t ${hair}`}>
                <div className={`grid grid-cols-2 lg:grid-cols-4 border-l ${hair}`}>
                  {KPI2.map((k) => (
                    <div key={k.label} className={`border-r border-b ${hair} px-6 py-5`}>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA4B2] dark:text-[#6b7280]">{k.label}</div>
                      <div
                        className="mt-2 font-mono tabular-nums text-[28px] font-bold leading-none"
                        style={{ color: k.tone === "good" ? "#0a8f5a" : k.tone === "warn" ? "#F5A300" : undefined }}
                      >
                        {k.value}
                      </div>
                    </div>
                  ))}
                </div>
                <PlusMarks cols={4} />
              </div>

              {/* chart + status dos agentes */}
              <div className={`border-t ${hair} grid grid-cols-1 lg:grid-cols-[1fr_360px]`}>
                <div className={`px-8 py-7 lg:border-r ${hair}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[15px] font-bold">Conversas — últimos 7 dias</div>
                      <div className={`text-[12.5px] ${sub} mt-0.5`}>resolução pela IA: 78%</div>
                    </div>
                    <div className="font-mono tabular-nums text-[30px] font-bold leading-none">2.847</div>
                  </div>
                  <svg viewBox="0 0 600 110" className="mt-6 w-full h-[110px]" preserveAspectRatio="none">
                    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={A} stopOpacity="0.2" /><stop offset="100%" stopColor={A} stopOpacity="0" /></linearGradient></defs>
                    <path d={areaPath(SERIES, 600, 110).area} fill="url(#g)" />
                    <path d={areaPath(SERIES, 600, 110).line} fill="none" stroke={A} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
                <div className="px-8 py-7">
                  <div className="text-[15px] font-bold">Status dos agentes</div>
                  <div className="mt-3 flex items-center gap-4 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a]" /> 2 online</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#F5A300]" /> 1 ocupado</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#9AA4B2]" /> 1 offline</span>
                  </div>
                  <div className="mt-4 space-y-1">
                    {AG_STATUS.map((a) => (
                      <div key={a.name} className="flex items-center gap-2.5 h-8">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stColor(a.st) }} />
                        <span className="text-[13px] font-medium flex-1">{a.name}</span>
                        <span className="text-[11.5px] capitalize" style={{ color: stColor(a.st) }}>{a.st === "online" ? "online" : a.st === "busy" ? "ocupado" : "offline"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* heatmap de tráfego + carga por agente */}
              <div className={`border-t ${hair} grid grid-cols-1 lg:grid-cols-[1fr_360px]`}>
                <div className={`px-8 py-7 lg:border-r ${hair}`}>
                  <div className="text-[15px] font-bold">Tráfego de conversas</div>
                  <div className={`text-[12.5px] ${sub} mt-0.5`}>Horários mais movimentados (7 dias)</div>
                  <div className="mt-5 space-y-1">
                    {DAYS.map((day, d) => (
                      <div key={day} className="flex items-center gap-2">
                        <span className={`w-7 text-[10.5px] ${sub} shrink-0`}>{day}</span>
                        <div className="flex gap-1 flex-1">
                          {Array.from({ length: 12 }).map((_, h) => {
                            const al = Math.round((0.04 + heat(d, h) * 0.6) * 255).toString(16).padStart(2, "0");
                            return <div key={h} className="h-5 flex-1 rounded-[3px]" style={{ backgroundColor: `${A}${al}` }} />;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1 mt-1.5 ml-9 justify-between font-mono text-[10px] text-[#B4BBC6] dark:text-[#565d68]">
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span>
                  </div>
                </div>
                <div className="px-8 py-7">
                  <div className="text-[15px] font-bold">Carga por agente</div>
                  <div className={`text-[12.5px] ${sub} mt-0.5`}>Conversas ativas agora</div>
                  <div className="mt-4 space-y-3.5">
                    {WORKLOAD.map((w) => (
                      <div key={w.name}>
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="font-medium">{w.name}</span>
                          <span className="font-mono tabular-nums text-[#6A7385] dark:text-[#8b93a0]">{w.n}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-[#F1F3F5] dark:bg-[#16191f] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${w.pct}%`, backgroundColor: A }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* API key + CLI (rodapé) */}
              <div className={`border-t ${hair} grid grid-cols-1 lg:grid-cols-2`}>
                <div className={`px-8 py-6 lg:border-r ${hair}`}>
                  <div className="text-[15px] font-bold">Chave de API</div>
                  <div className={`text-[12.5px] ${sub} mt-0.5`}>Conecte agentes externos via OAuth.</div>
                  <div className="mt-3 flex items-center gap-2 h-10 px-3 rounded-lg border max-w-[420px]" style={{ backgroundColor: `${A}0a`, borderColor: `${A}26` }}>
                    <span className="font-mono text-[12.5px] flex-1 truncate" style={{ color: A }}>tk-5••••••••••••••••••c7a1</span>
                    <Eye className="w-4 h-4 text-[#9AA4B2] cursor-pointer" /><Copy className="w-4 h-4 text-[#9AA4B2] cursor-pointer" />
                  </div>
                </div>
                <div className="px-8 py-6">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA4B2] dark:text-[#6b7280] mb-1.5">CLI</div>
                  <div className={`flex items-center gap-2 h-10 px-3 rounded-lg bg-[#F5F6F8] dark:bg-[#14171c] border ${hair} max-w-[420px]`}>
                    <span className="font-mono text-[12px] flex-1 truncate"><span className="text-[#9AA4B2]">$</span> npx <span style={{ color: A }}>tier-agent</span> init</span>
                    <Copy className="w-3.5 h-3.5 text-[#9AA4B2] cursor-pointer" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ LOGS ═══ */}
          {view === "logs" && (
            <>
              <section className="px-8 pt-8 pb-6">
                <h2 className="text-[26px] font-bold tracking-tight">Logs de atividade</h2>
                <p className={`text-[14px] ${sub} mt-1`}>Acompanhe a atividade dos seus agentes em tempo real.</p>
              </section>
              <div className={`px-8 py-4 border-t border-b ${hair} flex flex-wrap items-center gap-2`}>
                <div className={`flex items-center gap-2 h-9 px-3 rounded-lg bg-[#F1F3F5] dark:bg-[#16191f] ${sub} w-[280px]`}>
                  <Search className="w-3.5 h-3.5" /><span className="text-[12.5px]">Buscar evento…</span>
                </div>
                <button className={fieldBtn}><Filter className="w-3.5 h-3.5" /> Todos os canais <ChevronDown className="w-3.5 h-3.5 opacity-60" /></button>
                <button className={fieldBtn}><Bot className="w-3.5 h-3.5" /> Todos os agentes <ChevronDown className="w-3.5 h-3.5 opacity-60" /></button>
                <button className={`${fieldBtn} ml-auto`}><Calendar className="w-3.5 h-3.5" /> Últimos 7 dias <ChevronDown className="w-3.5 h-3.5 opacity-60" /></button>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className={`text-[11px] font-semibold uppercase tracking-wide ${sub} border-b ${hair}`}>
                    <th className="px-8 py-2.5">Horário</th>
                    <th className="px-3 py-2.5">Agente</th>
                    <th className="px-3 py-2.5">Canal</th>
                    <th className="px-3 py-2.5">Evento</th>
                    <th className="px-8 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {LOGS.map((l, i) => (
                    <tr key={i} className={`text-[13px] border-b ${hair} hover:bg-[#FAFBFC] dark:hover:bg-[#101319] transition-colors`}>
                      <td className="px-8 py-3 font-mono tabular-nums text-[#6A7385] dark:text-[#8b93a0]">{l.time}</td>
                      <td className="px-3 py-3 font-medium">{l.agent}</td>
                      <td className="px-3 py-3 text-[#6A7385] dark:text-[#8b93a0]">{l.canal}</td>
                      <td className="px-3 py-3"><span className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-[#F1F3F5] dark:bg-[#16191f]" style={{ color: l.status === "err" ? "#E5484D" : A }}>{l.evento}</span></td>
                      <td className="px-8 py-3 text-right">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: dot(l.status) }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot(l.status) }} />
                          {l.status === "ok" ? "OK" : l.status === "warn" ? "Atenção" : "Erro"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-8 py-4 flex items-center justify-between">
                <span className={`text-[12.5px] ${sub}`}>Página 1 · 8 de 1.204 eventos</span>
                <div className="flex items-center gap-1.5">
                  <button className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border ${hair} ${sub}`}><ChevronLeft className="w-4 h-4" /></button>
                  <button className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border ${hair} text-[#3f4651] dark:text-[#c5cad1] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]`}><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            </>
          )}

          {/* ═══ CONFIGURAÇÕES ═══ */}
          {view === "settings" && (
            <>
              <section className="px-8 pt-8 pb-6">
                <h2 className="text-[26px] font-bold tracking-tight">Configurações</h2>
                <p className={`text-[14px] ${sub} mt-1`}>Gerencie sua equipe, cobrança e preferências da conta.</p>
              </section>
              <div className={`border-t ${hair} grid grid-cols-1 lg:grid-cols-[220px_1fr]`}>
                {/* sub-nav */}
                <div className={`p-5 lg:border-r ${hair}`}>
                  <div className="flex flex-col gap-0.5">
                    {SET_TABS.map((t) => (
                      <div
                        key={t.label}
                        className={`flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13.5px] cursor-pointer ${t.active ? "font-semibold" : "text-[#4A5260] dark:text-[#9aa1ab] hover:bg-[#F5F6F8] dark:hover:bg-[#16191f]"}`}
                        style={t.active ? { backgroundColor: `${A}12`, color: A } : undefined}
                      >
                        <t.icon className="w-4 h-4" /> {t.label}
                      </div>
                    ))}
                  </div>
                </div>
                {/* conteúdo */}
                <div className={`divide-y ${hair} divide-[#EEEFF1] dark:divide-[#1e2228]`}>
                  <div className="px-8 py-6 max-w-[640px]">
                    <div className="text-[15px] font-bold">Nome da equipe</div>
                    <div className={`text-[12.5px] ${sub} mt-0.5`}>Atualize o nome de exibição da equipe.</div>
                    <div className="mt-3 flex items-center gap-2">
                      <input defaultValue="Tier Finance" className={`flex-1 h-10 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${hair} outline-none focus:border-transparent`} style={{ boxShadow: `inset 0 0 0 0 ${A}` }} />
                      <button className="h-10 px-4 rounded-lg text-white text-[13px] font-semibold" style={{ backgroundColor: A }}>Salvar</button>
                    </div>
                  </div>
                  <div className="px-8 py-6 max-w-[640px]">
                    <div className="text-[15px] font-bold">Convidar membros</div>
                    <div className={`text-[12.5px] ${sub} mt-0.5`}>Adicione novos membros à sua equipe.</div>
                    <div className="mt-3 flex items-center gap-2">
                      <input placeholder="email@empresa.com" className={`flex-1 h-10 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${hair} outline-none placeholder:text-[#B4BBC6]`} />
                      <button className={fieldBtn + " h-10"}>Membro <ChevronDown className="w-3.5 h-3.5 opacity-60" /></button>
                      <button className="h-10 px-4 rounded-lg text-white text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ backgroundColor: A }}><Mail className="w-4 h-4" /> Enviar convite</button>
                    </div>
                    <p className={`mt-2 text-[12px] ${sub}`}>Membros convidados recebem um e-mail com instruções pra entrar.</p>
                  </div>
                  <div className="px-8 py-6 max-w-[640px]">
                    <div className="text-[15px] font-bold">Membros da equipe</div>
                    <div className={`text-[12.5px] ${sub} mt-0.5`}>Gerencie acesso e permissões.</div>
                    <div className={`mt-3 flex items-center gap-3 p-3 rounded-lg border ${hair}`}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ backgroundColor: A }}>M</div>
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold flex items-center gap-2">marcelo@tier.finance <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${A}14`, color: A }}>ADMIN</span></div>
                        <div className={`text-[11.5px] ${sub}`}>Você</div>
                      </div>
                      <button className="text-[#9AA4B2] hover:text-[#6A7385]"><KeyRound className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          <p className={`px-8 py-5 text-[11px] text-[#B4BBC6] dark:text-[#565d68] border-t ${hair}`}>
            Prova · clique em <b>Visão geral / Logs / Configurações</b> na sidebar · ☀️/🌙 alterna o tema
          </p>
        </div>
      </div>
    </div>
  );
}

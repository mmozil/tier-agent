import { useState } from "react";
import {
  Bot,
  Clock,
  DollarSign,
  MessageSquare,
  Sparkles,
  Workflow,
  Home,
  Plug,
  BookOpen,
  Store,
  Activity,
  Gauge,
  CreditCard,
  Settings,
  Bell,
  Moon,
  HelpCircle,
  FileText,
  Search,
  ArrowUpRight,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { FC, PageFrame, Row, HairCells, SegToggle, Button } from "@/components/ds/fc";

/* PREVIEW PÚBLICO (sem login) — shell completo (sidebar + topbar) + Métrica
   migrada pro padrão Firecrawl×Tier, dados de exemplo. Rota: /preview/metricas. */

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
];

const NAV: { type: "label" | "item"; label: string; icon?: any; active?: boolean }[] = [
  { type: "item", icon: Home, label: "Visão geral" },
  { type: "label", label: "Plataforma" },
  { type: "item", icon: Bot, label: "Agentes" },
  { type: "item", icon: MessageSquare, label: "Conversas" },
  { type: "item", icon: Workflow, label: "Playbooks" },
  { type: "item", icon: Plug, label: "Canais" },
  { type: "item", icon: BookOpen, label: "Knowledge" },
  { type: "item", icon: Store, label: "Marketplace" },
  { type: "label", label: "Conta" },
  { type: "item", icon: Activity, label: "Logs" },
  { type: "item", icon: Gauge, label: "Métricas", active: true },
  { type: "item", icon: CreditCard, label: "Cobrança" },
  { type: "item", icon: Settings, label: "Configurações" },
];

const CHART = [
  { day: "05-01", Mensagens: 320, "Custo (R$)": 4.2 },
  { day: "05-05", Mensagens: 410, "Custo (R$)": 5.1 },
  { day: "05-09", Mensagens: 380, "Custo (R$)": 4.8 },
  { day: "05-13", Mensagens: 520, "Custo (R$)": 6.6 },
  { day: "05-17", Mensagens: 490, "Custo (R$)": 6.0 },
  { day: "05-21", Mensagens: 640, "Custo (R$)": 7.9 },
  { day: "05-25", Mensagens: 710, "Custo (R$)": 8.8 },
  { day: "05-29", Mensagens: 880, "Custo (R$)": 10.4 },
];
const BY_AGENT = [
  ["Maria Luiza", "1.240", "R$ 14,20", "820ms"],
  ["Sofia", "980", "R$ 9,80", "910ms"],
  ["Bot SDR", "540", "R$ 6,10", "1100ms"],
];
const BY_MODEL = [
  ["minimax-m2", "1.880", "920k / 410k", "R$ 18,40"],
  ["gemini-2.5-flash", "640", "300k / 120k", "R$ 6,20"],
];
const TOP = [
  ["#3182", "João Pereira", "44", "R$ 3,80"],
  ["#3090", "Ana Lima", "38", "R$ 3,20"],
  ["#2997", "—", "31", "R$ 2,60"],
];

export default function MetricasPreview() {
  const [days, setDays] = useState(30);
  const itemCls = (active?: boolean) =>
    `group flex items-center gap-2.5 rounded-[10px] transition-all duration-200 active:scale-[0.98] h-[34px] text-[13px] px-2.5 ${
      active
        ? "text-[#003083] font-medium bg-[#003083]/[0.06]"
        : "text-[#262626]/[0.72] hover:text-[#262626] font-normal"
    }`;

  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#262626] antialiased flex" style={{ fontFamily: "'Geist', sans-serif" }}>
      {/* ── SIDEBAR (réplica do AdminLayout novo) ── */}
      <aside className="fixed left-0 top-0 h-screen z-50 flex flex-col bg-[#F9F9F9] border-r border-[#EDEDED]" style={{ width: 240 }}>
        <div className="h-16 px-5 shrink-0 flex items-center border-b border-[#EDEDED]">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" style={{ height: 28, width: "auto", display: "block" }} />
        </div>
        <nav className="flex-1 overflow-y-auto px-5 py-3">
          {NAV.map((n, i) =>
            n.type === "label" ? (
              <div key={i} className={i > 0 ? "mt-5 mb-1" : "mb-1"}>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#262626]/40">{n.label}</span>
              </div>
            ) : (
              <div key={i} className={itemCls(n.active)}>
                <n.icon
                  className={`w-4 h-4 flex-shrink-0 transition-all duration-200 ${
                    n.active ? "opacity-100" : "opacity-60 group-hover:opacity-100"
                  }`}
                />
                <span>{n.label}</span>
              </div>
            ),
          )}
        </nav>
        <div className="border-t border-[#EDEDED] p-3 shrink-0">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-full bg-[#003083] text-white flex items-center justify-center text-[11px] font-semibold shrink-0">M</div>
            <span className="text-[12px] text-[#262626]/56 truncate">marcelo@tier.finance</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 ml-[240px] min-h-screen bg-[#F9F9F9]">
        <div>
          {/* topbar */}
          <div className="h-[60px] px-6 flex items-center justify-between">
            <div className="relative w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#262626]/40 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar..."
                className="w-full h-7 pl-9 pr-3 text-[14px] rounded-lg bg-[#F1F3F5] text-[#262626] placeholder:text-[#262626]/40 outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost"><Bell className="w-[18px] h-[18px]" /></Button>
              <Button variant="ghost"><Moon className="w-[18px] h-[18px]" /></Button>
              <Button variant="ghost"><HelpCircle className="w-4 h-4" /> Ajuda</Button>
              <Button variant="ghost"><FileText className="w-4 h-4" /> Docs</Button>
              <Button variant="primary"><ArrowUpRight className="w-4 h-4" /> Upgrade</Button>
            </div>
          </div>

          {/* conteúdo: LINHAS full-width (Row) até as extremidades; CONTEÚDO contido nos rails */}
          <div className="pb-10">
            <PageFrame>
              {/* header */}
              <Row>
                <div className="flex items-start justify-between gap-4 p-6">
                  <div>
                    <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Métricas</h2>
                    <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                      Custo, latência, uso por agente e por modelo nos últimos {days} dias.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SegToggle value={days} options={PERIODS} onChange={(v) => setDays(v)} />
                    <Button variant="secondary"><FileText className="w-3.5 h-3.5" /> Exportar</Button>
                  </div>
                </div>
              </Row>

              {/* KPIs */}
              <Row>
                <HairCells cols={4}>
                  <KpiCell icon={DollarSign} label="Custo total" value="R$ 24,60" hint="1.220.000 in / 530.000 out" />
                  <KpiCell icon={MessageSquare} label="Mensagens" value="2.847" hint="312 conversas" />
                  <KpiCell icon={Clock} label="Latência média" value="910ms" hint="resposta do agente" />
                  <KpiCell icon={Workflow} label="Execuções playbook" value="184" hint="3 agentes ativos" />
                </HairCells>
              </Row>

              {/* gráfico */}
              <Row>
                <div className="p-6">
                  <div className="mb-4">
                    <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Volume diário</h3>
                    <p className={`text-[13px] ${FC.sub}`}>Mensagens enviadas vs custo (R$)</p>
                  </div>
                  <div style={{ width: "100%", height: 220 }}>
                    <ResponsiveContainer>
                      <AreaChart data={CHART} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="p1" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#003083" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#003083" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="p2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0a8f5a" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#0a8f5a" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDEDED" vertical={false} />
                        <XAxis dataKey="day" stroke="#9AA4B2" fontSize={11} axisLine={false} tickLine={false} />
                        <YAxis stroke="#9AA4B2" fontSize={11} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#fff",
                            border: "1px solid #EDEDED",
                            borderRadius: 8,
                            color: "#262626",
                            fontSize: 12,
                            boxShadow: "0 4px 16px -6px rgba(0,0,0,0.12)",
                          }}
                        />
                        <Area type="monotone" dataKey="Mensagens" stroke="#003083" strokeWidth={2} fill="url(#p1)" />
                        <Area type="monotone" dataKey="Custo (R$)" stroke="#0a8f5a" strokeWidth={2} fill="url(#p2)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Row>

              {/* por agente | por modelo */}
              <Row>
                <HairCells cols={2}>
                  <CellSection title="Por agente" icon={Bot}>
                    <Table cols={["Agente", "Msgs", "Custo", "Latência"]} rows={BY_AGENT} />
                  </CellSection>
                  <CellSection title="Por modelo" icon={Sparkles}>
                    <Table cols={["Modelo", "Msgs", "Tokens (in/out)", "Custo"]} rows={BY_MODEL} />
                  </CellSection>
                </HairCells>
              </Row>

              {/* top conversas (última) */}
              <Row last>
                <div className="p-6">
                  <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-4 ${FC.ink}`}>Top conversas mais caras</h3>
                  <Table cols={["Conversa", "Contato", "Msgs", "Custo"]} rows={TOP} />
                </div>
              </Row>
            </PageFrame>
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiCell({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${FC.mut}`} />
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${FC.mut}`}>{label}</div>
      </div>
      <div className={`font-mono tabular-nums text-[24px] font-medium leading-none ${FC.ink}`}>{value}</div>
      {hint && <div className={`text-[12px] mt-1.5 ${FC.sub}`}>{hint}</div>}
    </div>
  );
}

function CellSection({
  title,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6">
      <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-4 ${FC.ink}`}>{title}</h3>
      {children}
    </div>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className={`border-b ${FC.hair}`}>
            {cols.map((c, i) => (
              <th
                key={i}
                className={`pb-2 text-[11px] font-semibold uppercase tracking-wider ${FC.mut} ${
                  i === cols.length - 1 ? "text-right" : "text-left"
                } ${i === 0 ? "pr-3" : "px-3"}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={`border-b ${FC.hair} last:border-b-0 ${FC.hover}`}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-2.5 text-[13px] ${FC.ink} ${
                    ci === row.length - 1 ? "text-right" : "text-left"
                  } ${ci === 0 ? "pr-3" : "px-3"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

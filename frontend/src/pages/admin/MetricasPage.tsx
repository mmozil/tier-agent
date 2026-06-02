import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Bot,
  Clock,
  DollarSign,
  Loader2,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, SegToggle } from "@/components/ds/fc";

interface Overview {
  period_days: number;
  messages_total: number;
  tokens_in_total: number;
  tokens_out_total: number;
  cost_cents_total: number;
  cost_brl_total: number;
  avg_latency_ms: number;
  agents_count: number;
  conversations_count: number;
  playbook_executions_count: number;
}

interface DailyPoint {
  day: string;
  messages: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
}

interface ByAgent {
  agent_id: number;
  agent_nome: string;
  messages: number;
  cost_cents: number;
  avg_latency_ms: number;
}

interface ByModel {
  model: string;
  messages: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
}

interface TopConv {
  conversation_id: number;
  agent_id: number;
  contact_name: string | null;
  external_id: string;
  cost_cents: number;
  msg_count: number;
}

interface AbRow {
  playbook_id: number;
  node_id: string;
  variant: string;
  runs: number;
  avg_latency_ms: number;
  total_cost_cents: number;
}

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
];

export default function MetricasPage() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [byAgent, setByAgent] = useState<ByAgent[]>([]);
  const [byModel, setByModel] = useState<ByModel[]>([]);
  const [topConv, setTopConv] = useState<TopConv[]>([]);
  const [abRows, setAbRows] = useState<AbRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [ov, dy, ag, md, tc, ab] = await Promise.all([
        api.get<Overview>(`/metrics/overview`, { params: { days } }),
        api.get<DailyPoint[]>(`/metrics/daily`, { params: { days } }),
        api.get<ByAgent[]>(`/metrics/by-agent`, { params: { days } }),
        api.get<ByModel[]>(`/metrics/by-model`, { params: { days } }),
        api.get<TopConv[]>(`/metrics/top-conversations`, { params: { days, limit: 10 } }),
        api.get<AbRow[]>(`/metrics/ab-tests`, { params: { days } }),
      ]);
      setOverview(ov.data);
      setDaily(dy.data);
      setByAgent(ag.data);
      setByModel(md.data);
      setTopConv(tc.data);
      setAbRows(ab.data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar métricas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        day: d.day.slice(5), // MM-DD
        Mensagens: d.messages,
        "Custo (R$)": +(d.cost_cents / 100).toFixed(2),
      })),
    [daily],
  );

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Métricas</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Custo, latência, uso por agente e por modelo nos últimos {days} dias.
              </p>
            </div>
            <SegToggle value={days} options={PERIODS} onChange={(v) => setDays(v)} />
          </div>
        </Row>

        {loading ? (
          <Row last>
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" />
            </div>
          </Row>
        ) : !overview ? (
          <Row last>
            <EmptyState />
          </Row>
        ) : (
          <>
            {/* KPI — células flush, bordas cruzam */}
            <Row>
              <HairCells cols={4}>
              <KpiCell
                icon={DollarSign}
                label="Custo total"
                value={`R$ ${overview.cost_brl_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                hint={`${overview.tokens_in_total.toLocaleString("pt-BR")} in / ${overview.tokens_out_total.toLocaleString("pt-BR")} out`}
              />
              <KpiCell
                icon={MessageSquare}
                label="Mensagens"
                value={overview.messages_total.toLocaleString("pt-BR")}
                hint={`${overview.conversations_count.toLocaleString("pt-BR")} conversas`}
              />
              <KpiCell
                icon={Clock}
                label="Latência média"
                value={`${Math.round(overview.avg_latency_ms)}ms`}
                hint="resposta do agente"
              />
              <KpiCell
                icon={Workflow}
                label="Execuções playbook"
                value={overview.playbook_executions_count.toLocaleString("pt-BR")}
                hint={`${overview.agents_count} agentes ativos`}
              />
              </HairCells>
            </Row>

            {/* Gráfico volume diário */}
            <Row>
              <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Volume diário</h3>
                  <p className={`text-[13px] ${FC.sub}`}>Mensagens enviadas vs custo (R$)</p>
                </div>
              </div>
              {chartData.length > 0 ? (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#003083" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#003083" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
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
                        labelStyle={{ color: "#262626", opacity: 0.56, fontSize: 11 }}
                      />
                      <Area type="monotone" dataKey="Mensagens" stroke="#003083" strokeWidth={2} fill="url(#g1)" />
                      <Area type="monotone" dataKey="Custo (R$)" stroke="#0a8f5a" strokeWidth={2} fill="url(#g2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className={`text-center py-10 text-[13px] ${FC.sub}`}>Sem dados no período</div>
              )}
              </div>
            </Row>

            {/* Por agente | Por modelo — 2 células flush */}
            <Row>
            <HairCells cols={2}>
              <CellSection title="Por agente" icon={Bot}>
                <Table
                  cols={["Agente", "Msgs", "Custo", "Latência"]}
                  rows={byAgent.map((a) => [
                    a.agent_nome,
                    a.messages.toLocaleString("pt-BR"),
                    `R$ ${(a.cost_cents / 100).toFixed(2)}`,
                    `${Math.round(a.avg_latency_ms)}ms`,
                  ])}
                  emptyMsg="Nenhum agente ativo no período"
                />
              </CellSection>
              <CellSection title="Por modelo" icon={Sparkles}>
                <Table
                  cols={["Modelo", "Msgs", "Tokens (in/out)", "Custo"]}
                  rows={byModel.map((m) => [
                    <span key="m" className="font-mono text-[11px]">
                      {m.model}
                    </span>,
                    m.messages.toLocaleString("pt-BR"),
                    `${m.tokens_in.toLocaleString("pt-BR")} / ${m.tokens_out.toLocaleString("pt-BR")}`,
                    `R$ ${(m.cost_cents / 100).toFixed(2)}`,
                  ])}
                  emptyMsg="Nenhum modelo usado ainda"
                />
              </CellSection>
            </HairCells>
            </Row>

            {/* A/B testing (condicional) */}
            {abRows.length > 0 && (
              <Row>
              <div className="p-6">
                <SectionTitle title="A/B testing — performance por variant" icon={Sparkles} />
                <Table
                  cols={["Playbook · Node", "Variant", "Runs", "Latência avg", "Custo"]}
                  rows={abRows.map((a) => [
                    <span key="pl" className={`font-mono text-[11px] ${FC.sub}`}>
                      #{a.playbook_id} · {a.node_id.slice(0, 12)}
                    </span>,
                    <span key="v" className="font-mono text-[11px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                      {a.variant}
                    </span>,
                    a.runs.toLocaleString("pt-BR"),
                    `${Math.round(a.avg_latency_ms)}ms`,
                    <span key="c" className={`font-medium ${FC.ink}`}>
                      R$ {(a.total_cost_cents / 100).toFixed(2)}
                    </span>,
                  ])}
                  emptyMsg="Sem variants disparados"
                />
              </div>
              </Row>
            )}

            {/* Top conversas mais caras */}
            <Row last>
            <div className="p-6">
              <SectionTitle title={`Top ${topConv.length} conversas mais caras`} icon={TrendingUp} />
              <Table
                cols={["Conversa", "Contato", "Msgs", "Custo"]}
                rows={topConv.map((c) => [
                  <span key="c" className={`font-mono text-[11px] ${FC.sub}`}>
                    #{c.conversation_id}
                  </span>,
                  <div key="ct">
                    <div className={`text-[12px] ${FC.ink}`}>{c.contact_name || "—"}</div>
                    <div className={`text-[10px] font-mono ${FC.sub}`}>{c.external_id}</div>
                  </div>,
                  c.msg_count.toLocaleString("pt-BR"),
                  <span key="cs" className={`font-medium ${FC.ink}`}>
                    R$ {(c.cost_cents / 100).toFixed(2)}
                  </span>,
                ])}
                emptyMsg="Sem conversas no período"
              />
            </div>
            </Row>
          </>
        )}
      </PageFrame>
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

function SectionTitle({
  title,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  // títulos de seção SEM ícone (igual Firecrawl)
  return <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-4 ${FC.ink}`}>{title}</h3>;
}

function CellSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6">
      <SectionTitle title={title} icon={icon} />
      {children}
    </div>
  );
}

function Table({
  cols,
  rows,
  emptyMsg,
}: {
  cols: string[];
  rows: (string | React.ReactNode)[][];
  emptyMsg: string;
}) {
  if (!rows.length) {
    return <div className={`text-center py-6 text-[13px] ${FC.sub}`}>{emptyMsg}</div>;
  }
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

function EmptyState() {
  return (
    <div className="p-12 text-center">
      <div className={`inline-flex w-12 h-12 rounded-md ${FC.base} items-center justify-center mb-4 border ${FC.hair}`}>
        <Zap className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
      </div>
      <h3 className={`text-[16px] font-[450] ${FC.ink} mb-1`}>Sem métricas ainda</h3>
      <p className={`text-[13px] ${FC.sub}`}>
        Conecte um WhatsApp e mande mensagens pra ver custos e estatísticas aqui.
      </p>
    </div>
  );
}

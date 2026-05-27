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
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [ov, dy, ag, md, tc] = await Promise.all([
        api.get<Overview>(`/metrics/overview`, { params: { days } }),
        api.get<DailyPoint[]>(`/metrics/daily`, { params: { days } }),
        api.get<ByAgent[]>(`/metrics/by-agent`, { params: { days } }),
        api.get<ByModel[]>(`/metrics/by-model`, { params: { days } }),
        api.get<TopConv[]>(`/metrics/top-conversations`, { params: { days, limit: 10 } }),
      ]);
      setOverview(ov.data);
      setDaily(dy.data);
      setByAgent(ag.data);
      setByModel(md.data);
      setTopConv(tc.data);
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
    <div>
      <div className="flex items-center justify-between mt-6 mb-2">
        <h1 className="text-[28px] font-bold text-[#30313d]">Métricas</h1>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors ${
                days === p.value
                  ? "bg-[#003083] text-white shadow-sm shadow-[#003083]/20"
                  : "bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Custo, latência, uso por agente e por modelo nos últimos {days} dias.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
        </div>
      ) : !overview ? (
        <EmptyState />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="bg-[#f4f7fa] rounded-lg p-2 mb-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <KpiCard
                icon={DollarSign}
                label="Custo total"
                value={`R$ ${overview.cost_brl_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                hint={`${overview.tokens_in_total.toLocaleString("pt-BR")} in / ${overview.tokens_out_total.toLocaleString("pt-BR")} out`}
              />
              <KpiCard
                icon={MessageSquare}
                label="Mensagens"
                value={overview.messages_total.toLocaleString("pt-BR")}
                hint={`${overview.conversations_count.toLocaleString("pt-BR")} conversas`}
              />
              <KpiCard
                icon={Clock}
                label="Latência média"
                value={`${Math.round(overview.avg_latency_ms)}ms`}
                hint="resposta do agente"
              />
              <KpiCard
                icon={Workflow}
                label="Execuções playbook"
                value={overview.playbook_executions_count.toLocaleString("pt-BR")}
                hint={`${overview.agents_count} agentes ativos`}
              />
            </div>
          </div>

          {/* Gráfico custo+msgs por dia */}
          <div className="bg-white rounded-md p-5 mb-6 shadow-[0_0_0_1px_rgb(226,232,240)]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[#1a2c44]">Volume diário</h3>
                <p className="text-[12px] text-[#697386]">Mensagens enviadas vs custo (R$)</p>
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
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        border: "1px solid rgba(51,65,85,0.4)",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Mensagens"
                      stroke="#003083"
                      strokeWidth={2}
                      fill="url(#g1)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Custo (R$)"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#g2)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-10 text-[12px] text-[#697386]">
                Sem dados no período
              </div>
            )}
          </div>

          {/* Por agente + por modelo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card title="Por agente" icon={Bot}>
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
            </Card>
            <Card title="Por modelo" icon={Sparkles}>
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
            </Card>
          </div>

          {/* Top conversas */}
          <Card title={`Top ${topConv.length} conversas mais caras`} icon={TrendingUp}>
            <Table
              cols={["Conversa", "Contato", "Msgs", "Custo"]}
              rows={topConv.map((c) => [
                <span key="c" className="font-mono text-[11px] text-[#697386]">
                  #{c.conversation_id}
                </span>,
                <div key="ct">
                  <div className="text-[12px] text-[#1a2c44]">{c.contact_name || "—"}</div>
                  <div className="text-[10px] font-mono text-[#697386]">{c.external_id}</div>
                </div>,
                c.msg_count.toLocaleString("pt-BR"),
                <span key="cs" className="font-medium text-[#1a2c44]">
                  R$ {(c.cost_cents / 100).toFixed(2)}
                </span>,
              ])}
              emptyMsg="Sem conversas no período"
            />
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
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
    <div className="bg-white rounded-md p-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-md bg-[#003083]/[0.08] flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-[#003083]" />
        </div>
        <div className="text-[14px] font-medium text-slate-400">{label}</div>
      </div>
      <div className="text-[24px] font-semibold text-slate-900 leading-tight">{value}</div>
      {hint && <div className="text-[12px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-md p-5 shadow-[0_0_0_1px_rgb(226,232,240)]">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-3.5 h-3.5 text-[#697386]" />
        <h3 className="text-[14px] font-semibold text-[#1a2c44]">{title}</h3>
      </div>
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
    return <div className="text-center py-6 text-[12px] text-[#697386]">{emptyMsg}</div>;
  }
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            {cols.map((c, i) => (
              <th
                key={i}
                className={`px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386] ${
                  i === cols.length - 1 ? "text-right" : "text-left"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-5 py-2.5 text-[13px] text-[#1a2c44] ${
                    ci === row.length - 1 ? "text-right" : "text-left"
                  }`}
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
    <div className="bg-[#f4f7fa] rounded-lg p-12 text-center">
      <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
        <Zap className="w-6 h-6 text-[#003083]" />
      </div>
      <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">Sem métricas ainda</h3>
      <p className="text-[13px] text-[#697386]">
        Conecte um WhatsApp e mande mensagens pra ver custos e estatísticas aqui.
      </p>
    </div>
  );
}

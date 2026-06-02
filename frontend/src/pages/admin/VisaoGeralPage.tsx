import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, ShoppingCart, Wallet, Workflow } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells } from "@/components/ds/fc";

const FEATURES = [
  { icon: Headphones, title: "Atender", desc: "Responde clientes em qualquer canal, 24/7.", to: "/admin/conversas" },
  { icon: ShoppingCart, title: "Vender", desc: "Qualifica e fecha a venda dentro da conversa.", to: "/admin/playbooks", badge: "NOVO" },
  { icon: Wallet, title: "Cobrar", desc: "Gera Pix e link de pagamento no chat.", to: "/admin/cobranca" },
  { icon: Workflow, title: "Automatizar", desc: "Playbooks visuais que rodam sozinhos.", to: "/admin/playbooks" },
];

interface Report {
  empty?: boolean;
  total_conversas: number;
  por_status: Record<string, number>;
  handoffs: number;
  leads: number;
  sla_alertas: number;
  csat: { respostas: number; media: number | null };
  por_atendente: Record<string, number>;
}
interface DailyPoint { day: string; messages: number }

export default function VisaoGeralPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);

  useEffect(() => {
    api.get<Report>("/reports/atendimento", { params: { days: 7 } }).then(({ data }) => setRep(data)).catch(() => {});
    api.get<DailyPoint[]>("/metrics/daily", { params: { days: 7 } }).then(({ data }) => setDaily(data)).catch(() => {});
  }, []);

  const chartData = useMemo(() => daily.map((d) => ({ day: d.day.slice(5), Mensagens: d.messages })), [daily]);
  const ps = rep?.por_status || {};
  const total = rep?.total_conversas || 0;
  const resolPct = total > 0 ? Math.round(((ps.closed || 0) / total) * 100) : 0;
  const workload = Object.entries(rep?.por_atendente || {});
  const maxLoad = Math.max(1, ...workload.map(([, v]) => v));

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Visão geral</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>O que está acontecendo com seus agentes agora.</p>
          </div>
        </Row>

        {/* Atalhos */}
        <Row>
          <HairCells cols={4} gridLines>
            {FEATURES.map((f) => (
              <Link key={f.title} to={f.to} className={`block h-full p-6 transition-colors ${FC.hover}`}>
                <f.icon className={`w-4 h-4 ${FC.mut}`} />
                <div className="mt-3 flex items-center gap-2">
                  <span className={`text-[16px] font-normal leading-6 ${FC.ink}`}>{f.title}</span>
                  {f.badge && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-white bg-[#003083] dark:bg-[#5b9bff] dark:text-[#0c0e12]">{f.badge}</span>}
                </div>
                <p className={`mt-1 text-[13px] leading-[21px] ${FC.sub}`}>{f.desc}</p>
              </Link>
            ))}
          </HairCells>
        </Row>

        {/* KPI strip */}
        <Row>
          <HairCells cols={4}>
            <Kpi label="Conversas abertas" value={ps.active ?? total} />
            <Kpi label="Não atendidas" value={rep?.sla_alertas ?? 0} tone="warn" />
            <Kpi label="Resolvidas pela IA" value={`${resolPct}%`} tone="good" />
            <Kpi label="Aguardando humano" value={ps.handed_off ?? rep?.handoffs ?? 0} />
          </HairCells>
        </Row>

        {/* gráfico | carga por agente */}
        <Row last>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
            <div className={`relative p-6 lg:border-r ${FC.hair}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Conversas — últimos 7 dias</div>
                  <div className={`text-[12.5px] mt-0.5 ${FC.sub}`}>resolução pela IA: {resolPct}%</div>
                </div>
                <div className={`font-mono tabular-nums text-[26px] font-medium leading-none ${FC.ink}`}>{total.toLocaleString("pt-BR")}</div>
              </div>
              <div style={{ width: "100%", height: 150 }} className="mt-4">
                {chartData.length > 0 ? (
                  <ResponsiveContainer>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#003083" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#003083" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EDEDED" vertical={false} />
                      <XAxis dataKey="day" stroke="#9AA4B2" fontSize={11} axisLine={false} tickLine={false} />
                      <YAxis stroke="#9AA4B2" fontSize={11} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #EDEDED", borderRadius: 8, color: "#262626", fontSize: 12 }} />
                      <Area type="monotone" dataKey="Mensagens" stroke="#003083" strokeWidth={2} fill="url(#vg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className={`flex items-center justify-center h-full text-[12px] ${FC.mut}`}>Sem dados no período</div>
                )}
              </div>
            </div>
            <div className="relative p-6">
              <div className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Carga por agente</div>
              <div className={`text-[12.5px] mt-0.5 ${FC.sub}`}>Conversas no período</div>
              <div className="mt-4 space-y-3.5">
                {workload.length === 0 && <p className={`text-[12px] ${FC.mut}`}>Nenhuma conversa atribuída.</p>}
                {workload.map(([name, n]) => (
                  <div key={name}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className={`font-medium ${FC.ink}`}>{name}</span>
                      <span className={`font-mono tabular-nums ${FC.sub}`}>{n}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#262626]/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-[#003083] dark:bg-[#5b9bff]" style={{ width: `${(n / maxLoad) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" }) {
  return (
    <div className="px-6 py-5">
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${FC.mut}`}>{label}</div>
      <div
        className="mt-2 font-mono tabular-nums text-[28px] font-medium leading-none"
        style={{ color: tone === "good" ? "#0a8f5a" : tone === "warn" ? "#F5A300" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

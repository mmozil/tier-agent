import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, MessageSquare, ShoppingCart, Users, Wallet, Workflow } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, EmptyHint, SKEL } from "@/components/ds/fc";

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
interface OverviewLive {
  conversas: { em_aberto: number; sem_atendente: number; aguardando_humano: number; adiadas: number };
  atendentes: { online: number; total: number };
  heatmap: { days: { date: string; label: string }[]; cells: number[][]; max: number };
}

const HOUR_TICKS = [0, 4, 8, 12, 16, 20];

export default function VisaoGeralPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [live, setLive] = useState<OverviewLive | null>(null);

  useEffect(() => {
    api.get<Report>("/reports/atendimento", { params: { days: 7 } }).then(({ data }) => setRep(data)).catch(() => {});
    api.get<DailyPoint[]>("/metrics/daily", { params: { days: 7 } }).then(({ data }) => setDaily(data)).catch(() => {});
    api.get<OverviewLive>("/reports/overview-live").then(({ data }) => setLive(data)).catch(() => {});
  }, []);

  const chartData = useMemo(() => daily.map((d) => ({ day: d.day.slice(5), Mensagens: d.messages })), [daily]);
  const ps = rep?.por_status || {};
  const total = rep?.total_conversas || 0;
  const resolPct = total > 0 ? Math.round(((ps.closed || 0) / total) * 100) : 0;
  const workload = Object.entries(rep?.por_atendente || {});
  const maxLoad = Math.max(1, ...workload.map(([, v]) => v));

  const cv = live?.conversas;
  const at = live?.atendentes;
  const allOnline = at && at.total > 0 && at.online === at.total;

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

        {/* Status ao vivo (modelo Chatwoot Overview) */}
        <Row>
          <HairCells cols={4}>
            <Kpi label="Em aberto" value={cv?.em_aberto ?? ps.active ?? 0} dot="#003083" hint="Conversas ativas agora" />
            <Kpi label="Sem atendente" value={cv?.sem_atendente ?? 0} dot="#F5A300" tone="warn" hint="Aguardando atribuição" />
            <Kpi label="Aguardando humano" value={cv?.aguardando_humano ?? ps.handed_off ?? rep?.handoffs ?? 0} dot="#8b5cf6" hint="Handoff pendente" />
            <Kpi
              label="Atendentes online"
              value={at ? `${at.online}/${at.total}` : "—"}
              dot={allOnline ? "#0a8f5a" : "#9aa1ab"}
              tone={allOnline ? "good" : undefined}
              hint={cv?.adiadas ? `${cv.adiadas} adiada(s)` : "Disponíveis na fila"}
            />
          </HairCells>
        </Row>

        {/* gráfico | carga por agente */}
        <Row>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
            <div className={`relative p-6 lg:border-r ${FC.hair}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Conversas — últimos 7 dias</div>
                  <div className={`text-[12.5px] mt-0.5 ${FC.sub}`}>resolução pela IA: {resolPct}%</div>
                </div>
                <div className={`tabular-nums text-[26px] font-medium leading-none ${FC.ink}`}>{total.toLocaleString("pt-BR")}</div>
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
                  <EmptyHint
                    icon={MessageSquare}
                    text="Nenhuma conversa nos últimos 7 dias — o gráfico nasce no primeiro contato."
                    ctaLabel="Conectar canal"
                    ctaTo="/admin/canais"
                  />
                )}
              </div>
            </div>
            <div className="relative p-6">
              <div className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Carga por agente</div>
              <div className={`text-[12.5px] mt-0.5 ${FC.sub}`}>Conversas no período</div>
              <div className="mt-4 space-y-3.5">
                {workload.length === 0 && (
                  <EmptyHint icon={Users} text="Nenhuma conversa atribuída a atendentes." ctaLabel="Gerenciar equipe" ctaTo="/admin/equipe" />
                )}
                {workload.map(([name, n]) => (
                  <div key={name}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className={`font-medium ${FC.ink}`}>{name}</span>
                      <span className={`tabular-nums ${FC.sub}`}>{n}</span>
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

        {/* Heatmap de tráfego 7d × hora (modelo Chatwoot) */}
        <Row last>
          <div className="p-6">
            <div className="flex items-end justify-between">
              <div>
                <div className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Tráfego de conversas</div>
                <div className={`text-[12.5px] mt-0.5 ${FC.sub}`}>Horários de pico — últimos 7 dias × hora do dia</div>
              </div>
              {live && (
                <div className={`flex items-center gap-1.5 text-[11px] ${FC.sub}`}>
                  <span>menos</span>
                  <span className="inline-flex gap-0.5">
                    {[0.08, 0.3, 0.55, 0.8, 1].map((o) => (
                      <span key={o} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: `rgba(0,48,131,${o})` }} />
                    ))}
                  </span>
                  <span>mais</span>
                </div>
              )}
            </div>

            {live ? (
              <Heatmap data={live.heatmap} />
            ) : (
              // Skeleton ecoa a forma do heatmap (linhas × células), não um texto solto.
              <div className="mt-6 space-y-1.5" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                  <div key={r} className="flex items-center gap-1.5">
                    <div className={`h-3 w-9 shrink-0 ${SKEL}`} />
                    <div className="grid gap-[3px] flex-1" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                      {Array.from({ length: 24 }).map((_, c) => (
                        <div key={c} className={`aspect-square ${SKEL}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

function Heatmap({ data }: { data: OverviewLive["heatmap"] }) {
  const max = Math.max(1, data.max);
  return (
    <div className="mt-5 overflow-x-auto">
      <div className="min-w-[640px]">
        {/* eixo de horas */}
        <div className="grid items-center" style={{ gridTemplateColumns: "44px repeat(24, 1fr)" }}>
          <span />
          {Array.from({ length: 24 }).map((_, h) => (
            <span key={h} className={`text-center text-[9px] tabular-nums ${FC.mut}`}>
              {HOUR_TICKS.includes(h) ? `${h}h` : ""}
            </span>
          ))}
        </div>
        {/* linhas: 1 por dia */}
        {data.days.map((d, di) => (
          <div key={d.date} className="grid items-center mt-1" style={{ gridTemplateColumns: "44px repeat(24, 1fr)" }}>
            <span className={`text-[11px] font-medium ${FC.sub}`} title={d.date}>
              {d.label}
            </span>
            {data.cells[di].map((n, h) => {
              const o = n === 0 ? 0 : 0.12 + 0.88 * (n / max);
              return (
                <div key={h} className="px-[1.5px]">
                  <div
                    className="aspect-square w-full rounded-[3px]"
                    title={`${d.label} ${h}h · ${n} conversa${n === 1 ? "" : "s"}`}
                    style={{ backgroundColor: n === 0 ? "rgba(38,38,38,0.05)" : `rgba(0,48,131,${o})` }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  dot,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn";
  dot?: string;
  hint?: string;
}) {
  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-1.5">
        {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />}
        {/* label 11px: sub (56%) e não mut (40%) — texto pequeno precisa de contraste */}
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${FC.sub}`}>{label}</div>
      </div>
      <div
        className="mt-2 tabular-nums text-[28px] font-medium leading-none"
        style={{ color: tone === "good" ? "#0a8f5a" : tone === "warn" ? "#F5A300" : undefined }}
      >
        {value}
      </div>
      {hint && <div className={`mt-1.5 text-[11px] ${FC.sub}`}>{hint}</div>}
    </div>
  );
}

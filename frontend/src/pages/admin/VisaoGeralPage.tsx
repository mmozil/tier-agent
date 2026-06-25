import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MessageSquare, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, EmptyHint, SKEL } from "@/components/ds/fc";

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

interface DailyPoint {
  day: string;
  messages: number;
}

interface OverviewLive {
  conversas: { em_aberto: number; sem_atendente: number; aguardando_humano: number; adiadas: number };
  atendentes: { online: number; total: number };
  heatmap: { days: { date: string; label: string }[]; cells: number[][]; max: number };
}

const HOUR_TICKS = [0, 4, 8, 12, 16, 20];
// Tamanho Default do animate-ui (h-8 · 32px · px-3 · gap-1.5 · rounded-10) com fonte 12px.
const LINK_GHOST =
  `h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-medium ` +
  `transition-all active:scale-[0.98] ${FC.ink} ${FC.hover}`;

export default function VisaoGeralPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [repReady, setRepReady] = useState(false);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [dailyReady, setDailyReady] = useState(false);
  const [live, setLive] = useState<OverviewLive | null>(null);
  const [liveReady, setLiveReady] = useState(false);

  useEffect(() => {
    api
      .get<Report>("/reports/atendimento", { params: { days: 7 } })
      .then(({ data }) => setRep(data))
      .catch(() => {})
      .finally(() => setRepReady(true));

    api
      .get<DailyPoint[]>("/metrics/daily", { params: { days: 7 } })
      .then(({ data }) => setDaily(data))
      .catch(() => {})
      .finally(() => setDailyReady(true));

    api
      .get<OverviewLive>("/reports/overview-live")
      .then(({ data }) => setLive(data))
      .catch(() => {})
      .finally(() => setLiveReady(true));
  }, []);

  const chartData = useMemo(
    () => daily.map((point) => ({ day: point.day.slice(5), Mensagens: point.messages })),
    [daily],
  );
  const messagesTotal = useMemo(
    () => daily.reduce((sum, point) => sum + point.messages, 0),
    [daily],
  );

  const ps = rep?.por_status || {};
  const totalConversas = rep?.total_conversas || 0;
  const resolPct = totalConversas > 0 ? Math.round(((ps.closed || 0) / totalConversas) * 100) : 0;
  const workload = useMemo(
    () => Object.entries(rep?.por_atendente || {}).sort(([, left], [, right]) => right - left),
    [rep?.por_atendente],
  );
  const maxLoad = Math.max(1, ...workload.map(([, value]) => value));
  const totalAssigned = workload.reduce((sum, [, value]) => sum + value, 0);

  const cv = live?.conversas;
  const at = live?.atendentes;
  const allOnline = Boolean(at && at.total > 0 && at.online === at.total);
  const csatValue =
    rep?.csat.media == null
      ? "—"
      : `${rep.csat.media.toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}/5`;
  const csatTone =
    rep?.csat.media == null ? undefined : rep.csat.media >= 4.5 ? "good" : rep.csat.media < 4 ? "warn" : undefined;
  const humanWaiting = cv?.aguardando_humano ?? ps.handed_off ?? rep?.handoffs;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className={`text-[20px] font-[500] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>Visão geral</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.dim}`}>
                Pulso operacional dos agentes, filas e qualidade do atendimento.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/admin/conversas" className={LINK_GHOST}>
                Abrir conversas
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
              <Link to="/admin/canais" className={LINK_GHOST}>
                Conectar canal
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </Row>

        <Row>
          <HairCells cols={4}>
            <Kpi
              loading={!repReady}
              label="Conversas 7d"
              value={rep ? rep.total_conversas.toLocaleString("pt-BR") : "—"}
              dot="#003083"
              hint={rep ? `${messagesTotal.toLocaleString("pt-BR")} mensagens processadas` : "Volume consolidado do período"}
            />
            <Kpi
              loading={!repReady}
              label="Leads"
              value={rep ? rep.leads.toLocaleString("pt-BR") : "—"}
              dot="#0a8f5a"
              tone={rep && rep.leads > 0 ? "good" : undefined}
              hint={rep ? "Leads capturados para qualificação" : "Captação no período"}
            />
            <Kpi
              loading={!repReady}
              label="SLA em risco"
              value={rep ? rep.sla_alertas.toLocaleString("pt-BR") : "—"}
              dot={rep && rep.sla_alertas > 0 ? "#E5484D" : "#0a8f5a"}
              tone={rep?.sla_alertas ? "critical" : repReady ? "good" : undefined}
              hint={
                rep
                  ? rep.sla_alertas === 0
                    ? "Nenhum alerta no período"
                    : `${rep.sla_alertas} alerta(s) exigem atenção`
                  : "Risco operacional do atendimento"
              }
            />
            <Kpi
              loading={!repReady}
              label="CSAT"
              value={rep ? csatValue : "—"}
              dot="#8b5cf6"
              tone={csatTone}
              hint={
                rep
                  ? rep.csat.respostas > 0
                    ? `${rep.csat.respostas.toLocaleString("pt-BR")} resposta(s)`
                    : "Sem avaliações ainda"
                  : "Satisfação do cliente"
              }
            />
          </HairCells>
        </Row>

        <Row>
          <HairCells cols={4}>
            <Kpi
              loading={!liveReady && !repReady}
              label="Em aberto"
              value={cv?.em_aberto ?? ps.active ?? "—"}
              dot="#003083"
              hint={cv ? "Conversas ativas agora" : rep ? "Abertas no período recente" : "Fila atual"}
            />
            <Kpi
              loading={!liveReady}
              label="Sem atendente"
              value={cv?.sem_atendente ?? "—"}
              dot="#F5A300"
              tone={cv && cv.sem_atendente > 0 ? "warn" : undefined}
              hint={cv ? "Aguardando atribuição" : "Disponível quando a telemetria carregar"}
            />
            <Kpi
              loading={!liveReady && !repReady}
              label="Aguardando humano"
              value={humanWaiting ?? "—"}
              dot="#8b5cf6"
              hint={cv ? "Handoff pendente" : rep ? "Escaladas para atendimento humano" : "Transferências em aberto"}
            />
            <Kpi
              loading={!liveReady}
              label="Atendentes online"
              value={at ? `${at.online}/${at.total}` : "—"}
              dot={allOnline ? "#0a8f5a" : "#9aa1ab"}
              tone={allOnline ? "good" : undefined}
              hint={
                at
                  ? cv?.adiadas
                    ? `${cv.adiadas} adiada(s) na fila`
                    : at.total === 0
                      ? "Nenhum atendente cadastrado"
                      : "Disponíveis na fila"
                  : "Status de presença da equipe"
              }
            />
          </HairCells>
        </Row>

        <Row>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
            <div className={`relative p-6 lg:border-r ${FC.hair}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={`text-[20px] font-[500] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>Mensagens — últimos 7 dias</div>
                  <div className={`text-[13px] leading-5 mt-0.5 ${FC.dim}`}>
                    {repReady
                      ? `resolução pela IA: ${resolPct}%${rep?.handoffs ? ` · ${rep.handoffs} handoff(s)` : ""}`
                      : "Carregando ritmo de entrada"}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`tabular-nums text-[26px] font-medium leading-none ${FC.ink}`}>
                    {dailyReady ? messagesTotal.toLocaleString("pt-BR") : "—"}
                  </div>
                  <div className={`mt-1 text-[11px] ${FC.sub}`}>mensagens</div>
                </div>
              </div>

              <div style={{ width: "100%", height: 150 }} className="mt-4">
                {!dailyReady ? (
                  <div className="flex h-full items-end gap-2" aria-hidden>
                    {[32, 54, 44, 76, 58, 92, 68, 84, 60, 72, 48, 64].map((height, index) => (
                      <div key={index} className="flex-1">
                        <div className={`${SKEL} w-full rounded-[6px]`} style={{ height }} />
                      </div>
                    ))}
                  </div>
                ) : chartData.length > 0 ? (
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
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #EDEDED",
                          borderRadius: 8,
                          color: "#262626",
                          fontSize: 12,
                        }}
                      />
                      <Area type="monotone" dataKey="Mensagens" stroke="#003083" strokeWidth={2} fill="url(#vg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyHint
                    icon={MessageSquare}
                    text="Nenhuma mensagem nos últimos 7 dias — o gráfico nasce no primeiro contato."
                    ctaLabel="Conectar canal"
                    ctaTo="/admin/canais"
                  />
                )}
              </div>
            </div>

            <div className="relative p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={`text-[20px] font-[500] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>Carga por agente</div>
                  <div className={`text-[13px] leading-5 mt-0.5 ${FC.dim}`}>Distribuição do volume atribuído</div>
                </div>
                {repReady && workload.length > 0 && (
                  <div className="text-right">
                    <div className={`tabular-nums text-[18px] font-medium leading-none ${FC.ink}`}>
                      {totalAssigned.toLocaleString("pt-BR")}
                    </div>
                    <div className={`mt-1 text-[11px] ${FC.sub}`}>conversas atribuídas</div>
                  </div>
                )}
              </div>

              <div className={`mt-4 -mx-6 border-t ${FC.hair}`}>
                {!repReady && (
                  <div aria-hidden>
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className={`flex items-start justify-between gap-3 border-b px-6 py-3.5 ${FC.hair}`}>
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 h-3 w-5 ${SKEL}`} />
                          <div className={`h-7 w-7 rounded-full ${SKEL}`} />
                          <div>
                            <div className={`h-3.5 w-28 ${SKEL}`} />
                            <div className={`mt-2 h-3 w-20 ${SKEL}`} />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`ml-auto h-4 w-12 ${SKEL}`} />
                          <div className={`mt-2 ml-auto h-3 w-16 ${SKEL}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {repReady && workload.length === 0 && (
                  <EmptyHint
                    icon={Users}
                    text="Nenhuma conversa atribuída a atendentes."
                    ctaLabel="Gerenciar equipe"
                    ctaTo="/admin/equipe"
                  />
                )}

                {repReady &&
                  workload.map(([name, value], index) => {
                    const relativeShare = (value / maxLoad) * 100;
                    const volumeShare = totalAssigned > 0 ? Math.round((value / totalAssigned) * 100) : 0;

                    return (
                      <div key={name} className={`relative overflow-hidden border-b px-6 py-3.5 last:border-b-0 ${FC.hair}`}>
                        <div
                          className="pointer-events-none absolute inset-y-3 left-0 rounded-r-[10px] border border-[#003083]/[0.06] bg-[linear-gradient(90deg,rgba(0,48,131,0.08),rgba(0,48,131,0.03))] transition-[width] duration-300 motion-reduce:transition-none dark:border-[#5b9bff]/[0.10] dark:bg-[linear-gradient(90deg,rgba(91,155,255,0.18),rgba(91,155,255,0.06))]"
                          style={{ width: `max(${relativeShare.toFixed(2)}%, 72px)` }}
                        />
                        <div className="relative flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <div className={`w-7 pt-0.5 text-[11px] tabular-nums ${FC.mut}`}>
                              {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#003083]/[0.08] text-[11px] font-medium text-[#003083] dark:bg-[#5b9bff]/[0.12] dark:text-[#8db9ff]">
                                  {getInitials(name)}
                                </span>
                                <span className={`truncate text-[13px] font-medium ${FC.ink}`}>{name}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                                <span className={FC.sub}>{volumeShare}% do volume</span>
                                {index === 0 && workload.length > 1 && (
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${FC.hair} ${FC.sub}`}>
                                    maior fila
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="pl-3 text-right">
                            <div className={`tabular-nums text-[18px] font-medium leading-none ${FC.ink}`}>{value}</div>
                            <div className={`mt-1 text-[11px] ${FC.sub}`}>conversas</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </Row>

        <Row last>
          <div className="p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className={`text-[20px] font-[500] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>Tráfego de conversas</div>
                <div className={`text-[13px] leading-5 mt-0.5 ${FC.dim}`}>Horários de pico — últimos 7 dias × hora do dia</div>
              </div>
              {live && (
                <div className={`flex items-center gap-1.5 text-[11px] ${FC.sub}`}>
                  <span>menos</span>
                  <span className="inline-flex gap-0.5">
                    {[0.08, 0.3, 0.55, 0.8, 1].map((opacity) => (
                      <span
                        key={opacity}
                        className="w-3 h-3 rounded-[3px]"
                        style={{ backgroundColor: `rgba(0,48,131,${opacity})` }}
                      />
                    ))}
                  </span>
                  <span>mais</span>
                </div>
              )}
            </div>

            {!liveReady ? (
              <div className="mt-6 space-y-1.5" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                  <div key={row} className="flex items-center gap-1.5">
                    <div className={`h-3 w-9 shrink-0 ${SKEL}`} />
                    <div className="grid gap-[3px] flex-1" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                      {Array.from({ length: 24 }).map((_, col) => (
                        <div key={col} className={`aspect-square ${SKEL}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : live ? (
              <Heatmap data={live.heatmap} />
            ) : (
              <EmptyHint icon={MessageSquare} text="Não foi possível carregar o mapa de tráfego agora." />
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
        <div className="grid items-center" style={{ gridTemplateColumns: "44px repeat(24, 1fr)" }}>
          <span />
          {Array.from({ length: 24 }).map((_, hour) => (
            <span key={hour} className={`text-center text-[9px] tabular-nums ${FC.mut}`}>
              {HOUR_TICKS.includes(hour) ? `${hour}h` : ""}
            </span>
          ))}
        </div>

        {data.days.map((day, dayIndex) => (
          <div key={day.date} className="grid items-center mt-1" style={{ gridTemplateColumns: "44px repeat(24, 1fr)" }}>
            <span className={`text-[11px] font-medium ${FC.sub}`} title={day.date}>
              {day.label}
            </span>
            {data.cells[dayIndex].map((count, hour) => {
              const opacity = count === 0 ? 0 : 0.12 + 0.88 * (count / max);

              return (
                <div key={hour} className="px-[1.5px]">
                  <div
                    className="aspect-square w-full rounded-[3px]"
                    title={`${day.label} ${hour}h · ${count} conversa${count === 1 ? "" : "s"}`}
                    style={{
                      backgroundColor: count === 0 ? "rgba(38,38,38,0.05)" : `rgba(0,48,131,${opacity})`,
                    }}
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
  loading = false,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn" | "critical";
  dot?: string;
  hint?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="px-6 py-5" aria-hidden>
        <div className={`h-3 w-24 ${SKEL}`} />
        <div className={`mt-3 h-8 w-20 ${SKEL}`} />
        <div className={`mt-2 h-3 w-28 ${SKEL}`} />
      </div>
    );
  }

  const valueColor =
    tone === "good" ? "#0a8f5a" : tone === "warn" ? "#F5A300" : tone === "critical" ? "#E5484D" : undefined;

  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-1.5">
        {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />}
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${FC.sub}`}>{label}</div>
      </div>
      <div className="mt-2 tabular-nums text-[28px] font-medium leading-none" style={{ color: valueColor }}>
        {value}
      </div>
      {hint && <div className={`mt-1.5 text-[11px] ${FC.sub}`}>{hint}</div>}
    </div>
  );
}

function getInitials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "");

  return letters.join("") || "—";
}

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BarChart3, RefreshCw, MessageSquare, Hand, Flame, Clock, Star } from "lucide-react";

import { api } from "@/lib/api";

interface Report {
  days: number;
  empty?: boolean;
  total_conversas: number;
  por_status: Record<string, number>;
  handoffs: number;
  leads: number;
  sla_alertas: number;
  csat: { respostas: number; media: number | null; distribuicao: Record<string, number> };
  por_etiqueta: Record<string, number>;
  por_atendente: Record<string, number>;
}

const STATUS_LABEL: Record<string, string> = {
  active: "IA ativa",
  handed_off: "Humano",
  closed: "Resolvidas",
};

function Kpi({ icon: Icon, label, value, tint }: { icon: any; label: string; value: string | number; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center ${tint}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[12px] text-slate-500">{label}</span>
      </div>
      <div className="text-[24px] font-bold text-[#30313d]">{value}</div>
    </div>
  );
}

export default function RelatoriosAtendimentoPage() {
  const [data, setData] = useState<Report | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  async function load(d = days) {
    setLoading(true);
    try {
      const { data } = await api.get<Report>("/reports/atendimento", { params: { days: d } });
      setData(data);
    } catch {
      toast.error("Falha ao carregar relatório");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxTag = data ? Math.max(1, ...Object.values(data.por_etiqueta || {})) : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Relatórios de atendimento</h1>
          <p className="text-[13px] text-slate-500 mt-1">Volume, handoffs, satisfação e etiquetas no período.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => {
              const d = parseInt(e.target.value, 10);
              setDays(d);
              load(d);
            }}
            className="h-7 px-2 text-[13px] rounded-md border border-slate-200 outline-none"
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button onClick={() => load()} className="h-7 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>
      </div>

      {loading && <div className="text-[13px] text-slate-400 py-8 text-center">Carregando...</div>}

      {!loading && data?.empty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">Sem dados ainda neste período.</p>
        </div>
      )}

      {!loading && data && !data.empty && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi icon={MessageSquare} label="Conversas" value={data.total_conversas} tint="bg-[#003083]/[0.08] text-[#003083]" />
            <Kpi icon={Hand} label="Handoffs" value={data.handoffs} tint="bg-blue-50 text-blue-600" />
            <Kpi icon={Flame} label="Leads" value={data.leads} tint="bg-emerald-50 text-emerald-600" />
            <Kpi icon={Clock} label="Alertas SLA" value={data.sla_alertas} tint="bg-rose-50 text-rose-600" />
            <Kpi
              icon={Star}
              label={`CSAT (${data.csat.respostas})`}
              value={data.csat.media != null ? `${data.csat.media}/5` : "—"}
              tint="bg-amber-50 text-amber-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Por status</h3>
              <div className="space-y-2">
                {Object.entries(data.por_status).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[13px]">
                    <span className="text-slate-600">{STATUS_LABEL[k] || k}</span>
                    <span className="font-semibold text-slate-800">{v}</span>
                  </div>
                ))}
                {Object.keys(data.por_status).length === 0 && <p className="text-[12px] text-slate-400">—</p>}
              </div>
            </div>

            {/* CSAT distribuição */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Notas de satisfação</h3>
              {data.csat.respostas === 0 ? (
                <p className="text-[12px] text-slate-400">Nenhuma avaliação ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {[5, 4, 3, 2, 1, 0].map((n) => {
                    const v = data.csat.distribuicao[String(n)] || 0;
                    const pct = data.csat.respostas ? (v / data.csat.respostas) * 100 : 0;
                    return (
                      <div key={n} className="flex items-center gap-2 text-[12px]">
                        <span className="w-8 text-slate-500">{n}⭐</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-6 text-right text-slate-600">{v}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Etiquetas */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Por etiqueta</h3>
              {Object.keys(data.por_etiqueta).length === 0 ? (
                <p className="text-[12px] text-slate-400">Nenhuma etiqueta usada.</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(data.por_etiqueta).map(([t, v]) => (
                    <div key={t} className="flex items-center gap-2 text-[12px]">
                      <span className="w-24 truncate text-[#003083]">#{t}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#003083]" style={{ width: `${(v / maxTag) * 100}%` }} />
                      </div>
                      <span className="w-6 text-right text-slate-600">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Atendentes */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Por atendente</h3>
              {Object.keys(data.por_atendente).length === 0 ? (
                <p className="text-[12px] text-slate-400">Nenhuma conversa atribuída.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(data.por_atendente).map(([a, v]) => (
                    <div key={a} className="flex items-center justify-between text-[13px]">
                      <span className="text-slate-600">{a}</span>
                      <span className="font-semibold text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

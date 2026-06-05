import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BarChart3, RefreshCw, MessageSquare, Hand, Flame, Clock, Star } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button } from "@/components/ds/fc";

interface Report {
  days: number;
  empty?: boolean;
  total_conversas: number;
  deflection?: {
    total_conversas: number;
    precisaram_humano: number;
    resolvidas_pela_ia: number;
    taxa: number | null;
  };
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

function Kpi({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className={`text-[12px] ${FC.sub}`}>{label}</span>
      </div>
      <div className={`font-mono tabular-nums text-[24px] font-medium ${FC.ink}`}>{value}</div>
    </div>
  );
}

function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6">
      <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-3 ${FC.ink}`}>{title}</h3>
      {children}
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
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Relatórios de atendimento</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Volume, handoffs, satisfação e etiquetas no período.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={days}
                onChange={(e) => {
                  const d = parseInt(e.target.value, 10);
                  setDays(d);
                  load(d);
                }}
                className={`h-8 px-2.5 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`}
              >
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
              <Button variant="secondary" onClick={() => load()}>
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar
              </Button>
            </div>
          </div>
        </Row>

        {loading ? (
          <Row last>
            <div className={`text-[13px] py-12 text-center ${FC.mut}`}>Carregando...</div>
          </Row>
        ) : data?.empty ? (
          <Row last>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className={`w-10 h-10 mb-3 ${FC.mut}`} />
              <p className={`text-[14px] ${FC.sub}`}>Sem dados ainda neste período.</p>
            </div>
          </Row>
        ) : data ? (
          <>
            {/* Deflection — o número que prova a IA */}
            {data.deflection && (
              <Row>
                <div className="flex items-center gap-6 p-6">
                  <div className="shrink-0">
                    <div className={`text-[40px] font-[450] leading-none tracking-[-1px] ${data.deflection.taxa != null && data.deflection.taxa >= 0.5 ? "text-[#0a8f5a]" : FC.ink}`}>
                      {data.deflection.taxa != null ? `${Math.round(data.deflection.taxa * 100)}%` : "—"}
                    </div>
                    <div className={`text-[12px] mt-1 ${FC.sub}`}>resolvido pela IA</div>
                  </div>
                  <div className={`h-12 w-px ${FC.hairBg}`} />
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    <div>
                      <div className={`text-[20px] font-mono font-medium ${FC.ink}`}>{data.deflection.resolvidas_pela_ia}</div>
                      <div className={`text-[12px] ${FC.mut}`}>sem humano</div>
                    </div>
                    <div>
                      <div className={`text-[20px] font-mono font-medium ${FC.ink}`}>{data.deflection.precisaram_humano}</div>
                      <div className={`text-[12px] ${FC.mut}`}>precisaram de humano</div>
                    </div>
                    <div>
                      <div className={`text-[20px] font-mono font-medium ${FC.ink}`}>{data.deflection.total_conversas}</div>
                      <div className={`text-[12px] ${FC.mut}`}>total de conversas</div>
                    </div>
                  </div>
                </div>
              </Row>
            )}
            <Row>
              <HairCells cols={5}>
                <Kpi icon={MessageSquare} label="Conversas" value={data.total_conversas} color="#003083" />
                <Kpi icon={Hand} label="Handoffs" value={data.handoffs} color="#003083" />
                <Kpi icon={Flame} label="Leads" value={data.leads} color="#0a8f5a" />
                <Kpi icon={Clock} label="Alertas SLA" value={data.sla_alertas} color="#E5484D" />
                <Kpi
                  icon={Star}
                  label={`CSAT (${data.csat.respostas})`}
                  value={data.csat.media != null ? `${data.csat.media}/5` : "—"}
                  color="#F5A300"
                />
              </HairCells>
            </Row>

            <Row last>
              <HairCells cols={2} gridLines>
                <SubCard title="Por status">
                  <div className="space-y-2">
                    {Object.entries(data.por_status).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-[13px]">
                        <span className={FC.sub}>{STATUS_LABEL[k] || k}</span>
                        <span className={`font-medium ${FC.ink}`}>{v}</span>
                      </div>
                    ))}
                    {Object.keys(data.por_status).length === 0 && <p className={`text-[12px] ${FC.mut}`}>—</p>}
                  </div>
                </SubCard>

                <SubCard title="Notas de satisfação">
                  {data.csat.respostas === 0 ? (
                    <p className={`text-[12px] ${FC.mut}`}>Nenhuma avaliação ainda.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {[5, 4, 3, 2, 1, 0].map((n) => {
                        const v = data.csat.distribuicao[String(n)] || 0;
                        const pct = data.csat.respostas ? (v / data.csat.respostas) * 100 : 0;
                        return (
                          <div key={n} className="flex items-center gap-2 text-[12px]">
                            <span className={`w-8 ${FC.sub}`}>{n}⭐</span>
                            <div className="flex-1 h-2 bg-[#262626]/[0.06] rounded-full overflow-hidden">
                              <div className="h-full bg-[#F5A300]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`w-6 text-right ${FC.sub}`}>{v}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SubCard>

                <SubCard title="Por etiqueta">
                  {Object.keys(data.por_etiqueta).length === 0 ? (
                    <p className={`text-[12px] ${FC.mut}`}>Nenhuma etiqueta usada.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(data.por_etiqueta).map(([t, v]) => (
                        <div key={t} className="flex items-center gap-2 text-[12px]">
                          <span className="w-24 truncate text-[#003083] dark:text-[#5b9bff]">#{t}</span>
                          <div className="flex-1 h-2 bg-[#262626]/[0.06] rounded-full overflow-hidden">
                            <div className="h-full bg-[#003083] dark:bg-[#5b9bff]" style={{ width: `${(v / maxTag) * 100}%` }} />
                          </div>
                          <span className={`w-6 text-right ${FC.sub}`}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </SubCard>

                <SubCard title="Por atendente">
                  {Object.keys(data.por_atendente).length === 0 ? (
                    <p className={`text-[12px] ${FC.mut}`}>Nenhuma conversa atribuída.</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(data.por_atendente).map(([a, v]) => (
                        <div key={a} className="flex items-center justify-between text-[13px]">
                          <span className={FC.sub}>{a}</span>
                          <span className={`font-medium ${FC.ink}`}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </SubCard>
              </HairCells>
            </Row>
          </>
        ) : null}
      </PageFrame>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { History, ShieldAlert } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { FC, PageFrame, PageHero, Row, Button, EmptyHint, SkeletonBar, Select, SegToggle, Interruptor, Input } from "@/components/ds/fc";

// Registro de atividades (11/11/2026) — quem fez o quê, quando e de onde.
// Nasceu do CCDA: o número de teste foi removido às 11:20 e ninguém sabia quem.

interface Atividade {
  id: number;
  quando: string | null;
  quem: string;
  papel: string | null;
  acao: string;
  alvo: string | null;
  ok: boolean;
  status: number | null;
  ip: string | null;
  navegador: string | null;
}
interface Resposta {
  atividades: Atividade[];
  tem_mais: boolean;
  pessoas: { quem: string; acoes: number }[];
}

const POR_PAGINA = 200;
const FUSO = "America/Sao_Paulo";
const TODOS = "__todos__";

function dia(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "2-digit" });
}
function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function papelLegivel(p: string | null) {
  return p === "owner" ? "Dono" : p === "admin" ? "Administrador" : p === "atendente" ? "Atendente" : null;
}

export default function AtividadesPage() {
  const { user } = useAuth();
  const gestor = !!user?.is_admin || ["owner", "admin"].includes(user?.role ?? "owner");
  const [dias, setDias] = useState(7);
  const [quem, setQuem] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [soRecusadas, setSoRecusadas] = useState(false);
  const [linhas, setLinhas] = useState<Atividade[]>([]);
  const [pessoas, setPessoas] = useState<Resposta["pessoas"]>([]);
  const [temMais, setTemMais] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(pag: number) {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await api.get<Resposta>("/atividades", {
        params: {
          dias,
          quem: quem === TODOS ? undefined : quem,
          busca: buscaAplicada || undefined,
          so_recusadas: soRecusadas || undefined,
          limite: POR_PAGINA,
          pagina: pag,
        },
      });
      setLinhas((ant) => (pag === 0 ? data.atividades : [...ant, ...data.atividades]));
      setPessoas(data.pessoas);
      setTemMais(data.tem_mais);
      setPagina(pag);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Não foi possível carregar o registro.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (gestor) carregar(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias, quem, buscaAplicada, soRecusadas, gestor]);

  // A busca vale ao parar de digitar — não a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  const grupos = useMemo(() => {
    const out: { dia: string; itens: Atividade[] }[] = [];
    for (const l of linhas) {
      const d = l.quando ? dia(l.quando) : "—";
      if (!out.length || out[out.length - 1].dia !== d) out.push({ dia: d, itens: [] });
      out[out.length - 1].itens.push(l);
    }
    return out;
  }, [linhas]);

  const opcoesPessoa = [
    { value: TODOS, label: "Todas as pessoas" },
    ...pessoas.map((p) => ({ value: p.quem, label: `${p.quem} · ${p.acoes}` })),
  ];

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Registro de atividades"
          subtitle={
            <>
              Tudo o que cada pessoa fez no sistema: quem, o quê, quando e de onde. O conteúdo das mensagens não entra aqui — só a ação.
            </>
          }
        />

        {!gestor ? (
          <Row last>
            <EmptyHint icon={ShieldAlert} text="Só o dono da conta e os administradores veem o registro de atividades." className="py-10" />
          </Row>
        ) : (
          <>
            <Row>
              <div className="flex flex-wrap items-center gap-3 px-6 py-4">
                <SegToggle
                  value={dias}
                  onChange={setDias}
                  options={[
                    { value: 1, label: "Hoje" },
                    { value: 7, label: "7 dias" },
                    { value: 30, label: "30 dias" },
                    { value: 90, label: "90 dias" },
                  ]}
                />
                <Select value={quem} options={opcoesPessoa} onChange={setQuem} className="w-[240px]" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar ação, número, conversa…"
                  className="!w-[260px]"
                />
                <label className={`flex items-center gap-2 text-[12.5px] ${FC.sub}`}>
                  <Interruptor ligado={soRecusadas} onChange={setSoRecusadas} label="Só as recusadas" />
                  Só as recusadas
                </label>
              </div>
            </Row>

            <Row last>
              {erro ? (
                <EmptyHint icon={ShieldAlert} text={erro} className="py-10" />
              ) : carregando && linhas.length === 0 ? (
                <div className={`divide-y ${FC.hair}`}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-3">
                      <SkeletonBar className="h-3 w-16" />
                      <SkeletonBar className="h-3.5 w-40" />
                      <SkeletonBar className="h-3 w-56" />
                    </div>
                  ))}
                </div>
              ) : linhas.length === 0 ? (
                <EmptyHint icon={History} text="Nenhuma ação neste período." className="py-10" />
              ) : (
                <div>
                  {grupos.map((g) => (
                    <div key={g.dia}>
                      <div className={`px-6 py-2 text-[11px] font-medium uppercase tracking-[0.06em] border-b ${FC.hair} ${FC.mut} ${FC.base}`}>
                        {g.dia}
                      </div>
                      <div className={`divide-y ${FC.hair}`}>
                        {g.itens.map((a) => (
                          <div key={a.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-start gap-4 px-6 py-3">
                            <span className={`text-[12.5px] tabular-nums pt-px ${FC.sub}`}>{a.quando ? hora(a.quando) : "—"}</span>
                            <div className="min-w-0">
                              <div className={`text-[13.5px] ${FC.ink}`}>
                                <span className="font-medium">{a.quem}</span>
                                {papelLegivel(a.papel) && <span className={`text-[12px] ${FC.mut}`}> · {papelLegivel(a.papel)}</span>}
                              </div>
                              <div className={`text-[13px] mt-0.5 ${FC.dim}`}>
                                {a.acao}
                                {a.alvo && <span className={FC.sub}> — {a.alvo}</span>}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-right">
                              {!a.ok && (
                                <span className="inline-flex items-center h-5 px-2 rounded-full text-[11px] font-medium bg-[#c0362c]/[0.08] text-[#c0362c] dark:bg-[#ff6b5e]/[0.12] dark:text-[#ff6b5e]">
                                  Recusado{a.status ? ` · ${a.status}` : ""}
                                </span>
                              )}
                              {(a.ip || a.navegador) && (
                                <span className={`text-[11.5px] ${FC.mut}`}>
                                  {[a.navegador, a.ip].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {temMais && (
                    <div className={`flex justify-center px-6 py-4 border-t ${FC.hair}`}>
                      <Button variant="secondary" onClick={() => carregar(pagina + 1)} disabled={carregando}>
                        {carregando ? "Carregando…" : "Carregar mais"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Row>
          </>
        )}
      </PageFrame>
    </div>
  );
}

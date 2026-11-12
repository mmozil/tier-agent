import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check, Pencil, Plus, Tag, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { FC, PageFrame, PageHero, Row, Button, EmptyHint, SkeletonBar, iconBtn } from "@/components/ds/fc";
import type { Etiqueta } from "@/components/inbox/Etiquetas";

// Etiquetas da conta (12/11/2026, pedido do CCDA): a lista que a equipe ESCOLHE na conversa, no
// padrão do Chatwoot — nome, cor, descrição e se aparece na lateral. Só dono e administrador mudam
// (o servidor recusa o resto); a equipe vê a lista.

const CORES = [
  "#E5484D", "#F76B15", "#FFC53D", "#30A46C", "#12A594", "#0090FF",
  "#3E63DD", "#8E4EC6", "#D6409F", "#8D8D86", "#17191A", "#003083",
];

interface Form {
  id: number | null;
  nome: string;
  descricao: string;
  cor: string;
  na_lateral: boolean;
}
const VAZIO: Form = { id: null, nome: "", descricao: "", cor: CORES[5], na_lateral: true };

export default function EtiquetasPage() {
  const { user } = useAuth();
  const gestor = !!user?.is_admin || ["owner", "admin"].includes(user?.role ?? "owner");
  const [lista, setLista] = useState<Etiqueta[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Etiqueta[]>("/etiquetas");
      setLista(data || []);
    } catch {
      toast.error("Falha ao carregar as etiquetas");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const erro = (e: unknown, padrao: string) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    toast.error(typeof detail === "string" ? detail : padrao);
  };

  async function salvar() {
    if (!form) return;
    if (!form.nome.trim()) return toast.error("Dê um nome à etiqueta");
    setSalvando(true);
    const corpo = { nome: form.nome, descricao: form.descricao, cor: form.cor, na_lateral: form.na_lateral };
    try {
      if (form.id) {
        const { data } = await api.patch<Etiqueta & { conversas_renomeadas?: number }>(`/etiquetas/${form.id}`, corpo);
        toast.success(
          data?.conversas_renomeadas ? `Etiqueta salva · ${data.conversas_renomeadas} conversa(s) com o nome novo` : "Etiqueta salva",
        );
      } else {
        await api.post("/etiquetas", corpo);
        toast.success("Etiqueta criada");
      }
      setForm(null);
      load();
    } catch (e) {
      erro(e, "Erro ao salvar a etiqueta");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(e: Etiqueta) {
    if (!confirm(`Tirar «${e.nome}» da lista? As conversas que já têm essa etiqueta continuam com ela.`)) return;
    try {
      await api.delete(`/etiquetas/${e.id}`);
      load();
    } catch (err) {
      erro(err, "Erro ao apagar a etiqueta");
    }
  }

  const input = `h-8 px-3 text-[13px] rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} ${FC.ink} outline-none focus:shadow-[0_0_0_2px_#003083]`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Etiquetas"
          subtitle={
            <>
              A lista que a equipe escolhe no painel da conversa, como no Chatwoot. Mudar o nome leva o nome novo para todas as
              conversas que já tinham a etiqueta.
            </>
          }
          right={
            gestor ? (
              <Button variant="primary" onClick={() => setForm(form ? null : { ...VAZIO })} className="shrink-0">
                <Plus className="w-3.5 h-3.5" /> Nova etiqueta
              </Button>
            ) : undefined
          }
        />

        {form && (
          <Row>
            <div className="p-6 space-y-4 max-w-[640px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Nome</span>
                  <input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    placeholder="ex.: visita-agendada"
                    maxLength={40}
                    className={`${input} w-full mt-1`}
                  />
                  <span className={`block mt-1 text-[11px] ${FC.mut}`}>Fica em minúsculas, e espaço vira hífen.</span>
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Descrição (opcional)</span>
                  <input
                    value={form.descricao}
                    onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                    placeholder="Quando usar esta etiqueta"
                    maxLength={200}
                    className={`${input} w-full mt-1`}
                  />
                </label>
              </div>
              <div>
                <span className={`text-[12px] ${FC.sub}`}>Cor</span>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {CORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, cor: c })}
                      aria-label={`Cor ${c}`}
                      className="w-7 h-7 rounded-full inline-flex items-center justify-center ring-offset-2 ring-offset-white dark:ring-offset-[#0c0e12]"
                      style={{ background: c, boxShadow: form.cor.toUpperCase() === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : undefined }}
                    >
                      {form.cor.toUpperCase() === c && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                    </button>
                  ))}
                  <label className={`h-7 pl-1 pr-2.5 inline-flex items-center gap-1.5 rounded-full border ${FC.hair} text-[12px] ${FC.sub} cursor-pointer`}>
                    <input
                      type="color"
                      value={form.cor}
                      onChange={(e) => setForm({ ...form, cor: e.target.value.toUpperCase() })}
                      className="w-5 h-5 rounded-full border-0 p-0 bg-transparent cursor-pointer"
                    />
                    Outra cor
                  </label>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.na_lateral}
                  onChange={(e) => setForm({ ...form, na_lateral: e.target.checked })}
                  className="w-4 h-4 accent-[#003083]"
                />
                <span className={`text-[13px] ${FC.ink}`}>Mostrar na lateral das conversas (para filtrar)</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
                <Button variant="primary" onClick={salvar} disabled={salvando}>
                  {form.id ? "Salvar" : "Criar etiqueta"}
                </Button>
              </div>
            </div>
          </Row>
        )}

        <Row last>
          <div className={`divide-y ${FC.hair}`}>
            {loading &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3">
                  <SkeletonBar className="w-3 h-3 rounded-full shrink-0" />
                  <SkeletonBar className="h-3.5 w-48" />
                </div>
              ))}
            {!loading && lista.length === 0 && (
              <EmptyHint
                icon={Tag}
                text={gestor ? "Nenhuma etiqueta ainda — crie a primeira para a equipe escolher na conversa." : "Nenhuma etiqueta na lista da conta."}
                className="py-10"
              />
            )}
            {!loading &&
              lista.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-6 py-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: e.cor }} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[14px] font-medium ${FC.ink}`}>{e.nome}</div>
                    {e.descricao && <div className={`text-[12px] truncate ${FC.sub}`}>{e.descricao}</div>}
                  </div>
                  {!e.na_lateral && <span className={`text-[11.5px] ${FC.mut}`}>fora da lateral</span>}
                  {gestor && (
                    <>
                      <button
                        onClick={() =>
                          setForm({ id: e.id, nome: e.nome, descricao: e.descricao || "", cor: e.cor, na_lateral: e.na_lateral })
                        }
                        className={iconBtn}
                        title="Editar etiqueta"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => apagar(e)} className={iconBtn} title="Tirar da lista">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

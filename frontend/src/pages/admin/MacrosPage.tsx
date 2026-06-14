import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Zap, Tag, UserCheck, MessageSquare, CheckCircle2, X } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button, EmptyHint, SkeletonBar } from "@/components/ds/fc";

type ActionType = "tag" | "assign" | "reply" | "status";
interface MAction {
  type: ActionType;
  value?: string;
  member_id?: number | null;
  content?: string;
}
interface Macro {
  id: number;
  name: string;
  actions: MAction[];
}
interface Member {
  id: number;
  nome: string;
}

const TYPE_META: Record<ActionType, { label: string; icon: any; color: string }> = {
  tag: { label: "Etiqueta", icon: Tag, color: "#8b5cf6" },
  assign: { label: "Atribuir", icon: UserCheck, color: "#003083" },
  reply: { label: "Responder", icon: MessageSquare, color: "#0a8f5a" },
  status: { label: "Status", icon: CheckCircle2, color: "#dc6803" },
};

export default function MacrosPage() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [actions, setActions] = useState<MAction[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [m, mem] = await Promise.all([
        api.get<Macro[]>("/macros"),
        api.get<Member[]>("/team/members").catch(() => ({ data: [] as Member[] })),
      ]);
      setMacros(m.data);
      setMembers(mem.data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function addAction(type: ActionType) {
    setActions((a) => [...a, type === "status" ? { type, value: "resolve" } : { type }]);
  }
  function setAction(i: number, patch: Partial<MAction>) {
    setActions((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeAction(i: number) {
    setActions((a) => a.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) return toast.error("Dê um nome à macro");
    if (actions.length === 0) return toast.error("Adicione ao menos uma ação");
    try {
      await api.post("/macros", { name, actions });
      toast.success("Macro criada");
      setName("");
      setActions([]);
      setShowForm(false);
      load();
    } catch {
      toast.error("Erro ao salvar");
    }
  }

  async function remove(id: number) {
    if (!confirm("Deletar esta macro?")) return;
    try {
      await api.delete(`/macros/${id}`);
      load();
    } catch {
      toast.error("Erro ao deletar");
    }
  }

  const input = `h-8 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;

  function summary(a: MAction): string {
    if (a.type === "tag") return `#${a.value || "?"}`;
    if (a.type === "assign") return members.find((m) => m.id === a.member_id)?.nome || "ninguém";
    if (a.type === "reply") return `"${(a.content || "").slice(0, 30)}…"`;
    if (a.type === "status") return a.value === "resolve" ? "resolver" : a.value === "handoff" ? "passar p/ humano" : "devolver à IA";
    return "";
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Macros</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Atalhos do atendente: 1 clique executa uma sequência (etiqueta + atribuir + responder + status). Aplica na conversa pelo botão <b>Macros</b> no painel.
              </p>
            </div>
            <Button variant="primary" onClick={() => setShowForm(!showForm)} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> Nova macro
            </Button>
          </div>
        </Row>

        {showForm && (
          <Row>
            <div className="p-6 space-y-4">
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Nome da macro</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Reembolso, Encaminhar fiscal…" className={`${input} w-full mt-1`} />
              </label>

              <div>
                <span className={`text-[12px] ${FC.sub}`}>Ações (executadas em ordem)</span>
                <div className="mt-2 space-y-2">
                  {actions.map((a, i) => {
                    const M = TYPE_META[a.type];
                    return (
                      <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${FC.hair}`}>
                        <M.icon className="w-4 h-4 shrink-0" style={{ color: M.color }} />
                        <span className={`text-[12px] w-16 shrink-0 ${FC.sub}`}>{M.label}</span>
                        {a.type === "tag" && (
                          <input value={a.value || ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="etiqueta" className={`${input} flex-1`} />
                        )}
                        {a.type === "assign" && (
                          <select value={a.member_id ?? ""} onChange={(e) => setAction(i, { member_id: e.target.value ? Number(e.target.value) : null })} className={`${input} flex-1`}>
                            <option value="">— ninguém —</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>{m.nome}</option>
                            ))}
                          </select>
                        )}
                        {a.type === "reply" && (
                          <input value={a.content || ""} onChange={(e) => setAction(i, { content: e.target.value })} placeholder="mensagem ao cliente" className={`${input} flex-1`} />
                        )}
                        {a.type === "status" && (
                          <select value={a.value || "resolve"} onChange={(e) => setAction(i, { value: e.target.value })} className={`${input} flex-1`}>
                            <option value="resolve">Resolver</option>
                            <option value="handoff">Passar para humano</option>
                            <option value="resume">Devolver à IA</option>
                          </select>
                        )}
                        <button onClick={() => removeAction(i)} className={`p-1 rounded ${FC.mut} hover:text-[#E5484D]`}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {(Object.keys(TYPE_META) as ActionType[]).map((t) => {
                    const M = TYPE_META[t];
                    return (
                      <button key={t} onClick={() => addAction(t)} className={`h-7 px-2.5 text-[12px] rounded-lg border ${FC.hair} ${FC.sub} ${FC.hover} inline-flex items-center gap-1`}>
                        <M.icon className="w-3.5 h-3.5" /> {M.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button variant="primary" onClick={save}>Salvar macro</Button>
              </div>
            </div>
          </Row>
        )}

        <Row last>
          <div className={`divide-y ${FC.hair}`}>
            {loading &&
              // skeleton ecoa as linhas da lista (ícone + nome + sumário)
              [0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3">
                  <SkeletonBar className="w-4 h-4 rounded shrink-0" />
                  <div className="min-w-0 flex-1">
                    <SkeletonBar className="h-3.5 w-40 mb-1.5" />
                    <SkeletonBar className="h-3 w-56" />
                  </div>
                </div>
              ))}
            {!loading && macros.length === 0 && (
              <EmptyHint
                icon={Zap}
                text='Nenhuma macro ainda — crie a primeira (ex: "Reembolso") pra atender em 1 clique.'
                className="py-10"
              />
            )}
            {macros.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-6 py-3">
                <Zap className="w-4 h-4 text-[#dc6803] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] font-medium ${FC.ink}`}>{m.name}</div>
                  <div className={`text-[12px] truncate ${FC.sub}`}>
                    {m.actions.map((a, i) => (
                      <span key={i}>
                        {i > 0 && " → "}
                        {TYPE_META[a.type].label}: {summary(a)}
                      </span>
                    ))}
                  </div>
                </div>
                <button onClick={() => remove(m.id)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08]`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

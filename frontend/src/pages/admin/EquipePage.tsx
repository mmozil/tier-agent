import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Users, Plus, Trash2, RefreshCw, X, Shield, Headphones, Link2 } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button, EmptyHint, SKEL } from "@/components/ds/fc";

interface Member {
  id: number;
  nome: string;
  email: string;
  role: string;
  status: string;
  online: boolean;
  max_conversas: number;
  invite_token: string | null;
}

function inviteLink(token: string): string {
  return `${window.location.origin}/convite/${token}`;
}

const ROLE_LABEL: Record<string, string> = { admin: "Admin", atendente: "Atendente" };

export default function EquipePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", password: "", role: "atendente", max_conversas: 0 });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Member[]>("/team/members");
      setMembers(data);
    } catch {
      toast.error("Falha ao carregar equipe");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!form.nome.trim() || !form.email.trim()) {
      toast.error("Preencha nome e e-mail");
      return;
    }
    if (form.password && form.password.length < 6) {
      toast.error("Senha precisa de pelo menos 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      const payload: any = { nome: form.nome, email: form.email, role: form.role, max_conversas: 0 };
      if (form.password) payload.password = form.password;
      const { data } = await api.post<Member>("/team/members", payload);
      if (data.invite_token) {
        await navigator.clipboard?.writeText(inviteLink(data.invite_token)).catch(() => {});
        toast.success("Convite criado — link copiado! Envie pro atendente.");
      } else {
        toast.success("Atendente criado");
      }
      setForm({ nome: "", email: "", password: "", role: "atendente", max_conversas: 0 });
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  async function copyInvite(m: Member) {
    if (!m.invite_token) return;
    try {
      await navigator.clipboard.writeText(inviteLink(m.invite_token));
      toast.success("Link de convite copiado");
    } catch {
      toast.error(inviteLink(m.invite_token));
    }
  }

  async function updateRole(m: Member, role: string) {
    try {
      await api.put(`/team/members/${m.id}`, { role });
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role } : x)));
    } catch {
      toast.error("Erro ao atualizar");
    }
  }

  async function toggleStatus(m: Member) {
    const status = m.status === "active" ? "disabled" : "active";
    try {
      await api.put(`/team/members/${m.id}`, { status });
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, status } : x)));
    } catch {
      toast.error("Erro ao atualizar");
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remover ${m.nome}?`)) return;
    try {
      await api.delete(`/team/members/${m.id}`);
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      toast.error("Erro ao remover");
    }
  }

  const inputCls = `h-8 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const miniSelect = `h-7 px-2 text-[12px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none`;

  // TeamSkeleton — carregando, ecoa a lista de membros (avatar + nome/email + controles).
  function TeamSkeleton() {
    return (
      <Row last>
        <div className={`divide-y ${FC.hair}`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-6 py-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full shrink-0 ${SKEL}`} />
              <div className="flex-1 min-w-0">
                <div className={`h-3.5 w-32 mb-1.5 ${SKEL}`} />
                <div className={`h-3 w-48 max-w-full ${SKEL}`} />
              </div>
              <div className={`h-7 w-24 ${SKEL}`} />
              <div className={`h-7 w-20 ${SKEL}`} />
            </div>
          ))}
        </div>
      </Row>
    );
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Equipe</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Atendentes com login próprio. Entram pela mesma tela de login e veem só este workspace.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
              <Button variant="primary" onClick={() => setShowForm((s) => !s)}><Plus className="w-3.5 h-3.5" /> Novo atendente</Button>
            </div>
          </div>
        </Row>

        {showForm && (
          <Row>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Novo atendente</h3>
                <button onClick={() => setShowForm(false)} className={`p-1 rounded ${FC.mut} hover:bg-black/[0.04]`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome" className={inputCls} />
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-mail (login)" className={inputCls} />
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Senha (vazio = enviar convite por link)" className={inputCls} />
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                  <option value="atendente">Atendente</option>
                  <option value="admin">Admin (gerencia equipe)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button variant="primary" onClick={create} disabled={saving}>{saving ? "Criando..." : "Criar atendente"}</Button>
                <span className={`text-[12px] ${FC.sub}`}>
                  Com senha: você passa as credenciais. Sem senha: copiamos um <b>link de convite</b> — o atendente define a própria senha.
                </span>
              </div>
            </div>
          </Row>
        )}

        {loading ? (
          <TeamSkeleton />
        ) : members.length === 0 && !showForm ? (
          <Row last>
            <div className="py-16">
              <EmptyHint
                icon={Users}
                text="Você ainda atende sozinho. Adicione atendentes pra distribuir as conversas em fila — use o botão “Novo atendente” acima."
              />
            </div>
          </Row>
        ) : members.length > 0 ? (
          <Row last>
            <div className={`divide-y ${FC.hair}`}>
              {members.map((m) => (
                <div key={m.id} className="px-6 py-3 flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center shrink-0">
                      {m.role === "admin" ? <Shield className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" /> : <Headphones className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" />}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#F9F9F9] ${m.online ? "bg-[#0a8f5a]" : "bg-[#262626]/25"}`} title={m.online ? "Online" : "Offline"} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[14px] font-medium ${m.status === "disabled" ? `${FC.mut} line-through` : FC.ink}`}>{m.nome}</span>
                      {m.status === "disabled" && <span className="text-[11px] text-[#E5484D]">desativado</span>}
                      {m.status === "invited" && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#F5A300]/[0.12] text-[#9a6700]">convite pendente</span>}
                    </div>
                    <p className={`text-[12px] truncate ${FC.sub}`}>{m.email}</p>
                  </div>
                  {m.status === "invited" && m.invite_token && (
                    <button onClick={() => copyInvite(m)} className={`h-7 px-2.5 text-[12px] rounded-lg border ${FC.hair} text-[#003083] dark:text-[#5b9bff] ${FC.hover} inline-flex items-center gap-1`}>
                      <Link2 className="w-3.5 h-3.5" /> Copiar link
                    </button>
                  )}
                  <select value={m.role} onChange={(e) => updateRole(m, e.target.value)} className={miniSelect}>
                    <option value="atendente">{ROLE_LABEL.atendente}</option>
                    <option value="admin">{ROLE_LABEL.admin}</option>
                  </select>
                  {m.status !== "invited" && (
                    <button onClick={() => toggleStatus(m)} className={`h-7 px-2.5 text-[12px] rounded-lg border ${FC.hair} ${FC.sub} ${FC.hover}`}>
                      {m.status === "active" ? "Desativar" : "Ativar"}
                    </button>
                  )}
                  <button onClick={() => remove(m)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08]`} title="Remover">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </Row>
        ) : null}
      </PageFrame>
    </div>
  );
}

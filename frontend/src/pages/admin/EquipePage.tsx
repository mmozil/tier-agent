import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Users, Plus, Trash2, RefreshCw, X, Shield, Headphones, Link2 } from "lucide-react";

import { api } from "@/lib/api";

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
      // senha vazia → cria convite (atendente define a senha pelo link)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Equipe</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Atendentes com login próprio. Entram pela mesma tela de login e veem só este workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="h-7 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="h-8 px-3 text-[13px] rounded-md bg-[#003083] text-white inline-flex items-center gap-1.5 hover:bg-[#002266]"
          >
            <Plus className="w-3.5 h-3.5" /> Novo atendente
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold text-slate-800">Novo atendente</h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded text-slate-400 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome"
              className="h-8 px-3 text-[13px] rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083]"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="E-mail (login)"
              className="h-8 px-3 text-[13px] rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083]"
            />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Senha (vazio = enviar convite por link)"
              className="h-8 px-3 text-[13px] rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083]"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="h-8 px-2 text-[13px] rounded-md border border-slate-200 outline-none"
            >
              <option value="atendente">Atendente</option>
              <option value="admin">Admin (gerencia equipe)</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={create}
              disabled={saving}
              className="h-8 px-4 text-[13px] rounded-md bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
            >
              {saving ? "Criando..." : "Criar atendente"}
            </button>
            <span className="text-[12px] text-slate-400">
              Com senha: você passa as credenciais. Sem senha: copiamos um <b>link de convite</b> — o
              atendente define a própria senha.
            </span>
          </div>
        </div>
      )}

      {loading && <div className="text-[13px] text-slate-400 py-8 text-center">Carregando...</div>}

      {!loading && members.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">Você ainda atende sozinho.</p>
          <p className="text-[12px] text-slate-400 mt-1">Adicione atendentes pra distribuir as conversas em fila.</p>
        </div>
      )}

      {members.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {members.map((m) => (
            <div key={m.id} className="px-4 py-3 flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] flex items-center justify-center shrink-0">
                  {m.role === "admin" ? <Shield className="w-4 h-4 text-[#003083]" /> : <Headphones className="w-4 h-4 text-[#003083]" />}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${m.online ? "bg-emerald-500" : "bg-slate-300"}`}
                  title={m.online ? "Online" : "Offline"}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[14px] font-medium ${m.status === "disabled" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    {m.nome}
                  </span>
                  {m.status === "disabled" && <span className="text-[11px] text-rose-500">desativado</span>}
                  {m.status === "invited" && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">convite pendente</span>
                  )}
                </div>
                <p className="text-[12px] text-slate-500 truncate">{m.email}</p>
              </div>
              {m.status === "invited" && m.invite_token && (
                <button
                  onClick={() => copyInvite(m)}
                  className="h-7 px-2.5 text-[12px] rounded-md border border-slate-200 text-[#003083] hover:bg-slate-50 inline-flex items-center gap-1"
                >
                  <Link2 className="w-3.5 h-3.5" /> Copiar link
                </button>
              )}
              <select
                value={m.role}
                onChange={(e) => updateRole(m, e.target.value)}
                className="h-7 px-2 text-[12px] rounded-md border border-slate-200 outline-none"
              >
                <option value="atendente">{ROLE_LABEL.atendente}</option>
                <option value="admin">{ROLE_LABEL.admin}</option>
              </select>
              {m.status !== "invited" && (
                <button
                  onClick={() => toggleStatus(m)}
                  className="h-7 px-2.5 text-[12px] rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {m.status === "active" ? "Desativar" : "Ativar"}
                </button>
              )}
              <button onClick={() => remove(m)} className="p-1.5 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50" title="Remover">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, ShoppingBag, Target, LifeBuoy, DollarSign } from "lucide-react";

import { api } from "@/lib/api";

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  template_kind: string | null;
  active: boolean;
}

interface Template {
  key: string;
  label: string;
  description: string;
  icon: string;
  suggested_channels: string[];
  skills_count: number;
}

const ICONS: Record<string, typeof ShoppingBag> = {
  ShoppingBag,
  Target,
  LifeBuoy,
  DollarSign,
};

export default function AgentesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", persona: "", template_kind: "atendente_loja" });

  async function load() {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        api.get<Agent[]>("/agents"),
        api.get<{ templates: Template[] }>("/templates"),
      ]);
      setAgents(a.data);
      setTemplates(t.data.templates);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedTemplate = templates.find((t) => t.key === form.template_kind);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/agents", form);
      toast.success("Agente criado");
      setShowForm(false);
      setForm({ nome: "", persona: "", template_kind: "atendente_loja" });
      load();
    } catch (err) {
      toast.error("Erro ao salvar");
      console.error(err);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Agentes</h1>
          <p className="text-[13px] text-slate-500 mt-1">Crie e gerencie agentes do seu tenant.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-6 px-2 bg-tier hover:bg-tier-dark text-white text-[12px] rounded-md inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Novo agente
        </button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          <h2 className="text-[14px] font-medium text-slate-900">Novo agente</h2>

          <label className="block">
            <span className="text-[12px] text-slate-700">Nome do agente</span>
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="ex: Atendente principal"
              className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
              required
            />
          </label>

          <div>
            <span className="text-[12px] text-slate-700 block mb-2">Template inicial</span>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => {
                const Icon = ICONS[t.icon] || ShoppingBag;
                const active = form.template_kind === t.key;
                return (
                  <label
                    key={t.key}
                    className={`block cursor-pointer rounded-md border p-3 transition-colors ${
                      active ? "border-tier bg-tier/5" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t.key}
                      checked={active}
                      onChange={(e) => setForm({ ...form, template_kind: e.target.value })}
                      className="sr-only"
                    />
                    <div className="flex items-start gap-2.5">
                      <div className={`p-1.5 rounded ${active ? "bg-tier text-white" : "bg-slate-100 text-slate-500"}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-slate-900">{t.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{t.description}</div>
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {t.suggested_channels.map((c) => (
                            <span
                              key={c}
                              className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded uppercase tracking-wide"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {selectedTemplate && (
              <p className="mt-2 text-[11px] text-slate-500">
                💡 A persona e prompt deste template serão aplicados automaticamente (você pode
                sobrescrever editando depois).
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-[12px] text-slate-700">Persona (livre)</span>
            <textarea
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
              placeholder="ex: Você é um atendente cordial e direto, fala em pt-BR..."
              rows={4}
              className="mt-1 w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md font-mono"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
            >
              Cancelar
            </button>
            <button type="submit" className="h-6 px-2 text-[12px] bg-tier text-white rounded-md hover:bg-tier-dark inline-flex items-center gap-1">
              Criar agente
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && <div className="col-span-3 text-center text-[13px] text-slate-400 py-6">Carregando...</div>}
        {!loading && agents.length === 0 && (
          <div className="col-span-3 text-center text-[13px] text-slate-400 py-6">
            Nenhum agente. Crie o primeiro acima.
          </div>
        )}
        {agents.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[14px] font-medium text-slate-900">{a.nome}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  #{a.id} · tenant {a.tenant_id}
                </div>
              </div>
              {a.active ? (
                <span className="text-[11px] text-emerald-700">● Ativo</span>
              ) : (
                <span className="text-[11px] text-slate-400">○ Inativo</span>
              )}
            </div>
            {a.template_kind && (
              <div className="mt-3 inline-block px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] rounded">
                {a.template_kind}
              </div>
            )}
            {a.persona && (
              <p className="mt-3 text-[12px] text-slate-600 line-clamp-3 leading-relaxed">{a.persona}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

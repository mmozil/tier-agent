import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";

import { api } from "@/lib/api";

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  template_kind: string | null;
  active: boolean;
}

const TEMPLATES = [
  { key: "atendente_loja", label: "Atendente de Loja", desc: "Catálogo, preço, estoque, Pix" },
  { key: "sdr", label: "SDR / Pré-vendas", desc: "Qualifica lead + agenda" },
  { key: "suporte", label: "Suporte técnico", desc: "FAQ + escalation humano" },
  { key: "cobranca", label: "Cobrança", desc: "Lembretes + 2ª via + negociação" },
];

export default function AgentesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", persona: "", template_kind: "atendente_loja" });

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Agent[]>("/agents");
      setAgents(data);
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
          <h1 className="text-[22px] font-medium text-slate-900">Agentes</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Crie e gerencie agentes do seu tenant.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-9 px-3 bg-tier hover:bg-tier-dark text-white text-[13px] rounded-md inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Novo agente
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
              className="mt-1 w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md"
              required
            />
          </label>

          <div>
            <span className="text-[12px] text-slate-700 block mb-2">Template inicial</span>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <label
                  key={t.key}
                  className={`block cursor-pointer rounded-md border p-3 ${
                    form.template_kind === t.key ? "border-tier bg-tier/5" : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={t.key}
                    checked={form.template_kind === t.key}
                    onChange={(e) => setForm({ ...form, template_kind: e.target.value })}
                    className="sr-only"
                  />
                  <div className="text-[13px] font-medium text-slate-900">{t.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{t.desc}</div>
                </label>
              ))}
            </div>
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
              className="h-8 px-3 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md"
            >
              Cancelar
            </button>
            <button type="submit" className="h-8 px-3 text-[12px] bg-tier text-white rounded-md hover:bg-tier-dark">
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

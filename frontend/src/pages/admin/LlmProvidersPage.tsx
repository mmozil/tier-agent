import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";

import { api } from "@/lib/api";

interface Provider {
  id: number;
  provider: string;
  default_model: string;
  fallback_chain: { provider: string; model: string }[];
  temperature: number;
  max_tokens: number;
  tenant_id: number | null;
  active: boolean;
}

interface SupportedProvider {
  key: string;
  label: string;
}

export default function LlmProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [supported, setSupported] = useState<SupportedProvider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    provider: "minimax",
    api_key: "",
    default_model: "MiniMax-M2",
    temperature: 0.7,
    max_tokens: 4096,
  });

  async function load() {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        api.get<Provider[]>("/llm-providers"),
        api.get<{ providers: SupportedProvider[] }>("/llm-providers/supported"),
      ]);
      setProviders(p.data);
      setSupported(s.data.providers);
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
      await api.post("/llm-providers", { ...form, tenant_id: null, fallback_chain: [] });
      toast.success("Provider cadastrado");
      setShowForm(false);
      setForm({ provider: "minimax", api_key: "", default_model: "MiniMax-M2", temperature: 0.7, max_tokens: 4096 });
      load();
    } catch (err) {
      toast.error("Erro ao salvar");
      console.error(err);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Deletar este provider?")) return;
    try {
      await api.delete(`/llm-providers/${id}`);
      toast.success("Removido");
      load();
    } catch (err) {
      toast.error("Erro ao deletar");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">LLM Providers</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Cadastre os modelos disponíveis. Cada agente escolhe um na configuração — zero hardcode.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-6 px-2 bg-tier hover:bg-tier-dark text-white text-[12px] rounded-md inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Novo provider
        </button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          <h2 className="text-[14px] font-medium text-slate-900">Novo LLM provider</h2>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[12px] text-slate-700">Provider</span>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
              >
                {supported.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[12px] text-slate-700">Modelo padrão</span>
              <input
                value={form.default_model}
                onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                placeholder="ex: MiniMax-M2, claude-sonnet-4-6, gpt-4o-mini"
                className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[12px] text-slate-700">API Key</span>
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder="sk-..."
              className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md font-mono focus:outline-none focus:border-tier"
              required
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Encriptada com Fernet at-rest no banco.</span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[12px] text-slate-700">Temperature</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
              />
            </label>
            <label className="block">
              <span className="text-[12px] text-slate-700">Max tokens</span>
              <input
                type="number"
                min="1"
                value={form.max_tokens}
                onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) })}
                className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
            >
              Cancelar
            </button>
            <button type="submit" className="h-6 px-2 text-[12px] bg-tier text-white rounded-md hover:bg-tier-dark inline-flex items-center gap-1">
              Salvar
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">ID</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Provider</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Modelo</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Escopo</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Status</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && providers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Nenhum provider cadastrado. Clique em "Novo provider".
                </td>
              </tr>
            )}
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-[13px] text-slate-500 font-mono">{p.id}</td>
                <td className="px-4 py-2.5 text-[13px] font-medium text-slate-900">{p.provider}</td>
                <td className="px-4 py-2.5 text-[13px] text-slate-700 font-mono">{p.default_model}</td>
                <td className="px-4 py-2.5 text-[13px] text-slate-600">
                  {p.tenant_id === null ? (
                    <span className="px-1.5 py-0.5 bg-tier/10 text-tier text-[11px] rounded">Global</span>
                  ) : (
                    `Tenant ${p.tenant_id}`
                  )}
                </td>
                <td className="px-4 py-2.5 text-[13px]">
                  {p.active ? (
                    <span className="text-emerald-700">● Ativo</span>
                  ) : (
                    <span className="text-slate-400">○ Inativo</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <button
                    onClick={() => onDelete(p.id)}
                    className="p-1.5 hover:bg-rose-50 hover:text-rose-600 text-slate-400 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

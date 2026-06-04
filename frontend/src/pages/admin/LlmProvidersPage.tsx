import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Power, Loader2, Zap } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button } from "@/components/ds/fc";

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

  // Liga/desliga o provider (active). O provider ativo é o PRIMÁRIO que o agente usa.
  async function toggleActive(p: Provider) {
    try {
      await api.patch(`/llm-providers/${p.id}`, { active: !p.active });
      toast.success(!p.active ? "Ativado (vira o primário)" : "Desativado");
      load();
    } catch {
      toast.error("Erro ao alterar status");
    }
  }

  const [testing, setTesting] = useState<number | null>(null);
  // Testa a conexão real com o LLM (valida key/endpoint).
  async function testProvider(p: Provider) {
    setTesting(p.id);
    try {
      const { data } = await api.post<{ ok?: boolean; detail?: string; message?: string }>(`/llm-providers/${p.id}/test`);
      if (data?.ok === false) toast.error(`Falhou: ${data.detail || data.message || "sem resposta"}`);
      else toast.success("Conexão OK ✓");
    } catch (e: any) {
      toast.error(`Falhou: ${e?.response?.data?.detail || "erro na conexão"}`);
    } finally {
      setTesting(null);
    }
  }

  const inputCls = `mt-1 w-full h-8 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const th = `text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2.5 ${FC.mut}`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>LLM Providers</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Cadastre as LLMs que você tem. O <b>Ligado</b> é o <b>primário</b> (que os agentes usam); os demais ficam de fallback. Use o <b>⚡ Testar</b> pra validar a key. Zero hardcode.
              </p>
            </div>
            <Button variant="primary" onClick={() => setShowForm(!showForm)} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> Novo provider
            </Button>
          </div>
        </Row>

        {showForm && (
          <Row>
            <form onSubmit={onSubmit} className="p-6 space-y-4">
              <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Novo LLM provider</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Provider</span>
                  <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={inputCls}>
                    {supported.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Modelo padrão</span>
                  <input value={form.default_model} onChange={(e) => setForm({ ...form, default_model: e.target.value })} placeholder="ex: MiniMax-M2, claude-sonnet-4-6, gpt-4o-mini" className={inputCls} required />
                </label>
              </div>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>API Key</span>
                <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." className={`${inputCls} font-mono`} required />
                <span className={`text-[11px] mt-1 block ${FC.mut}`}>Encriptada com Fernet at-rest no banco.</span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Temperature</span>
                  <input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} className={inputCls} />
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Max tokens</span>
                  <input type="number" min="1" value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) })} className={inputCls} />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button variant="primary" type="submit">Salvar</Button>
              </div>
            </form>
          </Row>
        )}

        <Row last>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${FC.hair}`}>
                  <th className={th}>ID</th>
                  <th className={th}>Provider</th>
                  <th className={th}>Modelo</th>
                  <th className={th}>Escopo</th>
                  <th className={th}>Status</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className={`px-6 py-6 text-center text-[13px] ${FC.mut}`}>Carregando...</td></tr>
                )}
                {!loading && providers.length === 0 && (
                  <tr><td colSpan={6} className={`px-6 py-6 text-center text-[13px] ${FC.mut}`}>Nenhum provider cadastrado. Clique em "Novo provider".</td></tr>
                )}
                {providers.map((p) => (
                  <tr key={p.id} className={`border-b ${FC.hair} last:border-0 ${FC.hover}`}>
                    <td className={`px-6 py-2.5 text-[13px] font-mono ${FC.mut}`}>{p.id}</td>
                    <td className={`px-6 py-2.5 text-[13px] font-medium ${FC.ink}`}>{p.provider}</td>
                    <td className={`px-6 py-2.5 text-[13px] font-mono ${FC.sub}`}>
                      {p.default_model}
                      {p.fallback_chain && p.fallback_chain.length > 0 && (
                        <div className={`text-[11px] mt-0.5 ${FC.mut}`}>↳ fallback: {p.fallback_chain.map((f) => f.model).join(" → ")}</div>
                      )}
                    </td>
                    <td className="px-6 py-2.5 text-[13px]">
                      {p.tenant_id === null ? (
                        <span className="px-1.5 py-0.5 bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#5b9bff] text-[11px] rounded">Global</span>
                      ) : (
                        <span className={FC.sub}>Tenant {p.tenant_id}</span>
                      )}
                    </td>
                    <td className="px-6 py-2.5 text-[13px]">
                      <button
                        onClick={() => toggleActive(p)}
                        title={p.active ? "Ativo (primário) — clique pra desligar" : "Inativo — clique pra ligar (vira primário)"}
                        className="inline-flex items-center gap-1.5 hover:opacity-80"
                      >
                        <Power className={`w-3.5 h-3.5 ${p.active ? "text-[#0a8f5a]" : FC.mut}`} />
                        <span className={p.active ? "text-[#0a8f5a]" : FC.mut}>{p.active ? "Ligado" : "Desligado"}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => testProvider(p)}
                          disabled={testing === p.id}
                          title="Testar conexão com o LLM"
                          className={`p-1.5 rounded-md ${FC.mut} hover:text-[#003083] hover:bg-[#003083]/[0.06] transition-colors`}
                        >
                          {testing === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => onDelete(p.id)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08] transition-colors`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

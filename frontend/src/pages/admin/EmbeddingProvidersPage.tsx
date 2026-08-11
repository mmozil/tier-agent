import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Loader2, Lock, Zap, CheckCircle2, XCircle, Database, Pencil } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, PageHero, Row, Button, EmptyHint, SkeletonBar, iconBtn, Select } from "@/components/ds/fc";
import { ProviderLogo } from "@/components/icons/providerLogos";

interface Provider {
  id: number;
  provider: string;
  default_model: string;
  dimensions: number;
  base_url: string | null;
  cost_per_1m: number | null;
  tenant_id: number | null;
  active: boolean;
  priority: number;
  api_key_prefix: string | null;
  api_key_suffix: string | null;
  created_at: string | null;
  in_use: boolean;
}

interface SupportedProvider {
  key: string;
  label: string;
  models?: string[];
}

interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms?: number;
  dimensions?: number;
  dim_ok?: boolean;
  warn?: string | null;
  detail?: string;
}

function maskKey(prefix: string | null, suffix: string | null): string {
  if (prefix && suffix) return `${prefix}${"•".repeat(14)}${suffix}`;
  if (suffix) return `••••••••${suffix}`;
  return "sem key";
}

const emptyForm = { provider: "gemini", api_key: "", default_model: "gemini-embedding-001", dimensions: 768, base_url: "" };

export default function EmbeddingProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [supported, setSupported] = useState<SupportedProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        api.get<Provider[]>("/embedding-providers"),
        api.get<{ providers: SupportedProvider[] }>("/embedding-providers/supported"),
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

  const modelsFor = (prov: string) => supported.find((s) => s.key === prov)?.models ?? [];

  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(p: Provider) {
    setEditingId(p.id);
    setForm({ provider: p.provider, api_key: "", default_model: p.default_model, dimensions: p.dimensions, base_url: p.base_url || "" });
    setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const model = form.default_model.trim();
    if (!model) {
      toast.error("Informe o modelo");
      return;
    }
    try {
      let reindex: string | null = null;
      if (editingId) {
        const body: Record<string, any> = { default_model: model, dimensions: form.dimensions, base_url: form.base_url || null };
        if (form.api_key.trim()) body.api_key = form.api_key.trim();
        const { data } = await api.patch<{ reindex?: string | null }>(`/embedding-providers/${editingId}`, body);
        reindex = data?.reindex || null;
      } else {
        const { data } = await api.post<{ reindex?: string | null }>("/embedding-providers", {
          provider: form.provider,
          api_key: form.api_key,
          default_model: model,
          dimensions: form.dimensions,
          base_url: form.base_url || null,
          tenant_id: null,
        });
        reindex = data?.reindex || null;
      }
      toast.success(
        reindex === "started"
          ? "Salvo — reindexando sua base com o novo provider em segundo plano ✓"
          : "Salvo ✓",
        { duration: 5000 },
      );
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    }
  }

  async function onDelete(id: number) {
    if (providers.find((x) => x.id === id)?.tenant_id === null) {
      toast.error("Provider global da Tier — gerenciado pela plataforma.");
      return;
    }
    if (!confirm("Deletar este provider de embedding?")) return;
    try {
      await api.delete(`/embedding-providers/${id}`);
      toast.success("Removido");
      load();
    } catch {
      toast.error("Erro ao deletar");
    }
  }

  async function toggleActive(p: Provider) {
    if (p.tenant_id === null) {
      toast("Esse é o provider GLOBAL da plataforma — não dá pra desligar aqui.", { icon: "ℹ️" });
      return;
    }
    try {
      await api.patch(`/embedding-providers/${p.id}`, { active: !p.active });
      toast.success(!p.active ? "Ativado" : "Desativado");
      load();
    } catch {
      toast.error("Erro ao alterar status");
    }
  }

  async function makePrimary(p: Provider) {
    if (p.tenant_id === null) {
      toast("Cadastre/escolha um provider do seu workspace pra ser o principal.", { icon: "ℹ️" });
      return;
    }
    const scope = providers.filter((x) => x.tenant_id === p.tenant_id);
    const minPriority = Math.min(...scope.map((x) => x.priority));
    try {
      await api.patch(`/embedding-providers/${p.id}`, { active: true, priority: minPriority - 1 });
      toast.success(`${p.provider} agora é o principal do RAG ✓`);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao tornar principal");
    }
  }

  async function testProvider(p: Provider) {
    setTesting(p.id);
    try {
      const { data } = await api.post<TestResult>(`/embedding-providers/${p.id}/test`);
      setTestResults((r) => ({ ...r, [p.id]: data }));
      if (data.ok && data.dim_ok) toast.success(`Conexão OK ✓ (${data.latency_ms}ms · ${data.dimensions}d)`);
      else if (data.ok && !data.dim_ok) toast.error(data.warn || "Dimensão não bate com a base");
      else toast.error(`Falhou: ${data.detail || "sem resposta"}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || "erro na conexão";
      setTestResults((r) => ({ ...r, [p.id]: { ok: false, provider: p.provider, model: p.default_model, detail } }));
      toast.error(`Falhou: ${detail}`);
    } finally {
      setTesting(null);
    }
  }

  const inputCls = `mt-1 w-full h-8 px-3 text-[13px] rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;

  function Switch({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${on ? "bg-[#0a8f5a]" : "bg-slate-300 dark:bg-[#3a3a3a]"}`}
      >
        <span className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </button>
    );
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Embedding (RAG)"
          subtitle={
            <>
              Provider que gera os <b>embeddings</b> do RAG e da memória — <b>independente da LLM</b>, com{" "}
              <b>chave própria</b>. O ativo de menor ordem é o usado. Ao trocar de provider, a base é{" "}
              <b>re-embedada automaticamente</b> em segundo plano.
            </>
          }
        />

        <Row>
          <div className="flex items-start gap-2.5 px-4 py-3">
            <span className="mt-[5px] w-2 h-2 rounded-full bg-[#003083] dark:bg-[#5b9bff] shrink-0" />
            <div className="text-[13px] leading-5">
              <p className={`font-medium ${FC.ink}`}>Dimensão da base = 768</p>
              <p className={`mt-0.5 ${FC.sub}`}>
                A base vetorial espera <b>768 dimensões</b>. Escolha um modelo que gere 768 (Gemini, OpenAI text-embedding-3, Voyage, Jina, nomic-local todos conseguem). Ao <b>trocar de provider</b>, a base é <b>re-embedada sozinha</b> em segundo plano — você não precisa fazer nada.
              </p>
            </div>
          </div>
        </Row>

        {showForm && (
          <Row>
            <form onSubmit={onSubmit} className="p-6 space-y-4">
              <h3 className={`text-[20px] font-[500] leading-7 tracking-[-0.1px] ${FC.ink}`}>
                {editingId ? "Editar provider de embedding" : "Novo provider de embedding"}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub} mb-1 block`}>Provider</span>
                  <Select
                    value={form.provider}
                    disabled={!!editingId}
                    onChange={(v) => setForm({ ...form, provider: v, default_model: modelsFor(v)[0] ?? "" })}
                    placeholder="Escolha o provider"
                    options={supported.map((s) => ({
                      value: s.key,
                      label: s.label,
                      icon: <ProviderLogo provider={s.key} className="w-4 h-4" />,
                    }))}
                  />
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub} mb-1 block`}>Modelo</span>
                  {(() => {
                    const models = modelsFor(form.provider);
                    const isCustom = !models.includes(form.default_model);
                    return (
                      <>
                        <Select
                          value={isCustom ? "__custom__" : form.default_model}
                          onChange={(v) => setForm({ ...form, default_model: v === "__custom__" ? "" : v })}
                          placeholder="Escolha o modelo"
                          options={[
                            ...models.map((m) => ({ value: m, label: m })),
                            { value: "__custom__", label: "Outro (digitar)…" },
                          ]}
                        />
                        {isCustom && (
                          <input
                            value={form.default_model}
                            onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                            placeholder="nome do modelo"
                            className={`${inputCls} mt-2 font-mono`}
                            required
                          />
                        )}
                      </>
                    );
                  })()}
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Dimensões é TRAVADO em 768: a coluna de vetores do banco é
                    vector(768) fixa. Aceitar outro número aqui não "configura" nada —
                    faz todo upload de conhecimento falhar depois, e o registro ainda
                    fica marcado como pronto com zero trechos. Era um campo livre com
                    um aviso ao lado; virou o próprio limite. */}
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Dimensões</span>
                  <div
                    className={`${inputCls} flex items-center justify-between cursor-not-allowed opacity-90`}
                    aria-readonly="true"
                  >
                    <span className="font-mono tabular-nums">{form.dimensions}</span>
                    <Lock className={`w-3.5 h-3.5 ${FC.mut}`} />
                  </div>
                  {form.dimensions === 768 ? (
                    <span className={`text-[11px] mt-1 block ${FC.mut}`}>
                      Fixo — a base de vetores é vector(768) e vale para todos os agentes.
                    </span>
                  ) : (
                    <span className="text-[11px] mt-1 block text-[#c0362c] dark:text-[#ff6b5e]">
                      Divergente da base (768). Todo upload de conhecimento vai falhar até corrigir.
                    </span>
                  )}
                </label>
                {form.provider === "local" && (
                  <label className="block">
                    <span className={`text-[12px] ${FC.sub}`}>Base URL (Ollama/vLLM)</span>
                    <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="http://host:11434/v1" className={`${inputCls} font-mono`} />
                  </label>
                )}
              </div>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>
                  API Key {editingId && <span className={FC.mut}>(em branco = manter a atual)</span>}
                </span>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={form.provider === "local" ? "opcional (Ollama não exige)" : "sk-..."}
                  className={`${inputCls} font-mono`}
                  required={!editingId && form.provider !== "local"}
                />
                <span className={`text-[11px] mt-1 block ${FC.mut}`}>Encriptada com Fernet at-rest. Separada da chave do LLM.</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancelar</Button>
                <Button variant="primary" type="submit">Salvar</Button>
              </div>
            </form>
          </Row>
        )}

        <Row last>
          <div className={`flex items-start justify-between gap-4 border-b ${FC.hair} p-6`}>
            <div className="min-w-0">
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Seus providers de embedding</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                O de menor ordem <b>ligado</b> é o usado no RAG + memória · teste no <b>⚡</b>.
              </p>
            </div>
            <Button variant="primary" onClick={openNew} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> Novo provider
            </Button>
          </div>

          {loading && (
            <div>
              {[0, 1].map((i) => (
                <div key={i} className={`flex items-center gap-3 px-6 py-3 ${i > 0 ? `border-t ${FC.hair}` : ""}`}>
                  <SkeletonBar className="h-6 w-6 rounded-full" />
                  <SkeletonBar className="h-3.5 w-28" />
                  <SkeletonBar className="h-3 w-36" />
                  <div className="flex-1" />
                  <SkeletonBar className="h-7 w-7 rounded-lg" />
                  <SkeletonBar className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {!loading && providers.length === 0 && (
            <EmptyHint
              icon={Database}
              text='Nenhum provider de embedding — clique em "Novo provider" pra conectar (ou o RAG usa o Gemini do env como padrão).'
              className="py-14"
            />
          )}

          {!loading && providers.length > 0 && providers.map((p, idx) => {
            const tr = testResults[p.id];
            return (
              <div
                key={p.id}
                className={`group relative flex items-center gap-3 px-6 py-3 ${idx > 0 ? `border-t ${FC.hair}` : ""} ${p.in_use ? "bg-[#0a8f5a]/[0.03]" : ""}`}
              >
                <ProviderLogo provider={p.provider} className="w-6 h-6 shrink-0" />
                <div className="min-w-0 flex-1 flex items-center gap-4">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`text-[15px] font-medium truncate ${FC.ink}`}>{p.provider}</span>
                    {p.tenant_id === null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] ${FC.sub} shrink-0`}>Global</span>
                    )}
                    {p.in_use ? (
                      <span className="inline-flex items-center gap-1.5 shrink-0 pl-1.5 pr-2 py-0.5 rounded-full bg-[#0a8f5a]/[0.10] text-[#0a8f5a] dark:text-[#3ddc84] text-[10.5px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a] dark:bg-[#3ddc84]" /> Em uso
                      </span>
                    ) : p.tenant_id !== null ? (
                      <button
                        onClick={() => makePrimary(p)}
                        title="Tornar este o provider principal do RAG"
                        className="shrink-0 h-8 px-3 text-[12px] font-medium rounded-[10px] inline-flex items-center gap-1.5 transition-all active:scale-[0.98] text-[#003083] dark:text-[#5b9bff] hover:bg-[#003083]/[0.06] dark:hover:bg-[#5b9bff]/[0.12]"
                      >
                        Tornar principal
                      </button>
                    ) : null}
                  </div>
                  <span className={`text-[13px] font-mono truncate max-w-[200px] text-right shrink-0 ${FC.sub}`} title={p.default_model}>{p.default_model}</span>
                  <span className={`inline-flex items-center h-6 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.05] border ${FC.hair} text-[11px] font-mono shrink-0 ${FC.mut}`}>{p.dimensions}d</span>
                  <span className={`inline-flex items-center h-6 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.05] border ${FC.hair} text-[11.5px] font-mono shrink-0 ${FC.mut}`}>{maskKey(p.api_key_prefix, p.api_key_suffix)}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => testProvider(p)}
                    disabled={testing === p.id}
                    title="Testar conexão + dimensão"
                    className={`${iconBtn} ${tr ? (tr.ok && tr.dim_ok ? "!text-[#0a8f5a]" : "!text-[#E5484D]") : ""} hover:!text-[#003083] hover:!bg-[#003083]/[0.06]`}
                  >
                    {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr ? (tr.ok && tr.dim_ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />) : <Zap className="w-4 h-4" />}
                  </button>
                  {p.tenant_id !== null && (
                    <button onClick={() => openEdit(p)} title="Editar" className={iconBtn}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => onDelete(p.id)} title="Deletar" className={`${iconBtn} hover:!text-[#E5484D] hover:!bg-[#E5484D]/[0.08]`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="pl-1.5">
                    <Switch on={p.active} onClick={() => toggleActive(p)} title={p.active ? "Ligado" : "Desligado"} />
                  </div>
                </div>
              </div>
            );
          })}
        </Row>
      </PageFrame>
    </div>
  );
}

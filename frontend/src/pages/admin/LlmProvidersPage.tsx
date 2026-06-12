import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Loader2, Zap, ChevronUp, ChevronDown, X, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button } from "@/components/ds/fc";

interface Provider {
  id: number;
  provider: string;
  default_model: string;
  fallback_chain: { provider: string; model: string }[];
  temperature: number;
  max_tokens: number;
  timeout_s: number;
  cost_input_per_1m: number | null;
  cost_output_per_1m: number | null;
  base_url: string | null;
  tenant_id: number | null;
  active: boolean;
  priority: number;
  api_key_suffix: string | null;
  created_at: string | null;
  in_use: boolean;
}

interface SupportedProvider {
  key: string;
  label: string;
}

interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms?: number;
  sample?: string;
  detail?: string;
}

export default function LlmProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [supported, setSupported] = useState<SupportedProvider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});

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
    if (providers.find((x) => x.id === id)?.tenant_id === null) {
      toast.error("Provider global da Tier — gerenciado pela plataforma, não pode ser removido aqui.");
      return;
    }
    if (!confirm("Deletar este provider?")) return;
    try {
      await api.delete(`/llm-providers/${id}`);
      toast.success("Removido");
      setDetail(null);
      load();
    } catch {
      toast.error("Erro ao deletar");
    }
  }

  // Liga/desliga o provider (active). Ligado = entra no rodízio; o de menor ordem vira o primário.
  async function toggleActive(p: Provider) {
    // Provider GLOBAL (tenant_id null) é o padrão compartilhado da Tier — só admin Tier
    // pode mexer (o backend retorna 403). Desligá-lo deixaria TODOS os agentes sem LLM.
    if (p.tenant_id === null) {
      toast.error("Provider global da Tier — gerenciado pela plataforma. Pra usar outro modelo, cadastre um provider do seu workspace.");
      return;
    }
    try {
      await api.patch(`/llm-providers/${p.id}`, { active: !p.active });
      toast.success(!p.active ? "Ativado" : "Desativado");
      load();
    } catch {
      toast.error("Erro ao alterar status");
    }
  }

  // Reordena (prioridade): sobe/desce dentro do MESMO escopo (global ou tenant).
  // Quem tem MENOR priority é usado primeiro. Swap dos valores entre vizinhos.
  async function move(p: Provider, dir: "up" | "down") {
    const scope = providers.filter((x) => x.tenant_id === p.tenant_id);
    const idx = scope.findIndex((x) => x.id === p.id);
    const j = dir === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= scope.length) return;
    const other = scope[j];
    try {
      if (p.priority === other.priority) {
        // empate (ex: ambos default 100) — desempata movendo só este
        const np = dir === "up" ? other.priority - 1 : other.priority + 1;
        await api.patch(`/llm-providers/${p.id}`, { priority: np });
      } else {
        await api.patch(`/llm-providers/${p.id}`, { priority: other.priority });
        await api.patch(`/llm-providers/${other.id}`, { priority: p.priority });
      }
      load();
    } catch {
      toast.error("Erro ao reordenar");
    }
  }

  // Testa a conexão real com o LLM (valida key/endpoint + latência).
  async function testProvider(p: Provider) {
    setTesting(p.id);
    try {
      const { data } = await api.post<TestResult>(`/llm-providers/${p.id}/test`);
      setTestResults((r) => ({ ...r, [p.id]: data }));
      if (data.ok) toast.success(`Conexão OK ✓ (${data.latency_ms}ms)`);
      else toast.error(`Falhou: ${data.detail || "sem resposta"}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || "erro na conexão";
      setTestResults((r) => ({ ...r, [p.id]: { ok: false, provider: p.provider, model: p.default_model, detail } }));
      toast.error(`Falhou: ${detail}`);
    } finally {
      setTesting(null);
    }
  }

  const inputCls = `mt-1 w-full h-8 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const colLabel = `text-[11px] uppercase tracking-[0.06em] ${FC.mut}`;

  function scopeLabel(p: Provider) {
    return p.tenant_id === null ? "Global" : `Tenant ${p.tenant_id}`;
  }

  // ─── Toggle switch reutilizável (track + knob) ───
  function Switch({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors ${on ? "bg-[#0a8f5a]" : "bg-slate-300 dark:bg-[#3a3a3a]"}`}
      >
        <span className={`inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
      </button>
    );
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>LLM Providers</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                As LLMs agrupadas por <b>escopo</b>. Dentro de cada grupo, o <b>1º ligado</b> é o que o motor pega
                (<span className="text-[#0a8f5a] font-medium">Em uso</span>). <b>Tenant</b> tem prioridade sobre <b>Global</b>.
                Reordene com <b>↑↓</b>, ligue/desligue no <b>toggle</b>, teste a key no <b>⚡</b>. Clique na linha pra ver tudo.
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

        {loading && (
          <Row last><div className={`px-6 py-12 text-center text-[13px] ${FC.mut}`}>Carregando…</div></Row>
        )}
        {!loading && providers.length === 0 && (
          <Row last><div className={`px-6 py-12 text-center text-[13px] ${FC.mut}`}>Nenhum provider cadastrado. Clique em "Novo provider".</div></Row>
        )}
        {!loading && providers.length > 0 && (() => {
          // Lista plana ordenada por escopo (Global primeiro) — SEM faixas de grupo.
          // O escopo vira uma COLUNA (badge + tooltip), mais limpo e tabular.
          const sorted = [...providers].sort((a, b) => {
            const sa = a.tenant_id === null ? 0 : 1;
            const sb = b.tenant_id === null ? 0 : 1;
            return sa - sb; // sort estável preserva a ordem (priority) dentro do escopo
          });
          // Coluna ORDEM só quando há 2+ no MESMO escopo (aí reordenar faz sentido).
          const scopeCount = new Map<number | null, number>();
          sorted.forEach((p) => scopeCount.set(p.tenant_id, (scopeCount.get(p.tenant_id) ?? 0) + 1));
          const anyMulti = [...scopeCount.values()].some((n) => n > 1);
          const COLS = anyMulti
            ? "grid grid-cols-[56px_minmax(0,1.3fr)_minmax(0,1.4fr)_104px_100px_48px_60px] items-center gap-4"
            : "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_104px_100px_48px_60px] items-center gap-4";
          return (
            <Row last>
              {/* Cabeçalho de colunas — alinha via MESMO grid das linhas */}
              <div className={`${COLS} px-6 py-2.5 border-b ${FC.hair}`}>
                {anyMulti && <span className={colLabel}>Ordem</span>}
                <span className={colLabel}>Provider</span>
                <span className={colLabel}>Modelo</span>
                <span className={colLabel}>Escopo</span>
                <span className={colLabel}>Key</span>
                <span className={colLabel}>Ativo</span>
                <span />
              </div>

              {sorted.map((p) => {
                const isGlobal = p.tenant_id === null;
                const scopeItems = sorted.filter((x) => x.tenant_id === p.tenant_id);
                const idx = scopeItems.indexOf(p);
                const multi = scopeItems.length > 1;
                const tr = testResults[p.id];
                return (
                  <div
                    key={p.id}
                    onClick={() => setDetail(p)}
                    className={`${COLS} px-6 py-3 border-b ${FC.hair} cursor-pointer ${FC.hover} ${p.in_use ? "bg-[#0a8f5a]/[0.025]" : ""}`}
                  >
                    {/* Ordem — só quando há reordenação possível */}
                    {anyMulti && (
                      <div onClick={(e) => e.stopPropagation()}>
                        {multi ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex flex-col -my-1">
                              <button disabled={idx === 0} onClick={() => move(p, "up")} className={idx === 0 ? "opacity-20 cursor-default" : `${FC.mut} hover:text-[#003083]`}>
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button disabled={idx === scopeItems.length - 1} onClick={() => move(p, "down")} className={idx === scopeItems.length - 1 ? "opacity-20 cursor-default" : `${FC.mut} hover:text-[#003083]`}>
                                <ChevronDown className="w-4 h-4" />
                              </button>
                            </div>
                            <span className={`text-[12px] font-mono ${idx === 0 ? FC.ink : FC.mut}`}>{idx + 1}º</span>
                          </div>
                        ) : (
                          <span className={`text-[12px] font-mono ${FC.mut}`}>—</span>
                        )}
                      </div>
                    )}

                    {/* Provider + Em uso */}
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`text-[14px] font-medium truncate ${FC.ink}`}>{p.provider}</span>
                      {p.in_use && (
                        <span className="shrink-0 px-1.5 py-0.5 bg-[#0a8f5a]/[0.12] text-[#0a8f5a] text-[10px] font-semibold rounded uppercase tracking-wide">Em uso</span>
                      )}
                    </div>

                    {/* Modelo + fallback */}
                    <div className="min-w-0">
                      <div className={`text-[13px] font-mono truncate ${FC.sub}`}>{p.default_model}</div>
                      {p.fallback_chain && p.fallback_chain.length > 0 && (
                        <div className={`text-[11px] font-mono truncate ${FC.mut}`}>↳ {p.fallback_chain.map((f) => f.model).join(" → ")}</div>
                      )}
                    </div>

                    {/* Escopo — badge + tooltip */}
                    <div>
                      <span
                        title={
                          isGlobal
                            ? "Global: disponível para TODOS os agentes/clientes. É o padrão da Tier — usado quando o cliente não tem LLM própria."
                            : `Tenant ${p.tenant_id}: específico deste cliente. Só vale para os agentes dele e tem prioridade sobre o Global.`
                        }
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded cursor-help ${
                          isGlobal
                            ? "bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#5b9bff]"
                            : "bg-[#262626]/[0.06] dark:bg-white/[0.08] " + FC.sub
                        }`}
                      >
                        {isGlobal ? "Global" : `Tenant ${p.tenant_id}`}
                        <HelpCircle className="w-3 h-3 opacity-50" />
                      </span>
                    </div>

                    {/* Key */}
                    <span className={`text-[12px] font-mono ${FC.mut} truncate`}>
                      {p.api_key_suffix ? `••••${p.api_key_suffix}` : "—"}
                    </span>

                    {/* Ativo */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch on={p.active} onClick={() => toggleActive(p)} title={p.active ? "Ligado — clique pra desligar" : "Desligado — clique pra ligar"} />
                    </div>

                    {/* Ações */}
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => testProvider(p)}
                        disabled={testing === p.id}
                        title="Testar conexão com o LLM"
                        className={`p-1.5 rounded-md transition-colors ${tr ? (tr.ok ? "text-[#0a8f5a]" : "text-[#E5484D]") : FC.mut} hover:text-[#003083] hover:bg-[#003083]/[0.06]`}
                      >
                        {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr ? (tr.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />) : <Zap className="w-4 h-4" />}
                      </button>
                      <button onClick={() => onDelete(p.id)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08] transition-colors`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </Row>
          );
        })()}
      </PageFrame>

      {/* ─── Modal de detalhes (centralizado, consistente com Canais) ─── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDetail(null)}>
          <div
            className={`w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0c0e12] border ${FC.hair} shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`sticky top-0 z-10 flex items-center justify-between gap-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] px-5 py-4`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className={`text-[16px] font-medium leading-tight ${FC.ink}`}>{detail.provider}</h2>
                  {detail.in_use && (
                    <span className="px-1.5 py-0.5 bg-[#0a8f5a]/[0.12] text-[#0a8f5a] text-[10px] font-semibold rounded uppercase tracking-wide">Em uso</span>
                  )}
                </div>
                <p className={`text-[12px] ${FC.sub}`}>{scopeLabel(detail)} · {detail.default_model}</p>
              </div>
              <button onClick={() => setDetail(null)} className={`rounded-md p-1.5 ${FC.mut} ${FC.hover}`}><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* O que é / como funciona */}
              <div className={`rounded-lg border ${FC.hair} p-3.5 text-[13px] leading-relaxed ${FC.sub}`}>
                {detail.in_use ? (
                  <>Este é o provider <b className="text-[#0a8f5a]">em uso</b> no escopo <b>{scopeLabel(detail)}</b> — é a 1ª LLM ligada na ordem, então é o que os agentes chamam de fato.</>
                ) : detail.active ? (
                  <>Ligado, mas <b>não é o 1º</b> da fila neste escopo — só entra se o de cima for desligado ou falhar (via fallback). Use <b>↑</b> pra promover.</>
                ) : (
                  <>Desligado — não é usado por nenhum agente. Ligue o <b>toggle</b> pra colocá-lo na fila.</>
                )}
              </div>

              {/* Grid de campos */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Field label="Ordem (priority)" value={`${detail.priority}`} mono />
                <Field label="Status" value={detail.active ? "Ligado" : "Desligado"} />
                <Field label="Modelo" value={detail.default_model} mono />
                <Field label="API Key" value={detail.api_key_suffix ? `••••${detail.api_key_suffix}` : "—"} mono />
                <Field label="Temperature" value={`${detail.temperature}`} mono />
                <Field label="Max tokens" value={`${detail.max_tokens}`} mono />
                <Field label="Timeout" value={`${detail.timeout_s}s`} mono />
                <Field label="Escopo" value={scopeLabel(detail)} />
                {detail.base_url && <Field label="Base URL" value={detail.base_url} mono full />}
                {(detail.cost_input_per_1m != null || detail.cost_output_per_1m != null) && (
                  <Field label="Custo /1M (in/out)" value={`$${detail.cost_input_per_1m ?? "?"} / $${detail.cost_output_per_1m ?? "?"}`} mono full />
                )}
                {detail.created_at && (
                  <Field label="Criado em" value={new Date(detail.created_at).toLocaleString("pt-BR")} full />
                )}
              </div>

              {/* Fallback chain */}
              <div>
                <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-1.5 ${FC.ink}`}>Cadeia de fallback</div>
                {detail.fallback_chain && detail.fallback_chain.length > 0 ? (
                  <div className={`text-[13px] font-mono ${FC.sub}`}>
                    {detail.default_model} {detail.fallback_chain.map((f) => ` → ${f.model}`).join("")}
                  </div>
                ) : (
                  <div className={`text-[13px] ${FC.mut}`}>Sem fallback — usa só {detail.default_model}.</div>
                )}
              </div>

              {/* Teste de conexão */}
              <div className={`rounded-lg border ${FC.hair} p-3.5`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-[13px] font-medium ${FC.ink}`}>Testar conexão</div>
                    <div className={`text-[11px] ${FC.mut}`}>Faz um ping real validando a key + endpoint.</div>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => testProvider(detail)} disabled={testing === detail.id}>
                    {testing === detail.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Testar
                  </Button>
                </div>
                {testResults[detail.id] && (
                  <div className={`mt-3 rounded-md p-2.5 text-[12px] ${testResults[detail.id].ok ? "bg-[#0a8f5a]/[0.08] text-[#0a8f5a]" : "bg-[#E5484D]/[0.08] text-[#E5484D]"}`}>
                    {testResults[detail.id].ok ? (
                      <>✓ OK em {testResults[detail.id].latency_ms}ms · resposta: "{testResults[detail.id].sample || "—"}"</>
                    ) : (
                      <>✗ {testResults[detail.id].detail}</>
                    )}
                  </div>
                )}
              </div>

              {/* Ações */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => toggleActive(detail)}>
                  {detail.active ? "Desligar" : "Ligar"}
                </Button>
                <button onClick={() => onDelete(detail.id)} className="text-[12px] text-[#E5484D] hover:underline inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Deletar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function Field({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
    return (
      <div className={full ? "col-span-2" : ""}>
        <div className={`text-[11px] ${FC.mut}`}>{label}</div>
        <div className={`${mono ? "font-mono" : ""} ${FC.ink} break-all`}>{value}</div>
      </div>
    );
  }
}

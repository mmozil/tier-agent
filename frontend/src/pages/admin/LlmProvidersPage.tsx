import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Loader2, Zap, GripVertical, X, CheckCircle2, XCircle, Cpu, Pencil } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, PageHero, Row, Button, EmptyHint, SkeletonBar, iconBtn } from "@/components/ds/fc";
import { ProviderLogo } from "@/components/icons/providerLogos";

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
  api_key_prefix: string | null;
  api_key_suffix: string | null;
  created_at: string | null;
  in_use: boolean;
}

interface SupportedProvider {
  key: string;
  label: string;
  models?: string[]; // catálogo de modelos servido pelo backend (parametrizável)
}

interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms?: number;
  sample?: string;
  detail?: string;
}

// Máscara da chave no padrão Firecrawl: prefixo + pontos + sufixo (ex: sk-proj•••••f7bf).
// Sem prefixo (keys antigas/curtas) cai no fallback só-sufixo.
function maskKey(prefix: string | null, suffix: string | null): string {
  if (prefix && suffix) return `${prefix}${"•".repeat(14)}${suffix}`;
  if (suffix) return `••••••••${suffix}`;
  return "sem key";
}

export default function LlmProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [supported, setSupported] = useState<SupportedProvider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ default_model: "", temperature: 0.7, max_tokens: 4096, api_key: "" });
  // Drag & drop pra reordenar a sequência: id sendo arrastado + id sob o cursor (alvo).
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

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
      toast("Esse é o modelo GLOBAL da plataforma (não dá pra desligar aqui) — mas não precisa: o seu provider tem prioridade e é o que o agente usa.", { icon: "ℹ️" });
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

  // 1 clique: torna este o provider PRINCIPAL (o que o agente usa). Ativa + coloca
  // na frente de todos do mesmo escopo (menor priority vence). Jeito simples de trocar
  // o modelo sem mexer em toggle/ordem manualmente.
  async function makePrimary(p: Provider) {
    if (p.tenant_id === null) {
      toast("Esse é o modelo GLOBAL da plataforma — cadastre/escolha um provider do seu workspace pra ser o principal do seu agente.", { icon: "ℹ️" });
      return;
    }
    const scope = providers.filter((x) => x.tenant_id === p.tenant_id);
    const minPriority = Math.min(...scope.map((x) => x.priority));
    try {
      await api.patch(`/llm-providers/${p.id}`, { active: true, priority: minPriority - 1 });
      toast.success(`${p.provider} agora é o principal ✓`);
      setDetail(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao tornar principal");
    }
  }

  // Edição do provider (modelo / temperatura / tokens / key) direto no painel — pro
  // dono trocar o modelo SOZINHO, sem precisar de suporte/SQL.
  function startEdit(p: Provider) {
    setEditForm({ default_model: p.default_model, temperature: p.temperature, max_tokens: p.max_tokens, api_key: "" });
    setEditing(true);
  }

  async function saveEdit() {
    if (!detail) return;
    const model = editForm.default_model.trim();
    if (!model) {
      toast.error("Informe o modelo");
      return;
    }
    const body: Record<string, any> = {
      default_model: model,
      temperature: editForm.temperature,
      max_tokens: editForm.max_tokens,
    };
    if (editForm.api_key.trim()) body.api_key = editForm.api_key.trim();
    try {
      await api.patch(`/llm-providers/${detail.id}`, body);
      toast.success("Salvo ✓");
      setEditing(false);
      setDetail({ ...detail, default_model: model, temperature: editForm.temperature, max_tokens: editForm.max_tokens });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao salvar");
    }
  }

  // Reordena por DRAG & DROP dentro do MESMO escopo: move o item arrastado pra
  // posição do alvo e regrava priority sequencial (0,1,2…). Menor priority = usado
  // primeiro. Update otimista (aplica local na hora, inclusive quem fica "Em uso") e
  // depois persiste; load() reconcilia.
  async function reorder(fromId: number, toId: number) {
    if (fromId === toId) return;
    const dragged = providers.find((p) => p.id === fromId);
    const target = providers.find((p) => p.id === toId);
    if (!dragged || !target || dragged.tenant_id !== target.tenant_id) return; // só dentro do mesmo escopo
    const group = providers.filter((p) => p.tenant_id === dragged.tenant_id); // ordem exibida
    const from = group.findIndex((p) => p.id === fromId);
    const to = group.findIndex((p) => p.id === toId);
    if (from < 0 || to < 0) return;
    const order = [...group];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    // 1º ATIVO da nova ordem vira "Em uso" (espelha a regra do backend)
    const firstActiveId = order.find((p) => p.active)?.id ?? null;
    const remap = new Map(order.map((p, i) => [p.id, i]));
    // otimista: substitui os slots do mesmo escopo na nova ordem, preserva os outros
    let gi = 0;
    const optimistic = providers.map((p) => {
      if (p.tenant_id !== dragged.tenant_id) return p;
      const next = order[gi++];
      return { ...next, priority: remap.get(next.id)!, in_use: next.active && next.id === firstActiveId };
    });
    setProviders(optimistic);
    try {
      await Promise.all(order.map((p, i) => api.patch(`/llm-providers/${p.id}`, { priority: i })));
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao reordenar");
      load();
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

  // Modelos sugeridos do provider — vêm do backend (parâmetro), não hardcoded aqui.
  const modelsFor = (prov: string) => supported.find((s) => s.key === prov)?.models ?? [];

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
        className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${on ? "bg-[#0a8f5a]" : "bg-slate-300 dark:bg-[#3a3a3a]"}`}
      >
        <span className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </button>
    );
  }

  // Cliente: vê só os providers do tenant. Se tem provider(s) mas TODOS desligados, o
  // agente fica em silêncio (não cai no modelo global da plataforma — ver
  // tier_engine.ProvidersAllDisabled). Aviso só na visão do cliente (admin enxerga o
  // global, tenant_id=null, então não dispara o banner).
  const isAdminView = providers.some((p) => p.tenant_id === null);
  const tenantProviders = providers.filter((p) => p.tenant_id !== null);
  const agentSilent = !isAdminView && tenantProviders.length > 0 && !tenantProviders.some((p) => p.active);

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        {/* ─── HERO compartilhado (PageHero do design system) ─── */}
        <PageHero
          title="LLM Providers"
          subtitle={
            <>
              Conecte as LLMs do seu agente e defina a <b>ordem de uso</b>. A 1ª ligada é a{" "}
              <span className="text-[#0a8f5a] font-medium">principal</span>; as seguintes entram como{" "}
              <b>fallback</b> se a de cima falhar ou ficar fora do ar.
            </>
          }
        />

        {/* Aviso: cliente desligou TODAS as LLMs → agente parado (não usa o global). */}
        {agentSilent && (
          <Row>
            <div className="flex items-start gap-2.5 px-4 py-3">
              <span className="mt-[5px] w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <div className="text-[13px] leading-5">
                <p className={`font-medium ${FC.ink}`}>Seu agente está parado</p>
                <p className={`mt-0.5 ${FC.sub}`}>
                  Você tem LLM(s) configurada(s), mas todas estão <b>desligadas</b>. Ligue ao menos uma
                  para o agente voltar a responder — enquanto as suas estiverem off, ele <b>não</b> usa o
                  modelo padrão da plataforma.
                </p>
              </div>
            </div>
          </Row>
        )}

        {/* ─── Formulário de novo provider (aparece ao clicar em "Novo provider") ─── */}
        {showForm && (
          <Row>
            <form onSubmit={onSubmit} className="p-6 space-y-4">
              <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${FC.ink}`}>Novo LLM provider</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Provider</span>
                  <select
                    value={form.provider}
                    onChange={(e) => {
                      const prov = e.target.value;
                      // troca o provider E já sugere o modelo padrão dele (o usuário pode editar)
                      setForm({ ...form, provider: prov, default_model: modelsFor(prov)[0] ?? "" });
                    }}
                    className={inputCls}
                  >
                    {supported.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Modelo</span>
                  {(() => {
                    const models = modelsFor(form.provider);
                    const isCustom = !models.includes(form.default_model);
                    return (
                      <>
                        <select
                          value={isCustom ? "__custom__" : form.default_model}
                          onChange={(e) => {
                            const v = e.target.value;
                            setForm({ ...form, default_model: v === "__custom__" ? "" : v });
                          }}
                          className={inputCls}
                        >
                          {models.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="__custom__">Outro (digitar)…</option>
                        </select>
                        {isCustom && (
                          <input
                            value={form.default_model}
                            onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                            placeholder="digite o nome do modelo"
                            className={`${inputCls} mt-2 font-mono`}
                            required
                          />
                        )}
                      </>
                    );
                  })()}
                  <span className={`text-[11px] mt-1 block ${FC.mut}`}>
                    Modelos do {form.provider}. Escolha "Outro" pra digitar qualquer um.
                  </span>
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

        {/* ─── Seção "Seus modelos" (header + lista, no mesmo frame como o Firecrawl) ─── */}
        <Row last>
          <div className={`flex items-start justify-between gap-4 border-b ${FC.hair} p-6`}>
            <div className="min-w-0">
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Seus modelos</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                <b>Arraste</b> os cards pra mudar a sequência · ligue/desligue no <b>toggle</b> · teste a conexão no <b>⚡</b>.
              </p>
            </div>
            <Button variant="primary" onClick={() => setShowForm(!showForm)} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> Novo provider
            </Button>
          </div>

          {/* Loading: skeleton ecoa a forma da lista (stepper + provider + toggle) */}
          {loading && (
            <div>
              {[0, 1, 2].map((i) => (
                <div key={i} className={`flex items-center gap-3 px-6 py-3 ${i > 0 ? `border-t ${FC.hair}` : ""}`}>
                  <SkeletonBar className="h-4 w-4" />
                  <SkeletonBar className="h-6 w-6 rounded-full" />
                  <SkeletonBar className="h-3.5 w-28" />
                  <SkeletonBar className="h-3 w-36" />
                  <SkeletonBar className="h-6 w-24 rounded-md" />
                  <div className="flex-1" />
                  <SkeletonBar className="h-7 w-7 rounded-lg" />
                  <SkeletonBar className="h-7 w-7 rounded-lg" />
                  <SkeletonBar className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {!loading && providers.length === 0 && (
            <EmptyHint
              icon={Cpu}
              text='Nenhum provider cadastrado — clique em "Novo provider" pra conectar uma LLM.'
              className="py-14"
            />
          )}

          {!loading && providers.length > 0 && (() => {
            // Agrupa por ESCOPO (Global primeiro), preservando a ordem de prioridade
            // (o backend já devolve por priority). Cada grupo é uma SEQUÊNCIA própria.
            const sorted = [...providers].sort((a, b) => (a.tenant_id === null ? 0 : 1) - (b.tenant_id === null ? 0 : 1));
            const groupsMap = new Map<number | null, Provider[]>();
            sorted.forEach((p) => {
              if (!groupsMap.has(p.tenant_id)) groupsMap.set(p.tenant_id, []);
              groupsMap.get(p.tenant_id)!.push(p);
            });
            const groups = [...groupsMap.entries()];
            const showScope = groups.length > 1;

            return groups.map(([tid, items], gi) => (
              <div key={String(tid)}>
                {/* Header do grupo de escopo — só quando há mais de um escopo (admin) */}
                {showScope && (
                  <div className={`flex items-baseline gap-2 px-6 py-2.5 bg-black/[0.015] dark:bg-white/[0.02] ${gi > 0 ? `border-t ${FC.hair}` : ""}`}>
                    <span className={`text-[11px] uppercase tracking-[0.06em] font-semibold ${FC.sub}`}>
                      {tid === null ? "Global · plataforma" : "Seu workspace"}
                    </span>
                    <span className={`text-[11px] ${FC.mut}`}>
                      {items.length > 1 ? `${items.length} modelos, na ordem de uso` : "1 modelo"}
                    </span>
                  </div>
                )}

                {items.map((p, idx) => {
                  const total = items.length;
                  const multi = total > 1;
                  const isFirst = idx === 0;
                  const isLast = idx === total - 1;
                  const tr = testResults[p.id];
                  const topBorder = showScope ? true : idx > 0; // 1ª linha sem borda quando não há header de grupo
                  return (
                    <div
                      key={p.id}
                      data-llm-row
                      onClick={() => setDetail(p)}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        const d = providers.find((x) => x.id === dragId);
                        if (!d || d.tenant_id !== p.tenant_id) { e.dataTransfer.dropEffect = "none"; return; } // só mesmo escopo
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverId !== p.id) setDragOverId(p.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId) reorder(dragId, p.id);
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      style={dragOverId === p.id && dragId !== p.id ? { boxShadow: "inset 0 2px 0 0 #003083" } : undefined}
                      className={`group relative flex items-stretch gap-3 px-6 py-3 ${topBorder ? `border-t ${FC.hair}` : ""} cursor-pointer ${FC.hover} ${p.in_use ? "bg-[#0a8f5a]/[0.03]" : ""} ${dragId === p.id ? "opacity-50" : ""}`}
                    >
                      {/* Rail: handle de arrastar + nº de posição (conector vertical liga a sequência) */}
                      <div className="flex shrink-0 items-center gap-1.5 self-stretch" onClick={(e) => e.stopPropagation()}>
                        {multi ? (
                          <span
                            draggable
                            title="Arraste pra reordenar a sequência"
                            onDragStart={(e) => {
                              setDragId(p.id);
                              e.dataTransfer.effectAllowed = "move";
                              // a imagem arrastada é a LINHA inteira (não só o handle)
                              const row = (e.currentTarget as HTMLElement).closest("[data-llm-row]");
                              if (row) e.dataTransfer.setDragImage(row as Element, 24, 18);
                            }}
                            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                            className={`cursor-grab active:cursor-grabbing ${FC.mut} hover:text-[#003083] dark:hover:text-[#5b9bff]`}
                          >
                            <GripVertical className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <div className="relative flex w-6 items-center justify-center self-stretch">
                          {multi && !isFirst && <span className={`absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 ${FC.hairBg}`} />}
                          {multi && !isLast && <span className={`absolute left-1/2 bottom-0 h-1/2 w-px -translate-x-1/2 ${FC.hairBg}`} />}
                          <span
                            title={p.in_use ? "Principal — é a que o agente usa" : `${idx + 1}ª na fila de fallback`}
                            className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                              p.in_use
                                ? "bg-[#0a8f5a] text-white"
                                : p.active
                                  ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
                                  : `${FC.hairBg} ${FC.mut}`
                            }`}
                          >
                            {idx + 1}
                          </span>
                        </div>
                      </div>

                      {/* Conteúdo em UMA linha: provider (esquerda) · modelo + chave (direita) */}
                      <div className="min-w-0 flex-1 flex items-center gap-4 self-center">
                        {/* Provider — ocupa o espaço à esquerda */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <ProviderLogo provider={p.provider} className="w-5 h-5 shrink-0" />
                          <span className={`text-[15px] font-medium truncate ${FC.ink}`}>{p.provider}</span>
                          {p.in_use ? (
                            <span className="inline-flex items-center gap-1.5 shrink-0 pl-1.5 pr-2 py-0.5 rounded-full bg-[#0a8f5a]/[0.10] text-[#0a8f5a] dark:text-[#3ddc84] text-[10.5px] font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a] dark:bg-[#3ddc84]" /> Em uso
                            </span>
                          ) : p.tenant_id !== null ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); makePrimary(p); }}
                              title="Tornar este o modelo principal do agente"
                              className="shrink-0 px-1.5 py-0.5 text-[11px] font-medium rounded text-[#003083] dark:text-[#5b9bff] hover:bg-[#003083]/[0.06] dark:hover:bg-[#5b9bff]/[0.12]"
                            >
                              Tornar principal
                            </button>
                          ) : null}
                        </div>
                        {/* Modelo + chave — alinhados à direita */}
                        <span className={`text-[13px] font-mono truncate max-w-[200px] text-right shrink-0 ${FC.sub}`} title={p.default_model}>{p.default_model}</span>
                        <span className={`inline-flex items-center h-6 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.05] border ${FC.hair} text-[11.5px] font-mono shrink-0 ${FC.mut}`}>
                          {maskKey(p.api_key_prefix, p.api_key_suffix)}
                        </span>
                      </div>

                      {/* Ações: testar · deletar · TOGGLE (liga/desliga) */}
                      <div className="flex items-center gap-1 shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => testProvider(p)}
                          disabled={testing === p.id}
                          title="Testar conexão com o LLM"
                          className={`${iconBtn} ${tr ? (tr.ok ? "!text-[#0a8f5a]" : "!text-[#E5484D]") : ""} hover:!text-[#003083] hover:!bg-[#003083]/[0.06]`}
                        >
                          {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr ? (tr.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />) : <Zap className="w-4 h-4" />}
                        </button>
                        <button onClick={() => onDelete(p.id)} title="Deletar" className={`${iconBtn} hover:!text-[#E5484D] hover:!bg-[#E5484D]/[0.08]`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="pl-1.5">
                          <Switch on={p.active} onClick={() => toggleActive(p)} title={p.active ? "Ligado — clique pra desligar" : "Desligado — clique pra ligar"} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </Row>
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
                  <ProviderLogo provider={detail.provider} className="w-5 h-5 shrink-0" />
                  <h2 className={`text-[16px] font-medium leading-tight ${FC.ink}`}>{detail.provider}</h2>
                  {detail.in_use && (
                    <span className="px-1.5 py-0.5 bg-[#0a8f5a]/[0.12] text-[#0a8f5a] text-[10px] font-semibold rounded uppercase tracking-wide">Em uso</span>
                  )}
                </div>
                <p className={`text-[12px] ${FC.sub}`}>{scopeLabel(detail)} · {detail.default_model}</p>
              </div>
              <button onClick={() => { setDetail(null); setEditing(false); }} className={iconBtn}><X className="h-4 w-4" /></button>
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

              {editing ? (
                /* Form de edição — o dono troca o MODELO (e temp/tokens/key) sozinho */
                <div className="space-y-3">
                  <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold ${FC.ink}`}>Editar provider</div>
                  <label className="block">
                    <span className={`text-[12px] ${FC.sub}`}>Modelo</span>
                    {(() => {
                      const models = modelsFor(detail.provider);
                      const isCustom = !models.includes(editForm.default_model);
                      return (
                        <>
                          <select
                            value={isCustom ? "__custom__" : editForm.default_model}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditForm({ ...editForm, default_model: v === "__custom__" ? "" : v });
                            }}
                            className={inputCls}
                          >
                            {models.map((m) => (<option key={m} value={m}>{m}</option>))}
                            <option value="__custom__">Outro (digitar)…</option>
                          </select>
                          {isCustom && (
                            <input
                              value={editForm.default_model}
                              onChange={(e) => setEditForm({ ...editForm, default_model: e.target.value })}
                              placeholder="ex: minimax/minimax-m3"
                              className={`${inputCls} mt-2 font-mono`}
                            />
                          )}
                        </>
                      );
                    })()}
                    <span className={`text-[11px] mt-1 block ${FC.mut}`}>Modelos do {detail.provider}. Escolha "Outro" pra digitar qualquer slug (ex: minimax/minimax-m3).</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className={`text-[12px] ${FC.sub}`}>Temperature</span>
                      <input type="number" step="0.1" min="0" max="2" value={editForm.temperature} onChange={(e) => setEditForm({ ...editForm, temperature: parseFloat(e.target.value) })} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={`text-[12px] ${FC.sub}`}>Max tokens</span>
                      <input type="number" min="1" value={editForm.max_tokens} onChange={(e) => setEditForm({ ...editForm, max_tokens: parseInt(e.target.value) })} className={inputCls} />
                    </label>
                  </div>
                  <label className="block">
                    <span className={`text-[12px] ${FC.sub}`}>API Key <span className={FC.mut}>(em branco = manter a atual)</span></span>
                    <input type="password" value={editForm.api_key} onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })} placeholder={detail.api_key_suffix ? `••••${detail.api_key_suffix}` : "sk-..."} className={`${inputCls} font-mono`} />
                  </label>
                </div>
              ) : (
                /* Grid de campos */
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                  {/* números de config (ordem/temp/tokens/timeout) = negócio → sans tabular */}
                  <Field label="Ordem (priority)" value={`${detail.priority}`} tabular />
                  <Field label="Status" value={detail.active ? "Ligado" : "Desligado"} />
                  <Field label="Modelo" value={detail.default_model} mono />
                  <Field label="API Key" value={detail.api_key_suffix ? maskKey(detail.api_key_prefix, detail.api_key_suffix) : "—"} mono />
                  <Field label="Temperature" value={`${detail.temperature}`} tabular />
                  <Field label="Max tokens" value={`${detail.max_tokens}`} tabular />
                  <Field label="Timeout" value={`${detail.timeout_s}s`} tabular />
                  <Field label="Escopo" value={scopeLabel(detail)} />
                  {detail.base_url && <Field label="Base URL" value={detail.base_url} mono full />}
                  {(detail.cost_input_per_1m != null || detail.cost_output_per_1m != null) && (
                    /* custo = valor de negócio → sans tabular, não mono de terminal */
                    <Field label="Custo /1M (in/out)" value={`$${detail.cost_input_per_1m ?? "?"} / $${detail.cost_output_per_1m ?? "?"}`} tabular full />
                  )}
                  {detail.created_at && (
                    <Field label="Criado em" value={new Date(detail.created_at).toLocaleString("pt-BR")} full />
                  )}
                </div>
              )}

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
                {editing ? (
                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm" onClick={saveEdit}>
                      <CheckCircle2 className="w-3 h-3" /> Salvar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      {!detail.in_use && detail.tenant_id !== null && (
                        <Button variant="primary" size="sm" onClick={() => makePrimary(detail)}>
                          <CheckCircle2 className="w-3 h-3" /> Tornar principal
                        </Button>
                      )}
                      {detail.tenant_id !== null && (
                        <Button variant="ghost" size="sm" onClick={() => startEdit(detail)}>
                          <Pencil className="w-3 h-3" /> Editar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(detail)}>
                        {detail.active ? "Desligar" : "Ligar"}
                      </Button>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => onDelete(detail.id)}>
                      <Trash2 className="w-3 h-3" /> Deletar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function Field({ label, value, mono, tabular, full }: { label: string; value: string; mono?: boolean; tabular?: boolean; full?: boolean }) {
    return (
      <div className={full ? "col-span-2" : ""}>
        {/* label do campo (11px) em sub: contraste de texto pequeno */}
        <div className={`text-[11px] ${FC.sub}`}>{label}</div>
        <div className={`${mono ? "font-mono" : tabular ? "tabular-nums" : ""} ${FC.ink} break-all`}>{value}</div>
      </div>
    );
  }
}

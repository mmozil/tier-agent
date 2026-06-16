import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Trash2, Loader2, Zap, X, CheckCircle2, XCircle, Check, Plug, Bot } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button, HairCells, EmptyHint, SkeletonBar, iconBtn } from "@/components/ds/fc";

// Integrações (MCP) — catálogo de plataformas que o agente pode consultar/agir via
// tool-use. Padrão "página de integrações": cards conhecidos (Conectar com URL
// pré-preenchida) + opção avançada de servidor MCP customizado. Pós-conexão, testa
// automático e mostra "o que o agente pode fazer" em linguagem humana.

interface Agent {
  id: number;
  nome: string;
  active: boolean;
}

interface ToolProvider {
  id: number;
  agent_id: number;
  tenant_id: number;
  nome: string;
  mcp_server_url: string;
  enabled: boolean;
  priority: number;
  has_bearer: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_tools_count: number;
}

interface ToolInfo {
  name: string;
  description: string;
}

interface TestResult {
  ok: boolean;
  tools_count: number;
  tools: string[];
  tools_detail?: ToolInfo[];
}

interface Preset {
  key: string;
  nome: string;
  desc: string;
  url: string;
  badge: string | null;
  available: boolean;
  color: string;
  initials: string;
  tokenHelp: string;
  urlLocked: boolean;
  connectVia: "oauth" | "form";
}

const PRESETS: Preset[] = [
  {
    key: "tier-erp",
    nome: "Tier Empresas (ERP)",
    desc: "Financeiro do seu ERP: DRE, fluxo de caixa, KPIs, contas a receber e a pagar.",
    url: "https://api.tier.finance/api/mcp/erp/server",
    badge: "Somente leitura",
    available: true,
    color: "#003083",
    initials: "TE",
    tokenHelp: "",
    urlLocked: true,
    connectVia: "oauth", // Conectar → janela de autorização do ERP → pronto (sem token)
  },
  {
    key: "hovio-pet",
    nome: "Hovio Pet",
    desc: "Clientes, pets, agenda e WhatsApp do petshop — consultar e agir.",
    url: "https://pet.hovio.com.br/api/mcp",
    badge: "Consulta + ação",
    available: true,
    color: "#0a8f5a",
    initials: "HP",
    tokenHelp: "",
    urlLocked: true,
    connectVia: "oauth",
  },
  {
    key: "custom",
    nome: "Servidor MCP personalizado",
    desc: "Avançado: conecte qualquer servidor MCP (JSON-RPC 2.0) por URL + token.",
    url: "",
    badge: null,
    available: true,
    color: "#262626",
    initials: "MCP",
    tokenHelp: "Token Bearer da fonte (opcional, se ela exigir auth).",
    urlLocked: false,
    connectVia: "form",
  },
];

function presetFor(p: ToolProvider): Preset | undefined {
  return PRESETS.find((pr) => pr.url && p.mcp_server_url.startsWith(pr.url));
}

export default function FontesDadosPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [providers, setProviders] = useState<ToolProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [formPreset, setFormPreset] = useState<Preset | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ToolProvider | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});

  const [form, setForm] = useState({ nome: "", mcp_server_url: "", bearer: "" });

  async function loadAgents() {
    try {
      const { data } = await api.get<Agent[]>("/agents");
      setAgents(data);
      if (data.length && agentId === null) setAgentId(data[0].id);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar agentes");
    }
  }

  async function loadProviders(id: number) {
    setLoading(true);
    try {
      const { data } = await api.get<ToolProvider[]>(`/agents/${id}/tool-providers`);
      setProviders(data);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar integrações");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (agentId !== null) loadProviders(agentId);
  }, [agentId]);

  const [oauthConnecting, setOauthConnecting] = useState<string | null>(null);

  // Conectar: presets OAuth abrem a janela de autorização da fonte (padrão
  // "Entrar com Google" — sem token, sem form). Só o custom usa formulário.
  async function openConnect(preset: Preset) {
    if (!preset.available || agentId === null) return;
    if (preset.connectVia === "form") {
      setFormPreset(preset);
      setForm({ nome: "", mcp_server_url: preset.url, bearer: "" });
      return;
    }
    setOauthConnecting(preset.key);
    try {
      const { data } = await api.post<{ authorize_url: string }>(
        `/agents/${agentId}/tool-providers/oauth/start`,
        { preset: preset.key },
      );
      const w = 520, h = 760;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      window.open(data.authorize_url, "mcp-oauth", `width=${w},height=${h},left=${left},top=${top}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao iniciar conexão");
      setOauthConnecting(null);
    }
  }

  // O popup avisa via postMessage quando a autorização termina.
  useEffect(() => {
    async function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || ev.data.type !== "mcp-oauth") return;
      setOauthConnecting(null);
      if (!ev.data.ok) {
        if (ev.data.error !== "access_denied") toast.error(`Conexão falhou: ${ev.data.error}`);
        return;
      }
      const aid = ev.data.agent_id ?? agentId;
      if (aid === null) return;
      try {
        const { data } = await api.get<ToolProvider[]>(`/agents/${aid}/tool-providers`);
        setProviders(data);
        const p = data.find((x) => x.id === ev.data.provider_id);
        if (p) {
          toast.success(`${p.nome} conectada ✓`);
          setDetail(p);
          testProvider(p);
        }
      } catch {
        if (agentId !== null) loadProviders(agentId);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function connectedProvider(preset: Preset): ToolProvider | undefined {
    if (!preset.url) return undefined;
    return providers.find((p) => p.mcp_server_url.startsWith(preset.url));
  }

  // Testa a conexão MCP (lista as tools). Retorna o resultado pra encadear no fluxo de criação.
  async function testProvider(p: ToolProvider): Promise<TestResult | null> {
    if (agentId === null) return null;
    setTesting(p.id);
    try {
      const { data } = await api.post<TestResult>(`/agents/${agentId}/tool-providers/${p.id}/test`);
      setTestResults((r) => ({ ...r, [p.id]: data }));
      if (!data.ok) toast.error("Nenhuma ferramenta encontrada — verifique URL e token");
      loadProviders(agentId);
      return data;
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "erro na conexão";
      setTestResults((r) => ({ ...r, [p.id]: { ok: false, tools_count: 0, tools: [] } }));
      toast.error(`Falhou: ${msg}`);
      return null;
    } finally {
      setTesting(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (agentId === null) return;
    setSaving(true);
    try {
      const { data: created } = await api.post<ToolProvider>(`/agents/${agentId}/tool-providers`, {
        nome: form.nome.trim(),
        mcp_server_url: form.mcp_server_url.trim(),
        bearer: form.bearer || null,
      });
      setFormPreset(null);
      setForm({ nome: "", mcp_server_url: "", bearer: "" });
      await loadProviders(agentId);
      // Auto-testa e abre o detalhe: o usuário vê NA HORA o que o agente ganhou.
      setDetail(created);
      const tr = await testProvider(created);
      if (tr?.ok) toast.success(`Conectado ✓ — ${tr.tools_count} ferramentas disponíveis`);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao conectar");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: ToolProvider) {
    if (agentId === null) return;
    if (!confirm(`Desconectar "${p.nome}"? O agente perde acesso a essas ferramentas.`)) return;
    try {
      await api.delete(`/agents/${agentId}/tool-providers/${p.id}`);
      toast.success("Desconectada");
      setDetail(null);
      loadProviders(agentId);
    } catch {
      toast.error("Erro ao desconectar");
    }
  }

  async function toggleEnabled(p: ToolProvider) {
    if (agentId === null) return;
    try {
      await api.patch(`/agents/${agentId}/tool-providers/${p.id}`, { enabled: !p.enabled });
      toast.success(!p.enabled ? "Ativada" : "Pausada");
      loadProviders(agentId);
    } catch {
      toast.error("Erro ao alterar status");
    }
  }

  const inputCls = `mt-1 w-full h-8 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const colLabel = `text-[11px] uppercase tracking-[0.06em] ${FC.sub}`;
  const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_88px_56px_72px] items-center gap-4";

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

  function Avatar({ preset, nome }: { preset?: Preset; nome: string }) {
    const color = preset?.color || "#262626";
    const initials = preset?.initials || nome.slice(0, 2).toUpperCase();
    return (
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {initials}
      </span>
    );
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div className="min-w-0">
              <h2 className={`text-[20px] font-[500] fc-crisp tracking-[-0.1px] leading-7 ${FC.ink}`}>Integrações (MCP)</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.dim}`}>
                Conecte o agente a outras plataformas — ele passa a <b>consultar dados e agir</b> nelas
                durante a conversa (via ferramentas MCP). Escolha uma integração abaixo ou conecte um
                servidor personalizado.
              </p>
            </div>
            {agents.length > 0 && (
              <label className="shrink-0">
                <span className={`block text-[11px] mb-1 ${FC.sub}`}>Agente</span>
                <select
                  value={agentId ?? ""}
                  onChange={(e) => setAgentId(Number(e.target.value))}
                  className={`h-7 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </Row>

        {/* ─── Catálogo de integrações ─── */}
        <Row>
          <HairCells cols={3}>
            {PRESETS.map((pr) => {
              const conn = connectedProvider(pr);
              return (
                <div key={pr.key} className="p-5 flex flex-col gap-3 min-h-[150px]">
                  <div className="flex items-center gap-2.5">
                    <Avatar preset={pr} nome={pr.nome} />
                    <div className="min-w-0">
                      <div className={`text-[14px] font-medium ${FC.ink}`}>{pr.nome}</div>
                      {pr.badge && (
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide ${
                          pr.available ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.12] dark:text-[#5b9bff]" : "bg-[#F5A300]/[0.12] text-[#b87a00]"
                        }`}>
                          {pr.badge}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className={`text-[12.5px] leading-5 flex-1 ${FC.sub}`}>{pr.desc}</p>
                  <div>
                    {conn ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetail(conn)}
                        className="!px-2 text-[#0a8f5a] hover:!text-[#0a8f5a] dark:text-[#0a8f5a] dark:hover:!text-[#0a8f5a]"
                      >
                        <Check className="w-3.5 h-3.5" /> Conectada — ver detalhes
                      </Button>
                    ) : (
                      <Button
                        variant={pr.available ? "secondary" : "ghost"}
                        size="sm"
                        disabled={!pr.available || agentId === null || oauthConnecting === pr.key}
                        onClick={() => openConnect(pr)}
                      >
                        {oauthConnecting === pr.key ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Autorizando…</>
                        ) : pr.available ? (
                          "Conectar"
                        ) : (
                          "Em breve"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </HairCells>
        </Row>

        {/* ─── Form de conexão (abre ao clicar Conectar) ─── */}
        {formPreset && (
          <Row>
            <form onSubmit={onSubmit} className="p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <Avatar preset={formPreset} nome={formPreset.nome} />
                <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${FC.ink}`}>
                  Conectar {formPreset.key === "custom" ? "servidor MCP" : formPreset.nome}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Nome</span>
                  <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex: Tier Empresas ERP" className={inputCls} required />
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>URL do MCP server</span>
                  <input
                    value={form.mcp_server_url}
                    onChange={(e) => setForm({ ...form, mcp_server_url: e.target.value })}
                    placeholder="https://..."
                    className={`${inputCls} font-mono ${formPreset.urlLocked ? "opacity-60" : ""}`}
                    readOnly={formPreset.urlLocked}
                    required
                  />
                  {formPreset.urlLocked && (
                    <span className={`text-[11px] mt-1 block ${FC.mut}`}>Endereço oficial — já preenchido.</span>
                  )}
                </label>
              </div>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Token (Bearer)</span>
                <input type="password" value={form.bearer} onChange={(e) => setForm({ ...form, bearer: e.target.value })} placeholder={formPreset.key === "custom" ? "opcional" : "cole o token aqui"} className={`${inputCls} font-mono`} />
                <span className={`text-[11px] mt-1 block ${FC.mut}`}>
                  {formPreset.tokenHelp} Guardado encriptado — nunca é exibido de novo.
                </span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setFormPreset(null)}>Cancelar</Button>
                <Button variant="primary" type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Conectar e testar
                </Button>
              </div>
            </form>
          </Row>
        )}

        {/* ─── Conectadas ─── */}
        {loading && (
          // skeleton: ecoa a forma da lista (header + linhas com avatar/colunas), não spinner no vazio
          <Row last>
            <div className={`${COLS} px-6 py-2.5 border-b ${FC.hair}`}>
              <span className={colLabel}>Integração</span>
              <span className={colLabel}>Servidor</span>
              <span className={colLabel}>Ferramentas</span>
              <span className={colLabel}>Ativa</span>
              <span />
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${COLS} px-6 py-3 border-b ${FC.hair}`}>
                <div className="flex items-center gap-2.5">
                  <SkeletonBar className="h-8 w-8 rounded-lg" />
                  <SkeletonBar className="h-3.5 w-28" />
                </div>
                <SkeletonBar className="h-3 w-48" />
                <SkeletonBar className="h-3 w-16" />
                <SkeletonBar className="h-[18px] w-8 rounded-full" />
                <span />
              </div>
            ))}
          </Row>
        )}
        {!loading && agents.length === 0 && (
          <Row last>
            <EmptyHint
              icon={Bot}
              text="Nenhum agente ainda — crie um agente para conectar integrações."
              ctaLabel="Criar agente"
              ctaTo="/admin/agentes"
              className="py-10"
            />
          </Row>
        )}
        {!loading && agents.length > 0 && providers.length === 0 && (
          <Row last>
            <EmptyHint
              icon={Plug}
              text="Nenhuma integração conectada a este agente ainda — escolha uma no catálogo acima."
              className="py-10"
            />
          </Row>
        )}
        {!loading && providers.length > 0 && (
          <Row last>
            <div className={`${COLS} px-6 py-2.5 border-b ${FC.hair}`}>
              <span className={colLabel}>Integração</span>
              <span className={colLabel}>Servidor</span>
              <span className={colLabel}>Ferramentas</span>
              <span className={colLabel}>Ativa</span>
              <span />
            </div>

            {providers.map((p) => {
              const tr = testResults[p.id];
              const pr = presetFor(p);
              return (
                <div
                  key={p.id}
                  onClick={() => setDetail(p)}
                  className={`${COLS} px-6 py-3 border-b ${FC.hair} cursor-pointer ${FC.hover}`}
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    <Avatar preset={pr} nome={p.nome} />
                    <span className={`text-[14px] font-medium truncate ${FC.ink}`}>{p.nome}</span>
                  </div>
                  <span className={`text-[12px] font-mono truncate ${FC.sub}`}>{p.mcp_server_url}</span>
                  <span className={`text-[12px] ${p.last_tools_count > 0 ? FC.sub : FC.mut}`}>
                    {p.last_tools_count > 0 ? `${p.last_tools_count} disponíveis` : "—"}
                  </span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch on={p.enabled} onClick={() => toggleEnabled(p)} title={p.enabled ? "Ativa — clique pra pausar" : "Pausada — clique pra ativar"} />
                  </div>
                  <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => testProvider(p)}
                      disabled={testing === p.id}
                      title="Testar conexão"
                      className={`${iconBtn} ${tr ? (tr.ok ? "!text-[#0a8f5a]" : "!text-[#E5484D]") : ""} hover:!text-[#003083] hover:!bg-[#003083]/[0.06]`}
                    >
                      {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr ? (tr.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />) : <Zap className="w-4 h-4" />}
                    </button>
                    <button onClick={() => onDelete(p)} title="Desconectar" className={`${iconBtn} hover:!text-[#E5484D] hover:!bg-[#E5484D]/[0.08]`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </Row>
        )}
      </PageFrame>

      {/* ─── Modal de detalhes — "o que o agente pode fazer" ─── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDetail(null)}>
          <div
            className={`w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0c0e12] border ${FC.hair} shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`sticky top-0 z-10 flex items-center justify-between gap-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] px-5 py-4`}>
              <div className="min-w-0 flex items-center gap-2.5">
                <Avatar preset={presetFor(detail)} nome={detail.nome} />
                <div>
                  <h2 className={`text-[16px] font-medium leading-tight ${FC.ink}`}>{detail.nome}</h2>
                  <p className={`text-[12px] ${FC.sub}`}>{detail.enabled ? "Ativa" : "Pausada"} · {detail.has_bearer ? "autenticada" : "sem auth"}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className={iconBtn}><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* O que o agente pode fazer */}
              <div className={`rounded-lg border ${FC.hair} p-3.5`}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className={`text-[13px] font-medium ${FC.ink}`}>O que o agente pode fazer com esta integração</div>
                  <Button variant="secondary" size="sm" onClick={() => testProvider(detail)} disabled={testing === detail.id}>
                    {testing === detail.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Atualizar
                  </Button>
                </div>
                {testResults[detail.id]?.ok && testResults[detail.id].tools_detail?.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {testResults[detail.id].tools_detail!.map((t) => (
                      <li key={t.name} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0a8f5a]" />
                        <span className={`text-[12.5px] leading-5 ${FC.sub}`}>
                          {t.description || <span className="font-mono">{t.name}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : testResults[detail.id] && !testResults[detail.id].ok ? (
                  <div className="mt-2 rounded-md p-2.5 text-[12px] bg-[#E5484D]/[0.08] text-[#E5484D]">
                    ✗ Não foi possível listar as ferramentas — verifique a URL e o token.
                  </div>
                ) : (
                  <div className={`mt-1 text-[12px] ${FC.mut}`}>
                    {detail.last_tools_count > 0
                      ? `${detail.last_tools_count} ferramentas no último teste — clique em "Atualizar" pra ver a lista.`
                      : 'Clique em "Atualizar" pra descobrir as ferramentas.'}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Field label="Servidor MCP" value={detail.mcp_server_url} mono full />
                <Field label="Status" value={detail.enabled ? "Ativa" : "Pausada"} />
                <Field label="Auth" value={detail.has_bearer ? "Bearer (encriptado)" : "sem auth"} />
                {detail.last_test_at && (
                  <Field label="Último teste" value={`${new Date(detail.last_test_at).toLocaleString("pt-BR")} ${detail.last_test_ok ? "✓" : "✗"}`} full />
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => toggleEnabled(detail)}>
                  {detail.enabled ? "Pausar" : "Ativar"}
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(detail)}>
                  <Trash2 className="w-3 h-3" /> Desconectar
                </Button>
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
        <div className={`text-[11px] ${FC.sub}`}>{label}</div>
        <div className={`${mono ? "font-mono" : ""} ${FC.ink} break-all`}>{value}</div>
      </div>
    );
  }
}

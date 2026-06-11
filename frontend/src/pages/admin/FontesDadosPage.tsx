import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Loader2, Zap, X, CheckCircle2, XCircle } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button } from "@/components/ds/fc";

// Fontes de Dados (MCP) — servidores MCP externos plugados a um agente (federação).
// O agente passa a poder consultar essas fontes via tool-use (ex: ERP Tier Empresas).

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

interface TestResult {
  ok: boolean;
  tools_count: number;
  tools: string[];
}

export default function FontesDadosPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [providers, setProviders] = useState<ToolProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
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
      toast.error("Falha ao carregar fontes");
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (agentId === null) return;
    setSaving(true);
    try {
      await api.post(`/agents/${agentId}/tool-providers`, {
        nome: form.nome.trim(),
        mcp_server_url: form.mcp_server_url.trim(),
        bearer: form.bearer || null,
      });
      toast.success("Fonte conectada");
      setShowForm(false);
      setForm({ nome: "", mcp_server_url: "", bearer: "" });
      loadProviders(agentId);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: ToolProvider) {
    if (agentId === null) return;
    if (!confirm(`Remover a fonte "${p.nome}"?`)) return;
    try {
      await api.delete(`/agents/${agentId}/tool-providers/${p.id}`);
      toast.success("Removida");
      setDetail(null);
      loadProviders(agentId);
    } catch {
      toast.error("Erro ao remover");
    }
  }

  async function toggleEnabled(p: ToolProvider) {
    if (agentId === null) return;
    try {
      await api.patch(`/agents/${agentId}/tool-providers/${p.id}`, { enabled: !p.enabled });
      toast.success(!p.enabled ? "Ativada" : "Desativada");
      loadProviders(agentId);
    } catch {
      toast.error("Erro ao alterar status");
    }
  }

  // Testa a conexão MCP (lista as tools expostas pela fonte).
  async function testProvider(p: ToolProvider) {
    if (agentId === null) return;
    setTesting(p.id);
    try {
      const { data } = await api.post<TestResult>(`/agents/${agentId}/tool-providers/${p.id}/test`);
      setTestResults((r) => ({ ...r, [p.id]: data }));
      if (data.ok) toast.success(`Conexão OK ✓ (${data.tools_count} tools)`);
      else toast.error("Nenhuma tool encontrada — verifique URL e token");
      loadProviders(agentId);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "erro na conexão";
      setTestResults((r) => ({ ...r, [p.id]: { ok: false, tools_count: 0, tools: [] } }));
      toast.error(`Falhou: ${msg}`);
    } finally {
      setTesting(null);
    }
  }

  const inputCls = `mt-1 w-full h-8 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const colLabel = `text-[11px] uppercase tracking-[0.06em] ${FC.mut}`;
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

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div className="min-w-0">
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Fontes de Dados (MCP)</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Plugue servidores <b>MCP</b> externos a um agente — ele passa a consultar essas fontes (ex:{" "}
                <b>ERP Tier Empresas</b>, <b>Hovio Pet</b>) via tool-use. Ligue/desligue no <b>toggle</b>,
                teste a conexão no <b>⚡</b>. O token é guardado encriptado e nunca exibido.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {agents.length > 0 && (
                <select
                  value={agentId ?? ""}
                  onChange={(e) => setAgentId(Number(e.target.value))}
                  className={`h-7 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`}
                  title="Agente"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              )}
              <Button variant="primary" onClick={() => setShowForm(!showForm)} disabled={agentId === null}>
                <Plus className="w-3.5 h-3.5" /> Nova fonte
              </Button>
            </div>
          </div>
        </Row>

        {showForm && (
          <Row>
            <form onSubmit={onSubmit} className="p-6 space-y-4">
              <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Conectar fonte MCP</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>Nome</span>
                  <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex: Tier Empresas ERP" className={inputCls} required />
                </label>
                <label className="block">
                  <span className={`text-[12px] ${FC.sub}`}>URL do MCP server</span>
                  <input value={form.mcp_server_url} onChange={(e) => setForm({ ...form, mcp_server_url: e.target.value })} placeholder="https://api.tier.finance/api/mcp/erp/server" className={`${inputCls} font-mono`} required />
                </label>
              </div>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Token (Bearer)</span>
                <input type="password" value={form.bearer} onChange={(e) => setForm({ ...form, bearer: e.target.value })} placeholder="opcional — deixe vazio se a fonte não exige auth" className={`${inputCls} font-mono`} />
                <span className={`text-[11px] mt-1 block ${FC.mut}`}>Encriptado com Fernet at-rest. Use o access_token OAuth da fonte (read-only).</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button variant="primary" type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Salvar
                </Button>
              </div>
            </form>
          </Row>
        )}

        {agents.length === 0 && !loading && (
          <Row last><div className={`px-6 py-12 text-center text-[13px] ${FC.mut}`}>Nenhum agente — crie um agente primeiro em "Agentes".</div></Row>
        )}
        {loading && (
          <Row last><div className={`px-6 py-12 text-center text-[13px] ${FC.mut}`}>Carregando…</div></Row>
        )}
        {!loading && agents.length > 0 && providers.length === 0 && (
          <Row last><div className={`px-6 py-12 text-center text-[13px] ${FC.mut}`}>Nenhuma fonte conectada a este agente. Clique em "Nova fonte".</div></Row>
        )}
        {!loading && providers.length > 0 && (
          <Row last>
            <div className={`${COLS} px-6 py-2.5 border-b ${FC.hair}`}>
              <span className={colLabel}>Fonte</span>
              <span className={colLabel}>URL</span>
              <span className={colLabel}>Auth</span>
              <span className={colLabel}>Ativa</span>
              <span />
            </div>

            {providers.map((p) => {
              const tr = testResults[p.id];
              return (
                <div
                  key={p.id}
                  onClick={() => setDetail(p)}
                  className={`${COLS} px-6 py-3 border-b ${FC.hair} cursor-pointer ${FC.hover}`}
                >
                  {/* Fonte + nº de tools */}
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={`text-[14px] font-medium truncate ${FC.ink}`}>{p.nome}</span>
                    {p.last_tools_count > 0 && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#5b9bff] text-[10px] font-semibold rounded">{p.last_tools_count} tools</span>
                    )}
                  </div>

                  {/* URL */}
                  <span className={`text-[12px] font-mono truncate ${FC.sub}`}>{p.mcp_server_url}</span>

                  {/* Auth */}
                  <span className={`text-[11px] ${p.has_bearer ? FC.sub : FC.mut}`}>{p.has_bearer ? "Bearer" : "sem auth"}</span>

                  {/* Ativa */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch on={p.enabled} onClick={() => toggleEnabled(p)} title={p.enabled ? "Ativa — clique pra desativar" : "Inativa — clique pra ativar"} />
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => testProvider(p)}
                      disabled={testing === p.id}
                      title="Testar conexão MCP"
                      className={`p-1.5 rounded-md transition-colors ${tr ? (tr.ok ? "text-[#0a8f5a]" : "text-[#E5484D]") : FC.mut} hover:text-[#003083] hover:bg-[#003083]/[0.06]`}
                    >
                      {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr ? (tr.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />) : <Zap className="w-4 h-4" />}
                    </button>
                    <button onClick={() => onDelete(p)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08] transition-colors`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </Row>
        )}
      </PageFrame>

      {/* ─── Modal de detalhes ─── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDetail(null)}>
          <div
            className={`w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0c0e12] border ${FC.hair} shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`sticky top-0 z-10 flex items-center justify-between gap-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] px-5 py-4`}>
              <div className="min-w-0">
                <h2 className={`text-[16px] font-medium leading-tight ${FC.ink}`}>{detail.nome}</h2>
                <p className={`text-[12px] ${FC.sub}`}>{detail.enabled ? "Ativa" : "Inativa"} · {detail.has_bearer ? "Bearer" : "sem auth"}</p>
              </div>
              <button onClick={() => setDetail(null)} className={`rounded-md p-1.5 ${FC.mut} ${FC.hover}`}><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 gap-y-3 text-[13px]">
                <Field label="URL do MCP server" value={detail.mcp_server_url} mono />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Field label="Status" value={detail.enabled ? "Ativa" : "Inativa"} />
                  <Field label="Auth" value={detail.has_bearer ? "Bearer (encriptado)" : "sem auth"} />
                  <Field label="Prioridade" value={`${detail.priority}`} mono />
                  <Field label="Tools (último teste)" value={`${detail.last_tools_count}`} mono />
                  {detail.last_test_at && (
                    <Field label="Último teste" value={`${new Date(detail.last_test_at).toLocaleString("pt-BR")} ${detail.last_test_ok ? "✓" : "✗"}`} full />
                  )}
                </div>
              </div>

              {/* Teste de conexão + tools descobertas */}
              <div className={`rounded-lg border ${FC.hair} p-3.5`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-[13px] font-medium ${FC.ink}`}>Testar conexão</div>
                    <div className={`text-[11px] ${FC.mut}`}>Lista as ferramentas expostas pela fonte.</div>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => testProvider(detail)} disabled={testing === detail.id}>
                    {testing === detail.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Testar
                  </Button>
                </div>
                {testResults[detail.id] && (
                  <div className={`mt-3 rounded-md p-2.5 text-[12px] ${testResults[detail.id].ok ? "bg-[#0a8f5a]/[0.08] text-[#0a8f5a]" : "bg-[#E5484D]/[0.08] text-[#E5484D]"}`}>
                    {testResults[detail.id].ok ? (
                      <>✓ {testResults[detail.id].tools_count} tools: <span className="font-mono">{testResults[detail.id].tools.join(", ")}</span></>
                    ) : (
                      <>✗ nenhuma tool — verifique URL e token</>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => toggleEnabled(detail)}>
                  {detail.enabled ? "Desativar" : "Ativar"}
                </Button>
                <button onClick={() => onDelete(detail)} className="text-[12px] text-[#E5484D] hover:underline inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Remover
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cloud,
  FileText,
  History,
  Loader2,
  Play,
  Send,
  Store,
  Trash2,
  Workflow,
} from "lucide-react";

import { api } from "@/lib/api";
import { btnPrimary, iconBtn, Button, FC } from "@/components/ds/fc";
import {
  emptyCanvas,
  type NodeKindMeta,
  type PlaybookCanvas as CanvasShape,
} from "@/lib/playbookSchema";
import NodeConfigPanel from "@/components/playbook/NodeConfigPanel";
import NodePalette from "@/components/playbook/NodePalette";
import PlaybookCanvasWrapper from "@/components/playbook/PlaybookCanvas";

interface Playbook {
  id: number;
  agent_id: number;
  nome: string;
  descricao: string | null;
  canvas_json: { version?: number; nodes?: any[]; edges?: any[] };
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string;
}

interface StepLog {
  id: number;
  node_id: string;
  node_type: string;
  status: string;
  latency_ms: number | null;
  output_json: Record<string, any> | null;
  error: string | null;
}

interface TestRunResult {
  execution_id: number;
  status: string;
  steps_executed: number;
  messages_sent: number;
  vars: Record<string, unknown>;
}

const LS_PALETTE = "tier_playbook_palette_collapsed";
const LS_CONFIG = "tier_playbook_config_collapsed";

export default function PlaybookEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pb, setPb] = useState<Playbook | null>(null);
  const [canvas, setCanvas] = useState<CanvasShape>(emptyCanvas());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [rightTab, setRightTab] = useState<"config" | "test">("config");
  const [lastRun, setLastRun] = useState<TestRunResult | null>(null);
  const [lastSteps, setLastSteps] = useState<StepLog[]>([]);

  const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_PALETTE) === "1";
    } catch {
      return false;
    }
  });
  const [configCollapsed, setConfigCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_CONFIG) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LS_PALETTE, paletteCollapsed ? "1" : "0");
    } catch {}
  }, [paletteCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_CONFIG, configCollapsed ? "1" : "0");
    } catch {}
  }, [configCollapsed]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Playbook>(`/playbooks/${id}`);
        setPb(data);
        setCanvas(
          data.canvas_json?.nodes ? (data.canvas_json as CanvasShape) : emptyCanvas(),
        );
      } catch {
        toast.error("Playbook não encontrado");
        navigate("/admin/playbooks");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const persistCanvas = useCallback(async () => {
    if (!pb) return;
    setSaving(true);
    try {
      // `status` é pintura da última simulação — não faz parte do playbook salvo.
      const clean = {
        ...canvas,
        nodes: canvas.nodes.map((n) => {
          const { status: _drop, ...rest } = (n.data || {}) as Record<string, unknown>;
          return { ...n, data: rest };
        }),
      };
      await api.put(`/playbooks/${pb.id}`, { canvas_json: clean });
      setLastSavedAt(new Date());
      dirtyRef.current = false;
      setPb((prev) => (prev && prev.status === "published" ? { ...prev, status: "draft" } : prev));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }, [canvas, pb]);

  useEffect(() => {
    if (!pb || loading) return;
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistCanvas, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [canvas, persistCanvas, pb, loading]);

  const onDragStartFromPalette = useCallback((e: React.DragEvent, meta: NodeKindMeta) => {
    e.dataTransfer.setData("application/tier-playbook-node", JSON.stringify(meta));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const selectedNode = useMemo(
    () => canvas.nodes.find((n) => n.id === selectedNodeId) || null,
    [canvas.nodes, selectedNodeId],
  );

  // Canvas pintado com o resultado da última simulação: o nó que rodou fica verde,
  // o que falhou fica vermelho. É o que liga "o que aconteceu" ao desenho do fluxo.
  // `status` é só de exibição — `persistCanvas` tira antes de salvar.
  const canvasView = useMemo(() => {
    if (!lastSteps.length) return canvas;
    const byNode = new Map(lastSteps.map((s) => [s.node_id, s]));
    return {
      ...canvas,
      nodes: canvas.nodes.map((n) => {
        const s = byNode.get(n.id);
        if (!s) return n;
        return { ...n, data: { ...(n.data || {}), status: s.status === "error" ? "error" : "completed" } };
      }),
    };
  }, [canvas, lastSteps]);

  // Quando seleciona nó, abre o painel direito automaticamente
  useEffect(() => {
    if (selectedNodeId && configCollapsed) setConfigCollapsed(false);
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateNodeData = useCallback(
    (data: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      setCanvas((c) => ({
        ...c,
        nodes: c.nodes.map((n) => (n.id === selectedNodeId ? { ...n, data } : n)),
      }));
    },
    [selectedNodeId],
  );

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setCanvas((c) => ({
      ...c,
      nodes: c.nodes.filter((n) => n.id !== selectedNodeId),
      edges: c.edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
    }));
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  async function publish() {
    if (!pb) return;
    if (!canvas.nodes.length) {
      toast.error("Adicione pelo menos um nó");
      return;
    }
    const hasTrigger = canvas.nodes.some((n) => n.type.startsWith("trigger_"));
    if (!hasTrigger) {
      toast.error("Adicione pelo menos um nó de gatilho");
      return;
    }
    if (dirtyRef.current) await persistCanvas();
    setPublishing(true);
    try {
      const { data } = await api.post(`/playbooks/${pb.id}/publish`);
      toast.success(`Publicado · ${data.triggers_indexed} gatilho(s) ativo(s)`);
      setPb((prev) => (prev ? { ...prev, status: "published", published_at: data.published_at } : prev));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function publishMarketplace() {
    if (!pb) return;
    if (pb.status !== "published") {
      toast.error("Publica o playbook primeiro (Publicar). Depois marca como template.");
      return;
    }
    const label = prompt("Nome público no marketplace:", pb.nome);
    if (!label) return;
    const description = prompt("Descrição pública (opcional):", pb.descricao || "");
    try {
      await api.post(`/playbooks/${pb.id}/publish-marketplace`, {
        public_label: label,
        public_description: description,
      });
      toast.success("Publicado no marketplace!");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao publicar marketplace");
    }
  }

  async function archive() {
    if (!pb) return;
    if (!confirm("Arquivar este playbook? Ele para de rodar imediatamente.")) return;
    try {
      await api.post(`/playbooks/${pb.id}/archive`);
      toast.success("Arquivado");
      navigate("/admin/playbooks");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao arquivar");
    }
  }

  if (loading || !pb) {
    return (
      <div className="flex items-center justify-center py-20">
        {/* editor canvas é complexo demais pra skeleton — mantém spinner, só alinha cor dark */}
        <Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" />
      </div>
    );
  }

  // Layout fullwidth — escapa do container max-w-[1400px] do AdminLayout
  return (
    <div
      className="fixed inset-0 flex flex-col bg-[#FAFBFD] dark:bg-[#0c0e12] z-10"
      style={{ left: "var(--ta-sidebar-w, 240px)" }}
    >
      {/* TOPBAR */}
      <div className={`h-12 px-4 flex items-center gap-2 bg-white dark:bg-[#0f1216] border-b ${FC.hair} shrink-0`}>
        <Link
          to="/admin/playbooks"
          className={iconBtn}
          title="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className={`w-px h-5 ${FC.hairBg}`} />

        <div className="flex-1 min-w-0 px-1">
          <div className={`text-[13px] font-semibold truncate leading-tight ${FC.ink}`}>{pb.nome}</div>
          {pb.descricao && <div className={`text-[11px] truncate leading-tight ${FC.sub}`}>{pb.descricao}</div>}
        </div>

        <SaveBadge saving={saving} lastSavedAt={lastSavedAt} />
        <StatusPill status={pb.status} />

        <div className={`w-px h-5 ${FC.hairBg} mx-1`} />

        <Link
          to={`/admin/playbooks/${pb.id}/executions`}
          className={`h-8 px-3 rounded-[10px] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`}
        >
          <History className="w-3.5 h-3.5" />
          Execuções
        </Link>
        <Button variant="ghost" onClick={() => { setConfigCollapsed(false); setRightTab("test"); }}>
          <Play className="w-3.5 h-3.5" />
          Testar
        </Button>
        {pb.status === "published" && (
          <Button variant="ghost" onClick={publishMarketplace} title="Publicar no marketplace público">
            <Store className="w-3.5 h-3.5" />
            Marketplace
          </Button>
        )}
        <button
          onClick={archive}
          className={iconBtn}
          title="Arquivar"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={publish}
          disabled={publishing}
          className={btnPrimary}
        >
          {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {pb.status === "published" ? "Republicar" : "Publicar"}
        </button>
      </div>

      {/* WORK AREA — 3 colunas */}
      <div className="flex flex-1 min-h-0 relative">
        {/* PALETTE — esquerda */}
        <NodePalette
          onDragStart={onDragStartFromPalette}
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed((v) => !v)}
        />

        {/* CANVAS — meio (fullwidth) */}
        <div className="flex-1 bg-[#FAFBFD] dark:bg-[#0c0e12] relative min-w-0">
          <PlaybookCanvasWrapper
            canvas={canvasView}
            onChange={setCanvas}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
          {/* Hint quando canvas vazio */}
          {canvas.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center max-w-sm">
                <div
                  className={`inline-flex w-14 h-14 rounded-[14px] bg-white dark:bg-[#14171c] border ${FC.hair} shadow-[0_8px_24px_-4px_rgb(15,23,42,0.08)] dark:shadow-none items-center justify-center mb-3`}
                >
                  <Workflow className="w-7 h-7 text-[#003083] dark:text-[#5b9bff]" />
                </div>
                <h3 className={`text-[15px] font-semibold mb-1 ${FC.ink}`}>Comece arrastando um gatilho</h3>
                <p className={`text-[13px] leading-relaxed ${FC.sub}`}>
                  Arraste um nó da paleta à esquerda pra começar. Todo playbook precisa ter pelo menos um gatilho.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* DOCK DIREITO — config do nó e teste dividem a mesma coluna, em abas.
            Fixo (não é modal): dá pra ajustar o nó e rodar o teste sem trocar de tela. */}
        {configCollapsed ? (
          <NodeConfigPanel
            node={selectedNode}
            onChange={updateNodeData}
            onDelete={deleteSelectedNode}
            onClose={() => setSelectedNodeId(null)}
            collapsed
            onToggleCollapse={() => setConfigCollapsed(false)}
          />
        ) : (
          <div className="w-[400px] shrink-0 border-l border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#0c0e12] flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-3 pt-2 border-b border-[#EDEDED] dark:border-[#23272e] shrink-0">
              {(["config", "test"] as const).map((t) => {
                const on = rightTab === t;
                const label = t === "config" ? "Configuração" : "Teste";
                return (
                  <button
                    key={t}
                    onClick={() => setRightTab(t)}
                    className={`relative h-9 px-3 text-[13px] transition-colors ${
                      on
                        ? "font-medium text-[#262626] dark:text-[#e6e8eb]"
                        : "text-[#262626]/[0.56] dark:text-[#8b93a0] hover:text-[#262626] dark:hover:text-[#e6e8eb]"
                    }`}
                  >
                    {label}
                    {t === "test" && lastRun && (
                      <span
                        className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle ${
                          lastRun.status === "error" ? "bg-[#C0271F]" : "bg-[#00A66C]"
                        }`}
                      />
                    )}
                    {on && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#003083] dark:bg-[#5b9bff]" />}
                  </button>
                );
              })}
              <button
                onClick={() => setConfigCollapsed(true)}
                className={`${iconBtn} ml-auto mb-1`}
                title="Recolher painel"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {rightTab === "config" ? (
                <NodeConfigPanel
                  node={selectedNode}
                  onChange={updateNodeData}
                  onDelete={deleteSelectedNode}
                  onClose={() => setSelectedNodeId(null)}
                  collapsed={false}
                  onToggleCollapse={() => setConfigCollapsed(true)}
                  embedded
                />
              ) : (
                <TestPanel
                  playbookId={pb.id}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onResult={(r, s) => {
                    setLastRun(r);
                    setLastSteps(s);
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SaveBadge({ saving, lastSavedAt }: { saving: boolean; lastSavedAt: Date | null }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[#697386] px-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Salvando...
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 px-2">
        <Cloud className="w-3 h-3" />
        Salvo
      </span>
    );
  }
  return null;
}

function StatusPill({ status }: { status: "draft" | "published" | "archived" }) {
  const map = {
    published: { label: "Publicado", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", icon: CheckCircle2 },
    archived: { label: "Arquivado", cls: "bg-slate-50 text-slate-500 ring-1 ring-slate-200", icon: null },
    draft: { label: "Rascunho", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", icon: null },
  } as const;
  const m = map[status];
  const Icon = m.icon as any;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${m.cls}`}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {m.label}
    </span>
  );
}

// ─── Painel de teste (fixo na coluna direita, ao lado do canvas)
// Antes era uma gaveta modal: abria, testava, fechava, ajustava, abria de novo.
// Fixo, dá pra mexer no nó e rodar de novo sem perder o canvas de vista.
function TestPanel({
  playbookId,
  selectedNodeId,
  onSelectNode,
  onResult,
}: {
  playbookId: number;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onResult: (r: TestRunResult | null, s: StepLog[]) => void;
}) {
  const [input, setInput] = useState("oi");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [openStep, setOpenStep] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setSteps([]);
    onResult(null, []);
    try {
      const { data } = await api.post<TestRunResult>(`/playbooks/${playbookId}/test-run`, {
        input_message: input,
        sender_name: "Tester",
      });
      setResult(data);
      const { data: stepsData } = await api.get<StepLog[]>(
        `/playbooks/executions/${data.execution_id}/steps`,
      );
      setSteps(stepsData);
      onResult(data, stepsData);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro no test-run");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3.5 border-b border-[#EDEDED] dark:border-[#23272e]">
        <label className={`block text-[12px] font-medium mb-1.5 ${FC.sub}`}>Mensagem do cliente</label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex: oi, quanto custa?"
          className={`w-full h-9 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running) run();
          }}
        />
        <button onClick={run} disabled={running} className={`w-full mt-2.5 ${btnPrimary}`}>
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Rodar simulação
        </button>
        <p className={`mt-2 text-[11px] ${FC.mut}`}>Simulação — não envia mensagem real ao canal.</p>
      </div>

      {result && (
        <div className="px-4 py-3 border-b border-[#EDEDED] dark:border-[#23272e] flex items-center gap-4">
          <span
            className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
              result.status === "error" ? "text-[#C0271F]" : "text-[#0B7A55] dark:text-[#5FC091]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                result.status === "error" ? "bg-[#C0271F]" : "bg-[#00A66C]"
              }`}
            />
            {result.status}
          </span>
          <span className={`text-[12px] ${FC.sub}`}>{result.steps_executed} passo(s)</span>
          <span className={`text-[12px] ${FC.sub}`}>{result.messages_sent} mensagem(ns)</span>
        </div>
      )}

      {steps.length > 0 && (
        <div className="px-4 py-3.5">
          <h4 className={`text-[11px] font-semibold uppercase tracking-wider mb-2.5 ${FC.mut}`}>
            Percurso
          </h4>
          <div className="space-y-1.5">
            {steps.map((s, idx) => {
              const err = s.status === "error";
              const isSel = selectedNodeId === s.node_id;
              const open = openStep === s.id;
              const sources = Array.isArray(s.output_json?.sources) ? s.output_json!.sources : [];
              return (
                <div
                  key={s.id}
                  className={`rounded-lg border transition-colors ${
                    err
                      ? "border-[#C0271F]/30 bg-[#C0271F]/[0.04]"
                      : isSel
                        ? "border-[#003083]/40 dark:border-[#5b9bff]/40 bg-[#003083]/[0.03] dark:bg-[#5b9bff]/[0.06]"
                        : "border-[#EDEDED] dark:border-[#23272e]"
                  }`}
                >
                  {/* Clicar no passo seleciona o nó no canvas — é o elo que faltava
                      entre "o que rodou" e "onde ajustar". */}
                  <button
                    onClick={() => {
                      onSelectNode(s.node_id);
                      setOpenStep(open ? null : s.id);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
                  >
                    <span
                      className={`w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-full text-[10px] font-semibold ${
                        err
                          ? "bg-[#C0271F]/10 text-[#C0271F]"
                          : "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className={`font-mono text-[11px] truncate flex-1 ${FC.ink}`}>{s.node_type}</span>
                    <span className={`text-[10px] shrink-0 ${FC.mut}`}>{s.latency_ms ?? 0}ms</span>
                  </button>

                  {open && (
                    <div className="px-2.5 pb-2.5">
                      {sources.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {sources.map((src: any, i: number) => (
                            <span
                              key={i}
                              title={`Score ${src.score} · trecho ${src.position}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#00A66C]/[0.10] text-[#0B7A55] dark:text-[#5FC091]"
                            >
                              <FileText className="w-3 h-3" />
                              {src.title}
                            </span>
                          ))}
                        </div>
                      )}
                      {s.output_json && Object.keys(s.output_json).length > 0 && (
                        <pre
                          className={`text-[10px] font-mono overflow-x-auto whitespace-pre-wrap p-2 rounded ${FC.mut} bg-[#F9F9F9] dark:bg-[#0c0e12]`}
                        >
                          {JSON.stringify(s.output_json, null, 2)}
                        </pre>
                      )}
                      {s.error && <div className="text-[11px] text-[#C0271F] mt-1">{s.error}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {result && Object.keys(result.vars || {}).length > 0 && (
            <>
              <h4 className={`text-[11px] font-semibold uppercase tracking-wider mt-4 mb-2 ${FC.mut}`}>
                Variáveis ao final
              </h4>
              <pre
                className={`text-[10px] font-mono overflow-x-auto whitespace-pre-wrap p-2 rounded ${FC.mut} bg-[#F9F9F9] dark:bg-[#0c0e12]`}
              >
                {JSON.stringify(result.vars, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      {!result && !running && (
        <div className={`px-4 py-8 text-center text-[12px] ${FC.mut}`}>
          Rode uma simulação para ver o caminho que a mensagem percorre.
        </div>
      )}
    </div>
  );
}

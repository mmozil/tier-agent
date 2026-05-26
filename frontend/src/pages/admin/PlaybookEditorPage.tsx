import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  History,
  Loader2,
  Play,
  Send,
  Trash2,
  Workflow,
} from "lucide-react";

import { api } from "@/lib/api";
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
  const [showTest, setShowTest] = useState(false);

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
      await api.put(`/playbooks/${pb.id}`, { canvas_json: canvas });
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
        <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
      </div>
    );
  }

  // Layout fullwidth — escapa do container max-w-[1400px] do AdminLayout
  return (
    <div
      className="fixed inset-0 left-[240px] flex flex-col bg-[#FAFBFD] z-10"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif' }}
    >
      {/* TOPBAR */}
      <div className="h-12 px-4 flex items-center gap-2 bg-white border-b border-slate-200 shrink-0">
        <Link
          to="/admin/playbooks"
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="w-px h-5 bg-slate-200" />

        <div className="flex-1 min-w-0 px-1">
          <div className="text-[13px] font-semibold text-[#1a2c44] truncate leading-tight">{pb.nome}</div>
          {pb.descricao && (
            <div className="text-[11px] text-[#697386] truncate leading-tight">{pb.descricao}</div>
          )}
        </div>

        <SaveBadge saving={saving} lastSavedAt={lastSavedAt} />
        <StatusPill status={pb.status} />

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <Link
          to={`/admin/playbooks/${pb.id}/executions`}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 text-[#404452] hover:bg-slate-100 transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          Execuções
        </Link>
        <button
          onClick={() => setShowTest(true)}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 text-[#404452] hover:bg-slate-100 transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          Testar
        </button>
        <button
          onClick={archive}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 text-[#404452] hover:bg-slate-100 transition-colors"
          title="Arquivar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={publish}
          disabled={publishing}
          className="h-7 px-3.5 rounded-md text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50 shadow-sm shadow-[#003083]/20 transition-all"
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
        <div className="flex-1 bg-[#FAFBFD] relative min-w-0">
          <PlaybookCanvasWrapper
            canvas={canvas}
            onChange={setCanvas}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
          {/* Hint quando canvas vazio */}
          {canvas.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center max-w-sm">
                <div className="inline-flex w-14 h-14 rounded-2xl bg-white shadow-[0_0_0_1px_rgb(226,232,240),0_8px_24px_-4px_rgb(15,23,42,0.08)] items-center justify-center mb-3">
                  <Workflow className="w-7 h-7 text-[#003083]" />
                </div>
                <h3 className="text-[15px] font-semibold text-[#1a2c44] mb-1">Comece arrastando um gatilho</h3>
                <p className="text-[13px] text-[#697386] leading-relaxed">
                  Arraste um nó da paleta à esquerda pra começar. Todo playbook precisa ter pelo menos um gatilho.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* CONFIG PANEL — direita */}
        <NodeConfigPanel
          node={selectedNode}
          onChange={updateNodeData}
          onDelete={deleteSelectedNode}
          onClose={() => setSelectedNodeId(null)}
          collapsed={configCollapsed}
          onToggleCollapse={() => setConfigCollapsed((v) => !v)}
        />
      </div>

      {showTest && pb && <TestRunDrawer playbookId={pb.id} onClose={() => setShowTest(false)} />}
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

// ─── Test Run Drawer (simulação)
function TestRunDrawer({ playbookId, onClose }: { playbookId: number; onClose: () => void }) {
  const [input, setInput] = useState("oi");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [steps, setSteps] = useState<any[]>([]);

  async function run() {
    setRunning(true);
    setResult(null);
    setSteps([]);
    try {
      const { data } = await api.post<TestRunResult>(`/playbooks/${playbookId}/test-run`, {
        input_message: input,
        sender_name: "Tester",
      });
      setResult(data);
      const { data: stepsData } = await api.get<any[]>(`/playbooks/executions/${data.execution_id}/steps`);
      setSteps(stepsData);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro no test-run");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[500px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1a2c44]">Testar playbook</h3>
            <p className="text-[11px] text-[#697386] mt-0.5">Simulação — não envia mensagem real ao canal</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 border-b border-slate-100">
          <div>
            <label className="block text-[12px] font-medium text-[#1a2c44] mb-1.5">Mensagem do cliente</label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex: oi, quanto custa?"
              className="w-full h-9 px-3 text-[14px] rounded-lg bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !running) run();
              }}
            />
          </div>
          <button
            onClick={run}
            disabled={running}
            className="w-full h-9 rounded-lg text-[13px] font-semibold inline-flex items-center justify-center gap-2 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50 shadow-sm shadow-[#003083]/20 transition-all"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Rodar simulação
          </button>
        </div>

        {result && (
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="bg-slate-50 rounded-lg p-3 text-[12px] space-y-1.5">
              <KV label="Status" value={result.status} />
              <KV label="Steps executados" value={String(result.steps_executed)} />
              <KV label="Mensagens enviadas" value={String(result.messages_sent)} />
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div className="px-5 py-4 flex-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#697386] mb-3">Timeline</h4>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div
                  key={s.id}
                  className={`rounded-lg p-3 text-[12px] ${
                    s.status === "error"
                      ? "bg-red-50 ring-1 ring-red-200"
                      : "bg-white shadow-[0_0_0_1px_rgb(226,232,240)]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                        {idx + 1}
                      </span>
                      <span className="font-mono text-[11px] text-[#003083] font-medium">{s.node_type}</span>
                    </div>
                    <span className="text-[10px] text-[#697386]">{s.latency_ms ?? 0}ms</span>
                  </div>
                  {s.output_json && Object.keys(s.output_json).length > 0 && (
                    <pre className="text-[10px] font-mono text-[#697386] overflow-x-auto whitespace-pre-wrap mt-1 bg-slate-50 p-2 rounded">
                      {JSON.stringify(s.output_json, null, 2)}
                    </pre>
                  )}
                  {s.error && <div className="text-[11px] text-red-600 mt-1">⚠ {s.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#697386]">{label}</span>
      <span className="font-medium text-[#1a2c44]">{value}</span>
    </div>
  );
}

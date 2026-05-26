import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, CheckCircle2, Cloud, History, Loader2, Play, Send, Trash2 } from "lucide-react";

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
  canvas_json: CanvasShape;
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

  // ─── Load
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Playbook>(`/playbooks/${id}`);
        setPb(data);
        setCanvas(
          data.canvas_json?.nodes
            ? (data.canvas_json as CanvasShape)
            : emptyCanvas(),
        );
      } catch {
        toast.error("Playbook não encontrado");
        navigate("/admin/playbooks");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  // ─── Auto-save (debounce 1s)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const persistCanvas = useCallback(async () => {
    if (!pb) return;
    setSaving(true);
    try {
      await api.put(`/playbooks/${pb.id}`, { canvas_json: canvas });
      setLastSavedAt(new Date());
      dirtyRef.current = false;
      // se editou após publicar, status voltou pra draft (backend faz isso)
      setPb((prev) => (prev && prev.status === "published" ? { ...prev, status: "draft" } : prev));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }, [canvas, pb]);

  useEffect(() => {
    if (!pb || loading) return;
    // Ignora 1º render pós-load
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

  // ─── Drag node from palette → canvas
  const onDragStartFromPalette = useCallback((e: React.DragEvent, meta: NodeKindMeta) => {
    e.dataTransfer.setData("application/tier-playbook-node", JSON.stringify(meta));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  // ─── Edição de nó pelo painel direito
  const selectedNode = useMemo(
    () => canvas.nodes.find((n) => n.id === selectedNodeId) || null,
    [canvas.nodes, selectedNodeId],
  );

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

  // ─── Publish
  async function publish() {
    if (!pb) return;
    if (!canvas.nodes.length) {
      toast.error("Adicione pelo menos um nó");
      return;
    }
    const hasTrigger = canvas.nodes.some((n) => n.type.startsWith("trigger_"));
    if (!hasTrigger) {
      toast.error("Adicione pelo menos um nó de gatilho (Palavra-chave, Manual, etc)");
      return;
    }
    // garante save antes de publicar
    if (dirtyRef.current) {
      await persistCanvas();
    }
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

  return (
    <div className="-mx-8 -mb-8">
      {/* Top bar editor */}
      <div className="px-6 h-12 flex items-center gap-3 border-b border-slate-200 bg-white">
        <Link
          to="/admin/playbooks"
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[#1a2c44] truncate">{pb.nome}</div>
          {pb.descricao && (
            <div className="text-[11px] text-[#697386] truncate">{pb.descricao}</div>
          )}
        </div>
        <SaveBadge saving={saving} lastSavedAt={lastSavedAt} />
        <StatusPill status={pb.status} />
        <Link
          to={`/admin/playbooks/${pb.id}/executions`}
          className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          <History className="w-3 h-3" />
          Execuções
        </Link>
        <button
          onClick={() => setShowTest(true)}
          className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          <Play className="w-3 h-3" />
          Testar
        </button>
        <button
          onClick={archive}
          className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          <Trash2 className="w-3 h-3" />
          Arquivar
        </button>
        <button
          onClick={publish}
          disabled={publishing}
          className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
        >
          {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {pb.status === "published" ? "Republicar" : "Publicar"}
        </button>
      </div>

      {/* Editor layout: palette + canvas + config */}
      <div className="flex" style={{ height: "calc(100vh - 60px - 48px)" }}>
        <NodePalette onDragStart={onDragStartFromPalette} />
        <div className="flex-1 bg-[#f4f7fa]">
          <PlaybookCanvasWrapper
            canvas={canvas}
            onChange={setCanvas}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
        </div>
        <NodeConfigPanel
          node={selectedNode}
          onChange={updateNodeData}
          onDelete={deleteSelectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      </div>

      {showTest && pb && (
        <TestRunDrawer playbookId={pb.id} onClose={() => setShowTest(false)} />
      )}
    </div>
  );
}

function SaveBadge({ saving, lastSavedAt }: { saving: boolean; lastSavedAt: Date | null }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#697386]">
        <Loader2 className="w-3 h-3 animate-spin" />
        Salvando...
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#697386]">
        <Cloud className="w-3 h-3" />
        Salvo
      </span>
    );
  }
  return null;
}

function StatusPill({ status }: { status: "draft" | "published" | "archived" }) {
  if (status === "published")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-600">
        <CheckCircle2 className="w-3 h-3" />
        Publicado
      </span>
    );
  if (status === "archived")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-500/15 text-slate-500">
        Arquivado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-600">
      Rascunho
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
      const { data: stepsData } = await api.get<any[]>(
        `/playbooks/executions/${data.execution_id}/steps`,
      );
      setSteps(stepsData);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro no test-run");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-[480px] bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[#1a2c44]">Testar playbook</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-[#1a2c44] mb-1.5">
              Mensagem do cliente
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex: oi, quanto custa?"
              className="w-full h-7 px-3 text-[13px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
            />
          </div>
          <button
            onClick={run}
            disabled={running}
            className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Rodar simulação
          </button>
        </div>

        {result && (
          <div className="px-5 py-4 border-t border-slate-100">
            <div className="bg-[#f4f7fa] rounded-md p-3 text-[12px] space-y-1">
              <div>
                <span className="text-[#697386]">Status:</span>{" "}
                <span className="font-medium text-[#1a2c44]">{result.status}</span>
              </div>
              <div>
                <span className="text-[#697386]">Steps executados:</span>{" "}
                <span className="font-medium text-[#1a2c44]">{result.steps_executed}</span>
              </div>
              <div>
                <span className="text-[#697386]">Mensagens "enviadas":</span>{" "}
                <span className="font-medium text-[#1a2c44]">{result.messages_sent}</span>
              </div>
              <div className="text-[10px] text-[#697386]">
                (modo simulação não envia mensagem real ao canal)
              </div>
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100">
            <h4 className="text-[12px] font-semibold text-[#1a2c44] mb-3">Timeline</h4>
            <div className="space-y-2">
              {steps.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-md p-3 text-[12px] ${
                    s.status === "error"
                      ? "bg-red-50 border border-red-200"
                      : "bg-white shadow-[0_0_0_1px_rgb(226,232,240)]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[11px] text-[#003083]">{s.node_type}</span>
                    <span className="text-[10px] text-[#697386]">{s.latency_ms}ms</span>
                  </div>
                  {s.output_json && Object.keys(s.output_json).length > 0 && (
                    <pre className="text-[10px] font-mono text-[#697386] overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(s.output_json, null, 2)}
                    </pre>
                  )}
                  {s.error && (
                    <div className="text-[11px] text-red-600 mt-1">⚠ {s.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

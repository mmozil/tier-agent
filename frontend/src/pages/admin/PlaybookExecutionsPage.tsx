import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  PauseCircle,
  Users,
  XCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button, EmptyHint, SkeletonBar } from "@/components/ds/fc";

interface Execution {
  id: number;
  playbook_id: number;
  agent_id: number;
  conversation_id: number | null;
  trigger_type: string | null;
  status: "running" | "completed" | "failed" | "waiting" | "handed_off";
  vars_json: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface StepLog {
  id: number;
  node_id: string;
  node_type: string;
  status: string;
  latency_ms: number | null;
  cost_cents: number;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

interface Playbook {
  id: number;
  nome: string;
}

export default function PlaybookExecutionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pb, setPb] = useState<Playbook | null>(null);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExecId, setSelectedExecId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [pbRes, execsRes] = await Promise.all([
        api.get<Playbook>(`/playbooks/${id}`),
        api.get<Execution[]>(`/playbooks/${id}/executions`, { params: { limit: 100 } }),
      ]);
      setPb(pbRes.data);
      setExecs(execsRes.data);
    } catch {
      toast.error("Falha ao carregar execuções");
      navigate("/admin/playbooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !pb) {
    return <ExecutionsSkeleton />;
  }

  const th = `text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2.5 ${FC.sub}`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start gap-3 p-6">
            <Link
              to={`/admin/playbooks/${id}`}
              className={`w-7 h-7 inline-flex items-center justify-center rounded-md ${FC.mut} ${FC.hover} mt-0.5`}
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex-1 min-w-0">
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 truncate ${FC.ink}`}>Execuções · {pb.nome}</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Últimas {execs.length} execuções deste playbook. Clique pra ver os steps.</p>
            </div>
            <Button variant="secondary" onClick={load} className="shrink-0">Atualizar</Button>
          </div>
        </Row>

        {execs.length === 0 ? (
          <Row last>
            <EmptyHint
              icon={Clock}
              text="Nenhuma execução ainda. Quando uma mensagem disparar este playbook, aparecerá aqui."
              className="py-12"
            />
          </Row>
        ) : (
          <Row last>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${FC.hair}`}>
                    <th className={th}>ID</th>
                    <th className={th}>Gatilho</th>
                    <th className={th}>Status</th>
                    <th className={th}>Iniciado</th>
                    <th className={th}>Duração</th>
                    <th className="px-6 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {execs.map((exe) => (
                    <ExecutionRow key={exe.id} exe={exe} onSelect={() => setSelectedExecId(exe.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </Row>
        )}
      </PageFrame>

      {selectedExecId !== null && <ExecutionStepsDrawer executionId={selectedExecId} onClose={() => setSelectedExecId(null)} />}
    </div>
  );
}

// Carregando, a página mostra a própria forma (cabeçalho + tabela), não um spinner no vazio.
function ExecutionsSkeleton() {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start gap-3 p-6">
            <SkeletonBar className="w-7 h-7 rounded-md mt-0.5" />
            <div className="flex-1">
              <SkeletonBar className="h-5 w-64 mb-2" />
              <SkeletonBar className="h-3 w-80" />
            </div>
          </div>
        </Row>
        <Row last>
          <div className="px-6 py-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-6">
                <SkeletonBar className="h-3 w-10" />
                <SkeletonBar className="h-3 w-24" />
                <SkeletonBar className="h-4 w-20 rounded" />
                <SkeletonBar className="h-3 w-28" />
                <SkeletonBar className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

function ExecutionRow({ exe, onSelect }: { exe: Execution; onSelect: () => void }) {
  const dur =
    exe.completed_at && exe.started_at
      ? `${Math.round((new Date(exe.completed_at).getTime() - new Date(exe.started_at).getTime()) / 1000)}s`
      : "—";

  return (
    <tr onClick={onSelect} className={`border-b ${FC.hair} last:border-b-0 ${FC.hover} cursor-pointer`}>
      <td className={`px-6 py-3 text-[13px] font-mono ${FC.sub}`}>#{exe.id}</td>
      <td className={`px-6 py-3 text-[13px] ${FC.ink}`}>{exe.trigger_type?.replace("trigger_", "") || "—"}</td>
      <td className="px-6 py-3"><StatusBadge status={exe.status} /></td>
      <td className={`px-6 py-3 text-[13px] ${FC.sub}`}>
        {new Date(exe.started_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </td>
      <td className={`px-6 py-3 text-[13px] tabular-nums ${FC.sub}`}>{dur}</td>
      <td className="px-6 py-3 text-right"><ChevronRight className={`w-4 h-4 ${FC.mut} inline`} /></td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Execution["status"] }) {
  const map: Record<Execution["status"], { label: string; cls: string; icon: any }> = {
    running: { label: "Rodando", cls: "bg-[#003083]/[0.12] text-[#003083] dark:text-[#5b9bff]", icon: Loader2 },
    completed: { label: "Completo", cls: "bg-[#0a8f5a]/[0.12] text-[#0a8f5a]", icon: CheckCircle2 },
    failed: { label: "Falhou", cls: "bg-[#E5484D]/[0.12] text-[#E5484D]", icon: XCircle },
    waiting: { label: "Aguardando", cls: "bg-[#F5A300]/[0.14] text-[#9a6700]", icon: PauseCircle },
    handed_off: { label: "Humano assumiu", cls: "bg-[#8B5CF6]/[0.12] text-[#8B5CF6]", icon: Users },
  };
  const m = map[status] || { label: status, cls: "bg-[#262626]/[0.08] text-[#262626]/[0.56]", icon: AlertCircle };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${m.cls}`}>
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {m.label}
    </span>
  );
}

function ExecutionStepsDrawer({ executionId, onClose }: { executionId: number; onClose: () => void }) {
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<StepLog[]>(`/playbooks/executions/${executionId}/steps`);
        setSteps(data);
      } catch {
        toast.error("Erro ao carregar steps");
      } finally {
        setLoading(false);
      }
    })();
  }, [executionId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-[520px] bg-white dark:bg-[#0c0e12] h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-4 border-b ${FC.hair} flex items-center justify-between sticky top-0 bg-white dark:bg-[#0c0e12]`}>
          <h3 className={`text-[16px] font-[450] ${FC.ink}`}>Execução #{executionId}</h3>
          <button onClick={onClose} className={`w-7 h-7 inline-flex items-center justify-center rounded-md ${FC.mut} ${FC.hover}`}>×</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" />
          </div>
        ) : steps.length === 0 ? (
          <div className={`p-8 text-center text-[13px] ${FC.sub}`}>Sem steps registrados.</div>
        ) : (
          <div className="px-5 py-4 space-y-2">
            {steps.map((s, idx) => (
              <div
                key={s.id}
                className={`rounded-md p-3 text-[12px] ${
                  s.status === "error" ? "bg-[#E5484D]/[0.06] border border-[#E5484D]/30" : `border ${FC.hair}`
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[11px] text-[#003083] dark:text-[#5b9bff]">{idx + 1}. {s.node_type}</span>
                  <span className={`text-[10px] ${FC.sub}`}>
                    {s.latency_ms ?? 0}ms{s.cost_cents > 0 && ` · R$ ${(s.cost_cents / 100).toFixed(2)}`}
                  </span>
                </div>
                {s.output_json && Object.keys(s.output_json).length > 0 && (
                  <pre className={`text-[10px] font-mono overflow-x-auto whitespace-pre-wrap mt-1 ${FC.sub}`}>
                    {JSON.stringify(s.output_json, null, 2)}
                  </pre>
                )}
                {s.error && <div className="text-[11px] text-[#E5484D] mt-1">⚠ {s.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mt-6 mb-2">
        <Link
          to={`/admin/playbooks/${id}`}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[28px] font-bold text-[#30313d] flex-1 truncate">
          Execuções · {pb.nome}
        </h1>
        <button
          onClick={load}
          className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          Atualizar
        </button>
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Últimas {execs.length} execuções deste playbook. Clique pra ver os steps.
      </p>

      {execs.length === 0 ? (
        <div className="bg-[#f4f7fa] rounded-lg p-12 text-center">
          <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
            <Clock className="w-6 h-6 text-[#003083]" />
          </div>
          <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">
            Nenhuma execução ainda
          </h3>
          <p className="text-[13px] text-[#697386]">
            Quando uma mensagem disparar este playbook, aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-md shadow-[0_0_0_1px_rgb(226,232,240)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left bg-[#f4f7fa] border-b border-slate-200">
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
                  ID
                </th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
                  Gatilho
                </th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
                  Status
                </th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
                  Iniciado
                </th>
                <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
                  Duração
                </th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {execs.map((exe) => (
                <ExecutionRow
                  key={exe.id}
                  exe={exe}
                  onSelect={() => setSelectedExecId(exe.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedExecId !== null && (
        <ExecutionStepsDrawer
          executionId={selectedExecId}
          onClose={() => setSelectedExecId(null)}
        />
      )}
    </div>
  );
}

function ExecutionRow({ exe, onSelect }: { exe: Execution; onSelect: () => void }) {
  const dur =
    exe.completed_at && exe.started_at
      ? `${Math.round(
          (new Date(exe.completed_at).getTime() - new Date(exe.started_at).getTime()) / 1000,
        )}s`
      : "—";

  return (
    <tr
      onClick={onSelect}
      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer"
    >
      <td className="px-4 py-3 text-[13px] font-mono text-[#697386]">#{exe.id}</td>
      <td className="px-4 py-3 text-[13px] text-[#1a2c44]">
        {exe.trigger_type?.replace("trigger_", "") || "—"}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={exe.status} />
      </td>
      <td className="px-4 py-3 text-[13px] text-[#697386]">
        {new Date(exe.started_at).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </td>
      <td className="px-4 py-3 text-[13px] font-mono text-[#697386]">{dur}</td>
      <td className="px-4 py-3 text-right">
        <ChevronRight className="w-4 h-4 text-slate-300 inline" />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Execution["status"] }) {
  const map: Record<Execution["status"], { label: string; cls: string; icon: any }> = {
    running: {
      label: "Rodando",
      cls: "bg-blue-500/15 text-blue-600",
      icon: Loader2,
    },
    completed: {
      label: "Completo",
      cls: "bg-emerald-500/15 text-emerald-600",
      icon: CheckCircle2,
    },
    failed: { label: "Falhou", cls: "bg-red-500/15 text-red-600", icon: XCircle },
    waiting: {
      label: "Aguardando",
      cls: "bg-amber-500/15 text-amber-600",
      icon: PauseCircle,
    },
    handed_off: {
      label: "Humano assumiu",
      cls: "bg-purple-500/15 text-purple-600",
      icon: Users,
    },
  };
  const m = map[status] || { label: status, cls: "bg-slate-500/15 text-slate-500", icon: AlertCircle };
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${m.cls}`}
    >
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {m.label}
    </span>
  );
}

function ExecutionStepsDrawer({
  executionId,
  onClose,
}: {
  executionId: number;
  onClose: () => void;
}) {
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
      <div
        className="w-[520px] bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-[16px] font-semibold text-[#1a2c44]">Execução #{executionId}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
          </div>
        ) : steps.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#697386]">Sem steps registrados.</div>
        ) : (
          <div className="px-5 py-4 space-y-2">
            {steps.map((s, idx) => (
              <div
                key={s.id}
                className={`rounded-md p-3 text-[12px] ${
                  s.status === "error"
                    ? "bg-red-50 border border-red-200"
                    : "bg-white shadow-[0_0_0_1px_rgb(226,232,240)]"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[11px] text-[#003083]">
                    {idx + 1}. {s.node_type}
                  </span>
                  <span className="text-[10px] text-[#697386]">
                    {s.latency_ms ?? 0}ms
                    {s.cost_cents > 0 && ` · R$ ${(s.cost_cents / 100).toFixed(2)}`}
                  </span>
                </div>
                {s.output_json && Object.keys(s.output_json).length > 0 && (
                  <pre className="text-[10px] font-mono text-[#697386] overflow-x-auto whitespace-pre-wrap mt-1">
                    {JSON.stringify(s.output_json, null, 2)}
                  </pre>
                )}
                {s.error && <div className="text-[11px] text-red-600 mt-1">⚠ {s.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

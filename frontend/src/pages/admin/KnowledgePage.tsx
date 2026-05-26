import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Upload, FileText, FileSpreadsheet, FileType, Trash2 } from "lucide-react";

import { api } from "@/lib/api";

interface Agent {
  id: number;
  nome: string;
}

interface Knowledge {
  id: number;
  agent_id: number;
  kind: string;
  title: string;
  status: string;
  chunks_count: number;
  indexed_at: string | null;
  skill_md_path: string | null;
  source_url: string | null;
}

const KIND_META: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  pdf: { icon: FileText, color: "text-rose-600", label: "PDF" },
  sheet: { icon: FileSpreadsheet, color: "text-emerald-600", label: "Planilha" },
  text: { icon: FileType, color: "text-slate-500", label: "Texto" },
  unknown: { icon: FileType, color: "text-slate-400", label: "—" },
};

const STATUS_META: Record<string, { color: string; label: string; tip: string }> = {
  ready: { color: "bg-emerald-500", label: "Indexado", tip: "Conhecimento disponível pro agente" },
  indexing: { color: "bg-amber-500", label: "Indexando", tip: "Processando arquivo" },
  failed: { color: "bg-rose-500", label: "Falhou", tip: "Verifique arquivo e reenvie" },
};

export default function KnowledgePage() {
  const [items, setItems] = useState<Knowledge[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [k, a] = await Promise.all([
        api.get<Knowledge[]>("/knowledge"),
        api.get<Agent[]>("/agents"),
      ]);
      setItems(k.data);
      setAgents(a.data);
      if (!selectedAgent && a.data.length > 0) setSelectedAgent(a.data[0].id);
    } catch {
      toast.error("Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!selectedAgent) {
      toast.error("Escolha um agente");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error("Arquivo > 20MB");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("agent_id", String(selectedAgent));
    fd.append("file", f);
    fd.append("title", f.name.replace(/\.[^.]+$/, ""));
    try {
      await api.post("/knowledge/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Indexado");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Remover este conhecimento?")) return;
    try {
      await api.delete(`/knowledge/${id}`);
      toast.success("Removido");
      load();
    } catch {
      toast.error("Erro ao remover");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Knowledge</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Suba PDF, planilhas e textos. Vira skill consumível pelo agente em segundos.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-[14px] font-medium text-slate-900 mb-3">Novo arquivo</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-[12px] text-slate-700">Agente</span>
            <select
              value={selectedAgent || ""}
              onChange={(e) => setSelectedAgent(Number(e.target.value))}
              className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] text-slate-700">Arquivo (PDF, XLSX, TXT — máx 20MB)</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.txt,.md"
              onChange={onUpload}
              disabled={uploading}
              className="mt-1 w-full text-[13px] file:h-6 file:px-2 file:text-[12px] file:bg-tier file:text-white file:border-0 file:rounded-md file:mr-3 file:cursor-pointer"
            />
          </label>
          <button
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="h-6 px-2 bg-tier hover:bg-tier-dark text-white text-[12px] rounded-md inline-flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
          >
            <Upload className="w-3 h-3 shrink-0" />
            {uploading ? "Enviando..." : "Upload"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Arquivo</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Agente</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Chunks</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Status</th>
              <th className="text-right text-[12px] font-medium text-slate-600 px-4 py-2.5 w-[80px]">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Nenhum arquivo. Suba seu primeiro acima.
                </td>
              </tr>
            )}
            {items.map((k) => {
              const km = KIND_META[k.kind] || KIND_META.unknown;
              const sm = STATUS_META[k.status] || STATUS_META.indexing;
              const Icon = km.icon;
              return (
                <tr key={k.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-slate-900">
                    <div className="inline-flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${km.color}`} />
                      {k.title}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700">
                    {agents.find((a) => a.id === k.agent_id)?.nome || `#${k.agent_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-600 font-mono">{k.chunks_count}</td>
                  <td className="px-4 py-2.5 text-[13px]">
                    <span className="group relative inline-flex items-center gap-1.5 cursor-help">
                      <span className={`w-2 h-2 rounded-full ${sm.color}`} />
                      <span className="text-slate-700">{sm.label}</span>
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-900 text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-10 shadow-lg"
                        role="tooltip"
                      >
                        {sm.tip}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-900" />
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end">
                      <button
                        onClick={() => onDelete(k.id)}
                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

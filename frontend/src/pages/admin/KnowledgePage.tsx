import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Upload, FileText, FileSpreadsheet, FileType, Trash2, FolderOpen } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Button, EmptyHint, SKEL } from "@/components/ds/fc";

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
  pdf: { icon: FileText, color: "text-[#E5484D]", label: "PDF" },
  sheet: { icon: FileSpreadsheet, color: "text-[#0a8f5a]", label: "Planilha" },
  text: { icon: FileType, color: "text-[#262626]/40", label: "Texto" },
  unknown: { icon: FileType, color: "text-[#262626]/40", label: "—" },
};

const STATUS_META: Record<string, { color: string; label: string; tip: string }> = {
  ready: { color: "bg-[#0a8f5a]", label: "Indexado", tip: "Conhecimento disponível pro agente" },
  indexing: { color: "bg-[#F5A300]", label: "Indexando", tip: "Processando arquivo" },
  failed: { color: "bg-[#E5484D]", label: "Falhou", tip: "Verifique arquivo e reenvie" },
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

  const inputCls = `mt-1 w-full h-8 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;
  const th = `text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2.5 ${FC.sub}`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Knowledge</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
              Suba PDF, planilhas e textos. Vira skill consumível pelo agente em segundos.
            </p>
          </div>
        </Row>

        <Row>
          <div className="p-6">
            <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-3 ${FC.ink}`}>Novo arquivo</h3>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Agente</span>
                <select value={selectedAgent || ""} onChange={(e) => setSelectedAgent(Number(e.target.value))} className={inputCls}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Arquivo (PDF, XLSX, TXT — máx 20MB)</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.txt,.md"
                  onChange={onUpload}
                  disabled={uploading}
                  className="mt-1 w-full text-[13px] file:h-7 file:px-2.5 file:text-[12px] file:bg-[#003083] file:text-white file:border-0 file:rounded-lg file:mr-3 file:cursor-pointer"
                />
              </label>
              <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()} className="whitespace-nowrap">
                <Upload className="w-3.5 h-3.5 shrink-0" />
                {uploading ? "Enviando..." : "Upload"}
              </Button>
            </div>
          </div>
        </Row>

        <Row last>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${FC.hair}`}>
                  <th className={th}>Arquivo</th>
                  <th className={th}>Agente</th>
                  <th className={th}>Chunks</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right w-[80px]`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  [0, 1, 2].map((i) => (
                    // Skeleton ecoa as colunas da tabela (Arquivo · Agente · Chunks · Status · Ações).
                    <tr key={i} className={`border-b ${FC.hair}`}>
                      <td className="px-6 py-2.5">
                        <div className="inline-flex items-center gap-2">
                          <div className={`w-4 h-4 rounded ${SKEL}`} />
                          <div className={`h-3 w-40 ${SKEL}`} />
                        </div>
                      </td>
                      <td className="px-6 py-2.5"><div className={`h-3 w-24 ${SKEL}`} /></td>
                      <td className="px-6 py-2.5"><div className={`h-3 w-8 ${SKEL}`} /></td>
                      <td className="px-6 py-2.5"><div className={`h-3 w-20 ${SKEL}`} /></td>
                      <td className="px-6 py-2.5"><div className={`h-3 w-6 ml-auto ${SKEL}`} /></td>
                    </tr>
                  ))}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12">
                      <EmptyHint icon={FolderOpen} text="Nenhum conhecimento ainda. Suba seu primeiro arquivo no formulário acima." />
                    </td>
                  </tr>
                )}
                {items.map((k) => {
                  const km = KIND_META[k.kind] || KIND_META.unknown;
                  const sm = STATUS_META[k.status] || STATUS_META.indexing;
                  const Icon = km.icon;
                  return (
                    <tr key={k.id} className={`border-b ${FC.hair} last:border-0 ${FC.hover}`}>
                      <td className={`px-6 py-2.5 text-[13px] font-medium ${FC.ink}`}>
                        <div className="inline-flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${km.color}`} />
                          {k.title}
                        </div>
                      </td>
                      <td className={`px-6 py-2.5 text-[13px] ${FC.sub}`}>
                        {agents.find((a) => a.id === k.agent_id)?.nome || `#${k.agent_id}`}
                      </td>
                      <td className={`px-6 py-2.5 text-[13px] tabular-nums ${FC.sub}`}>{k.chunks_count}</td>
                      <td className="px-6 py-2.5 text-[13px]">
                        <span className="inline-flex items-center gap-1.5" title={sm.tip}>
                          <span className={`w-2 h-2 rounded-full ${sm.color}`} />
                          <span className={FC.sub}>{sm.label}</span>
                        </span>
                      </td>
                      <td className="px-6 py-2.5">
                        <div className="flex justify-end">
                          <button
                            onClick={() => onDelete(k.id)}
                            className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08] transition-colors`}
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
        </Row>
      </PageFrame>
    </div>
  );
}

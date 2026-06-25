import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Upload, FileText, FileSpreadsheet, FileType, Trash2, FolderOpen } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, PageHero, Row, Select, EmptyHint, SKEL, iconBtn } from "@/components/ds/fc";

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

  const th = `text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2.5 ${FC.sub}`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Knowledge"
          subtitle="Suba PDF, planilhas e textos. Vira skill consumível pelo agente em segundos."
        />

        <Row>
          <div className="p-6">
            <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] mb-3 ${FC.ink}`}>Novo arquivo</h3>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr] gap-3 items-end">
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Agente</span>
                <Select
                  value={selectedAgent}
                  onChange={(v) => setSelectedAgent(v)}
                  options={agents.map((a) => ({ value: a.id, label: a.nome }))}
                  placeholder="Escolha um agente"
                />
              </label>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Arquivo (PDF, XLSX, TXT — máx 20MB)</span>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || !selectedAgent}
                  className={`w-full h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] border ${FC.hair} bg-white dark:bg-[#14171c] text-[12px] font-medium ${FC.sub} transition-all active:scale-[0.98] hover:border-[#d8d8d8] dark:hover:border-[#33373e] focus:outline-none focus:shadow-[0_0_0_2px_#003083] disabled:opacity-50 disabled:pointer-events-none`}
                >
                  <Upload className="w-4 h-4 shrink-0 text-[#003083] dark:text-[#5b9bff]" />
                  {uploading ? "Enviando…" : "Escolher arquivo e enviar"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.txt,.md"
                  onChange={onUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
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
                            className={`${iconBtn} hover:text-[#E5484D] dark:hover:text-[#ff6b5e] hover:bg-[#E5484D]/[0.08]`}
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
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

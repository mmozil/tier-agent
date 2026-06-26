import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Upload, FileText, FileSpreadsheet, FileType, Trash2, FolderOpen,
  ChevronDown, ChevronRight, RefreshCw, Eye, Bot, X, Layers,
} from "lucide-react";

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

interface Chunk {
  id: number;
  position: number;
  tokens: number;
  text: string;
}

const KIND_META: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  pdf: { icon: FileText, color: "text-[#E5484D]", label: "PDF" },
  sheet: { icon: FileSpreadsheet, color: "text-[#0a8f5a]", label: "Planilha" },
  text: { icon: FileType, color: "text-[#262626]/40", label: "Texto" },
  manual: { icon: FileType, color: "text-[#003083] dark:text-[#5b9bff]", label: "Manual" },
  url: { icon: FileType, color: "text-[#003083] dark:text-[#5b9bff]", label: "URL" },
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
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [reindexing, setReindexing] = useState<number | null>(null);
  const [chunksFor, setChunksFor] = useState<Knowledge | null>(null);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
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

  async function onReindex(id: number) {
    setReindexing(id);
    try {
      await api.post(`/knowledge/${id}/reindex`);
      toast.success("Reindexado");
      load();
    } catch {
      toast.error("Erro ao reindexar");
    } finally {
      setReindexing(null);
    }
  }

  async function openChunks(k: Knowledge) {
    setChunksFor(k);
    setChunks(null);
    try {
      const r = await api.get<{ chunks: Chunk[] }>(`/knowledge/${k.id}/chunks?limit=100`);
      setChunks(r.data.chunks);
    } catch {
      toast.error("Erro ao carregar chunks");
      setChunks([]);
    }
  }

  function toggle(agentId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  // Agrupa os arquivos por agente. Agentes sem arquivos não viram seção; órfãos (agente
  // removido) caem num grupo "Sem agente".
  const known = new Set(agents.map((a) => a.id));
  const groups: { id: number; nome: string; files: Knowledge[] }[] = agents
    .map((a) => ({ id: a.id, nome: a.nome, files: items.filter((k) => k.agent_id === a.id) }))
    .filter((g) => g.files.length > 0);
  const orphans = items.filter((k) => !known.has(k.agent_id));
  if (orphans.length) groups.push({ id: -1, nome: "Sem agente", files: orphans });

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Knowledge"
          subtitle="Base de conhecimento por agente — suba PDF, planilhas e textos (runbooks, FAQs). Cada agente consulta só os arquivos dele."
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

        {loading && (
          <Row last>
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded ${SKEL}`} />
                  <div className={`h-3 w-40 ${SKEL}`} />
                </div>
              ))}
            </div>
          </Row>
        )}

        {!loading && groups.length === 0 && (
          <Row last>
            <div className="px-6 py-12">
              <EmptyHint icon={FolderOpen} text="Nenhum conhecimento ainda. Suba o primeiro arquivo no formulário acima." />
            </div>
          </Row>
        )}

        {!loading &&
          groups.map((g) => {
            const isCollapsed = collapsed.has(g.id);
            const totalChunks = g.files.reduce((s, f) => s + (f.chunks_count || 0), 0);
            return (
              <Row key={g.id}>
                {/* Cabeçalho do agente (clicável pra colapsar) */}
                <button
                  type="button"
                  onClick={() => toggle(g.id)}
                  className={`w-full flex items-center gap-2 px-6 py-3 text-left ${FC.hover}`}
                >
                  {isCollapsed ? (
                    <ChevronRight className={`w-4 h-4 ${FC.sub}`} />
                  ) : (
                    <ChevronDown className={`w-4 h-4 ${FC.sub}`} />
                  )}
                  <Bot className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" />
                  <span className={`text-[14px] font-semibold ${FC.ink}`}>{g.nome}</span>
                  <span className={`text-[12px] ${FC.sub}`}>
                    · {g.files.length} {g.files.length === 1 ? "arquivo" : "arquivos"} · {totalChunks} chunks
                  </span>
                </button>

                {!isCollapsed && (
                  <div className={`border-t ${FC.hair}`}>
                    {g.files.map((k) => {
                      const km = KIND_META[k.kind] || KIND_META.unknown;
                      const sm = STATUS_META[k.status] || STATUS_META.indexing;
                      const Icon = km.icon;
                      return (
                        <div
                          key={k.id}
                          className={`flex items-center gap-3 px-6 py-2.5 border-b ${FC.hair} last:border-0 ${FC.hover}`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${km.color}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-[13px] font-medium truncate ${FC.ink}`}>{k.title}</div>
                            <div className={`text-[11px] ${FC.sub}`}>
                              {km.label} · {k.chunks_count} chunks
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1.5 shrink-0" title={sm.tip}>
                            <span className={`w-2 h-2 rounded-full ${sm.color}`} />
                            <span className={`text-[12px] ${FC.sub}`}>{sm.label}</span>
                          </span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => openChunks(k)}
                              className={iconBtn}
                              title="Ver conteúdo indexado (chunks)"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onReindex(k.id)}
                              disabled={reindexing === k.id}
                              className={iconBtn}
                              title="Reindexar"
                            >
                              <RefreshCw className={`w-4 h-4 ${reindexing === k.id ? "animate-spin" : ""}`} />
                            </button>
                            <button
                              onClick={() => onDelete(k.id)}
                              className={`${iconBtn} hover:text-[#E5484D] dark:hover:text-[#ff6b5e] hover:bg-[#E5484D]/[0.08]`}
                              title="Remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Row>
            );
          })}
      </PageFrame>

      {/* Modal de inspeção de chunks */}
      {chunksFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setChunksFor(null)}
        >
          <div
            className={`w-full max-w-[680px] max-h-[80vh] flex flex-col rounded-[12px] bg-white dark:bg-[#14171c] border ${FC.hair} shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center gap-2 px-5 py-3.5 border-b ${FC.hair}`}>
              <Layers className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" />
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-semibold truncate ${FC.ink}`}>{chunksFor.title}</div>
                <div className={`text-[11px] ${FC.sub}`}>{chunksFor.chunks_count} chunks indexados</div>
              </div>
              <button onClick={() => setChunksFor(null)} className={iconBtn} title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-3">
              {chunks === null && (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`h-12 rounded ${SKEL}`} />
                  ))}
                </div>
              )}
              {chunks !== null && chunks.length === 0 && (
                <EmptyHint icon={FolderOpen} text="Sem chunks. Reindexe o arquivo." />
              )}
              {chunks?.map((c) => (
                <div key={c.id} className={`rounded-[8px] border ${FC.hair} p-3`}>
                  <div className={`text-[10px] uppercase tracking-wider mb-1.5 ${FC.sub}`}>
                    #{c.position} · ~{c.tokens} tokens
                  </div>
                  <div className={`text-[12px] leading-5 whitespace-pre-wrap ${FC.sub}`}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

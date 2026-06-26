import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Upload, FileText, FileSpreadsheet, FileType, Trash2, FolderOpen,
  ChevronDown, RefreshCw, Eye, Bot, X, Layers,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, PageHero, Row, SectionHeader, Select, EmptyHint, SKEL, iconBtn } from "@/components/ds/fc";

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
  text: { icon: FileType, color: "text-[#262626]/40 dark:text-[#8b93a0]", label: "Texto" },
  manual: { icon: FileType, color: "text-[#003083] dark:text-[#5b9bff]", label: "Manual" },
  url: { icon: FileType, color: "text-[#003083] dark:text-[#5b9bff]", label: "URL" },
  unknown: { icon: FileType, color: "text-[#262626]/40 dark:text-[#8b93a0]", label: "—" },
};

const STATUS_META: Record<string, { color: string; label: string; tip: string }> = {
  ready: { color: "bg-[#0a8f5a]", label: "Indexado", tip: "Conhecimento disponível pro agente" },
  indexing: { color: "bg-[#F5A300]", label: "Indexando", tip: "Processando arquivo" },
  failed: { color: "bg-[#E5484D]", label: "Falhou", tip: "Verifique o arquivo e reenvie" },
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
      toast.error("Erro ao carregar o conteúdo");
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

  // Agrupa os arquivos por agente. Agentes sem arquivos não viram seção; órfãos
  // (agente removido) caem num grupo "Sem agente".
  const known = new Set(agents.map((a) => a.id));
  const groups: { id: number; nome: string; files: Knowledge[] }[] = agents
    .map((a) => ({ id: a.id, nome: a.nome, files: items.filter((k) => k.agent_id === a.id) }))
    .filter((g) => g.files.length > 0);
  const orphans = items.filter((k) => !known.has(k.agent_id));
  if (orphans.length) groups.push({ id: -1, nome: "Sem agente", files: orphans });

  const totalFiles = items.length;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Knowledge"
          subtitle="Base de conhecimento por agente — suba PDFs, planilhas e textos (runbooks, FAQs). Cada agente consulta apenas os arquivos dele."
        />

        {/* Adicionar conhecimento */}
        <Row>
          <SectionHeader
            title="Adicionar conhecimento"
            subtitle="PDF, planilha ou texto · até 20 MB · vira base consultável em segundos."
            right={
              <div className="w-[220px]">
                <Select
                  value={selectedAgent}
                  onChange={(v) => setSelectedAgent(v)}
                  options={agents.map((a) => ({ value: a.id, label: a.nome, icon: <Bot className="w-3.5 h-3.5 text-[#003083] dark:text-[#5b9bff]" /> }))}
                  placeholder="Escolha o agente"
                />
              </div>
            }
          />
          <div className="px-6 py-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !selectedAgent}
              className={`w-full h-[88px] flex flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed ${FC.hair} ${FC.hover} text-[13px] font-medium ${FC.sub} transition-all active:scale-[0.99] hover:border-[#003083]/40 dark:hover:border-[#5b9bff]/40 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/20 disabled:opacity-50 disabled:pointer-events-none`}
            >
              <Upload className="w-5 h-5 text-[#003083] dark:text-[#5b9bff]" />
              {uploading ? "Enviando e indexando…" : selectedAgent ? "Clique para escolher um arquivo" : "Escolha um agente primeiro"}
              <span className={`text-[11.5px] ${FC.mut}`}>PDF · XLSX · TXT · MD</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.txt,.md"
              onChange={onUpload}
              disabled={uploading}
              className="hidden"
            />
          </div>
        </Row>

        {/* Lista — UM container, agentes como sub-seções */}
        {loading && (
          <Row last>
            <div className="p-6 space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg ${SKEL}`} />
                    <div className={`h-4 w-32 ${SKEL}`} />
                  </div>
                  <div className={`h-10 w-full ${SKEL}`} />
                </div>
              ))}
            </div>
          </Row>
        )}

        {!loading && groups.length === 0 && (
          <Row last>
            <div className="px-6 py-14">
              <EmptyHint icon={FolderOpen} text="Nenhum conhecimento ainda. Escolha um agente e suba o primeiro arquivo acima." />
            </div>
          </Row>
        )}

        {!loading && groups.length > 0 && (
          <>
            <Row curvy={false}>
              <div className="flex items-center justify-between px-6 py-3">
                <span className={`text-[12px] font-medium uppercase tracking-wider ${FC.mut}`}>
                  {groups.length} {groups.length === 1 ? "agente" : "agentes"} · {totalFiles} {totalFiles === 1 ? "arquivo" : "arquivos"}
                </span>
              </div>
            </Row>
            <Row last>
              {groups.map((g, gi) => {
                const isCollapsed = collapsed.has(g.id);
                const totalChunks = g.files.reduce((s, f) => s + (f.chunks_count || 0), 0);
                return (
                  <div key={g.id} className={gi > 0 ? `border-t ${FC.hair}` : ""}>
                    {/* Cabeçalho do agente */}
                    <button
                      type="button"
                      onClick={() => toggle(g.id)}
                      className={`w-full flex items-center gap-2.5 px-6 py-3.5 text-left ${FC.hover} transition-colors`}
                    >
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 ${FC.mut} transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      />
                      <div className="w-7 h-7 rounded-lg bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" />
                      </div>
                      <span className={`text-[15px] font-semibold ${FC.ink}`}>{g.nome}</span>
                      <span className={`text-[12px] ${FC.sub}`}>
                        {g.files.length} {g.files.length === 1 ? "arquivo" : "arquivos"} · {totalChunks} chunks
                      </span>
                    </button>

                    {!isCollapsed &&
                      g.files.map((k) => {
                        const km = KIND_META[k.kind] || KIND_META.unknown;
                        const sm = STATUS_META[k.status] || STATUS_META.indexing;
                        const Icon = km.icon;
                        return (
                          <div
                            key={k.id}
                            className={`group flex items-center gap-3 pl-[60px] pr-6 py-2.5 border-t ${FC.hair} ${FC.hover} transition-colors`}
                          >
                            <div className={`w-7 h-7 rounded-lg border ${FC.hair} flex items-center justify-center shrink-0`}>
                              <Icon className={`w-4 h-4 ${km.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={`text-[13px] font-medium truncate ${FC.ink}`}>{k.title}</div>
                              <div className={`text-[11.5px] ${FC.sub}`}>
                                {km.label} · {k.chunks_count} chunks
                              </div>
                            </div>
                            <span className="inline-flex items-center gap-1.5 shrink-0 mr-1" title={sm.tip}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sm.color}`} />
                              <span className={`text-[12px] ${FC.sub}`}>{sm.label}</span>
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openChunks(k)} className={iconBtn} title="Ver conteúdo indexado">
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
                );
              })}
            </Row>
          </>
        )}
      </PageFrame>

      {/* Modal de inspeção de chunks */}
      {chunksFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setChunksFor(null)}
        >
          <div
            className={`w-full max-w-[680px] max-h-[80vh] flex flex-col rounded-[14px] bg-white dark:bg-[#14171c] border ${FC.hair} shadow-[0_24px_60px_rgba(0,0,0,0.22)]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center gap-2.5 px-5 py-4 border-b ${FC.hair}`}>
              <div className="w-7 h-7 rounded-lg bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-semibold truncate ${FC.ink}`}>{chunksFor.title}</div>
                <div className={`text-[11.5px] ${FC.sub}`}>{chunksFor.chunks_count} trechos indexados</div>
              </div>
              <button onClick={() => setChunksFor(null)} className={iconBtn} title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-2.5">
              {chunks === null && (
                <div className="space-y-2.5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`h-14 rounded-[10px] ${SKEL}`} />
                  ))}
                </div>
              )}
              {chunks !== null && chunks.length === 0 && (
                <EmptyHint icon={FolderOpen} text="Sem trechos. Reindexe o arquivo." />
              )}
              {chunks?.map((c) => (
                <div key={c.id} className={`rounded-[10px] border ${FC.hair} p-3.5`}>
                  <div className={`text-[10px] uppercase tracking-wider mb-1.5 ${FC.mut}`}>
                    Trecho {c.position} · ~{c.tokens} tokens
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

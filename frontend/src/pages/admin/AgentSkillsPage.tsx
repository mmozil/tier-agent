import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Archive, Bot, FileText, Loader2, Sparkles, User, X } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button } from "@/components/ds/fc";

interface Skill {
  path: string;
  name: string;
  relative_dir: string;
  size_bytes: number;
  modified_at: string | null;
  title: string | null;
  description: string | null;
  is_user_uploaded: boolean;
}

interface Agent {
  id: number;
  nome: string;
}

export default function AgentSkillsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "auto" | "uploaded">("all");
  const [viewing, setViewing] = useState<Skill | null>(null);
  const [viewingContent, setViewingContent] = useState<string>("");
  const [viewingLoading, setViewingLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [ag, sk] = await Promise.all([
        api.get<Agent>(`/agents/${id}`),
        api.get<Skill[]>(`/agents/${id}/skills`),
      ]);
      setAgent(ag.data);
      setSkills(sk.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Falha ao carregar skills");
      navigate("/admin/agentes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function archive(skill: Skill) {
    if (!confirm(`Arquivar "${skill.name}"? Skill some da listagem, mas pode ser restaurada via SSH.`)) return;
    try {
      await api.post(`/agents/${id}/skills/archive`, { skill_path: skill.path });
      toast.success("Arquivada");
      setSkills((prev) => prev.filter((s) => s.path !== skill.path));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao arquivar");
    }
  }

  async function viewContent(skill: Skill) {
    setViewing(skill);
    setViewingContent("");
    setViewingLoading(true);
    try {
      const { data } = await api.get<{ content: string }>(`/agents/${id}/skills/content`, { params: { skill_path: skill.path } });
      setViewingContent(data.content);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Falha ao ler skill");
    } finally {
      setViewingLoading(false);
    }
  }

  const filtered = skills.filter((s) => {
    if (filter === "auto") return !s.is_user_uploaded;
    if (filter === "uploaded") return s.is_user_uploaded;
    return true;
  });

  const counts = {
    all: skills.length,
    auto: skills.filter((s) => !s.is_user_uploaded).length,
    uploaded: skills.filter((s) => s.is_user_uploaded).length,
  };

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" />
      </div>
    );
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start gap-3 p-6">
            <Link to="/admin/agentes" className={`w-7 h-7 inline-flex items-center justify-center rounded-md ${FC.mut} ${FC.hover} mt-0.5`}>
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex-1 min-w-0">
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 truncate ${FC.ink}`}>Skills · {agent.nome}</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Skills auto-criadas pelo Hermes Curator e knowledge enviado por você.</p>
            </div>
            <Button variant="secondary" onClick={load} className="shrink-0">Atualizar</Button>
          </div>
        </Row>

        <Row>
          <div className="flex items-center gap-1 p-6">
            <FilterTab label="Todas" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterTab label="Auto-aprendidas" count={counts.auto} active={filter === "auto"} onClick={() => setFilter("auto")} />
            <FilterTab label="Enviadas por mim" count={counts.uploaded} active={filter === "uploaded"} onClick={() => setFilter("uploaded")} />
          </div>
        </Row>

        {filtered.length === 0 ? (
          <Row last>
            <div className="p-12 text-center">
              <div className={`inline-flex w-12 h-12 rounded-md ${FC.base} items-center justify-center mb-4 border ${FC.hair}`}>
                <Sparkles className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
              </div>
              <h3 className={`text-[16px] font-[450] mb-1 ${FC.ink}`}>
                {filter === "auto" ? "Nenhuma skill auto-aprendida ainda" : "Nenhuma skill aqui"}
              </h3>
              <p className={`text-[13px] ${FC.sub}`}>
                {filter === "auto"
                  ? "Quando o agente acumular padrões nas conversas, o Hermes Curator cria skills automaticamente."
                  : filter === "uploaded"
                    ? "Envie PDFs/Excel/MD em /admin/knowledge pra agente usar."
                    : "Esse agente ainda não tem skills cadastradas no container."}
              </p>
            </div>
          </Row>
        ) : (
          <Row last>
            <HairCells cols={3} gridLines>
              {filtered.map((s) => (
                <SkillCard key={s.path} skill={s} onView={viewContent} onArchive={archive} />
              ))}
            </HairCells>
          </Row>
        )}
      </PageFrame>

      {viewing && (
        <SkillContentDrawer skill={viewing} content={viewingContent} loading={viewingLoading} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function FilterTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-all active:scale-[0.97] ${
        active
          ? "bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12]"
          : `border ${FC.hair} ${FC.sub} ${FC.hover}`
      }`}
    >
      {label}
      <span className={`text-[10px] ${active ? "opacity-80" : FC.mut}`}>{count}</span>
    </button>
  );
}

function SkillCard({ skill, onView, onArchive }: { skill: Skill; onView: (s: Skill) => void; onArchive: (s: Skill) => void }) {
  const isAuto = !skill.is_user_uploaded;
  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: isAuto ? "#00308314" : "#0a8f5a14" }}
        >
          {isAuto ? <Bot className="w-4 h-4 text-[#003083] dark:text-[#5b9bff]" /> : <User className="w-4 h-4 text-[#0a8f5a]" />}
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
            isAuto ? "bg-[#003083]/[0.08] text-[#003083] dark:text-[#5b9bff]" : "bg-[#0a8f5a]/[0.10] text-[#0a8f5a]"
          }`}
        >
          {isAuto ? "Auto" : "Manual"}
        </span>
      </div>
      <div className={`text-[13px] font-medium mb-1 truncate ${FC.ink}`}>{skill.title || skill.name}</div>
      {skill.description && <p className={`text-[11px] line-clamp-2 mb-2 ${FC.sub}`}>{skill.description}</p>}
      <div className={`text-[10px] mb-3 ${FC.mut}`}>
        {skill.relative_dir && <span className="font-mono">{skill.relative_dir}/</span>}
        <span className="font-mono">{(skill.size_bytes / 1024).toFixed(1)}KB</span>
        {skill.modified_at && <>{" · "}<span>{new Date(skill.modified_at).toLocaleDateString("pt-BR")}</span></>}
      </div>
      <div className="mt-auto flex gap-1.5 pt-2">
        <button onClick={() => onView(skill)} className={`flex-1 h-7 px-2 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1 border ${FC.hair} ${FC.ink} ${FC.hover}`}>
          <FileText className="w-3 h-3" /> Ver
        </button>
        <button onClick={() => onArchive(skill)} className={`h-7 px-2 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1 border border-[#E5484D]/30 text-[#E5484D] hover:bg-[#E5484D]/[0.06]`} title="Arquivar">
          <Archive className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SkillContentDrawer({ skill, content, loading, onClose }: { skill: Skill; content: string; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[600px] bg-white dark:bg-[#0c0e12] h-full overflow-y-auto shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-4 border-b ${FC.hair} flex items-center justify-between sticky top-0 bg-white dark:bg-[#0c0e12] z-10`}>
          <div className="min-w-0 flex-1">
            <h3 className={`text-[14px] font-medium truncate ${FC.ink}`}>{skill.title || skill.name}</h3>
            <div className={`text-[10px] font-mono truncate ${FC.sub}`}>{skill.path}</div>
          </div>
          <button onClick={onClose} className={`w-7 h-7 inline-flex items-center justify-center rounded-md ${FC.mut} ${FC.hover}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" />
            </div>
          ) : (
            <pre className={`text-[11px] font-mono whitespace-pre-wrap bg-[#F1F3F5] dark:bg-[#16191f] p-4 rounded-md overflow-x-auto ${FC.ink}`}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Archive,
  Bot,
  FileText,
  Loader2,
  Sparkles,
  User,
  X,
} from "lucide-react";

import { api } from "@/lib/api";

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
      const { data } = await api.get<{ content: string }>(
        `/agents/${id}/skills/content`,
        { params: { skill_path: skill.path } },
      );
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
        <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mt-6 mb-2">
        <Link
          to="/admin/agentes"
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[28px] font-bold text-[#30313d] flex-1 truncate">
          Skills · {agent.nome}
        </h1>
        <button
          onClick={load}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          Atualizar
        </button>
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Skills auto-criadas pelo Hermes Curator e knowledge enviado por você.
      </p>

      {/* Filtros */}
      <div className="flex items-center gap-1 mb-4">
        <FilterTab label="Todas" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab
          label="Auto-aprendidas"
          count={counts.auto}
          active={filter === "auto"}
          onClick={() => setFilter("auto")}
        />
        <FilterTab
          label="Enviadas por mim"
          count={counts.uploaded}
          active={filter === "uploaded"}
          onClick={() => setFilter("uploaded")}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[#f4f7fa] rounded-lg p-12 text-center">
          <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
            <Sparkles className="w-6 h-6 text-[#003083]" />
          </div>
          <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">
            {filter === "auto" ? "Nenhuma skill auto-aprendida ainda" : "Nenhuma skill aqui"}
          </h3>
          <p className="text-[13px] text-[#697386]">
            {filter === "auto"
              ? "Quando o agente acumular padrões nas conversas, o Hermes Curator cria skills automaticamente."
              : filter === "uploaded"
                ? "Envie PDFs/Excel/MD em /admin/knowledge pra agente usar."
                : "Esse agente ainda não tem skills cadastradas no container."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SkillCard key={s.path} skill={s} onView={viewContent} onArchive={archive} />
          ))}
        </div>
      )}

      {viewing && (
        <SkillContentDrawer
          skill={viewing}
          content={viewingContent}
          loading={viewingLoading}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-[#003083] text-white shadow-sm shadow-[#003083]/20"
          : "bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
      }`}
    >
      {label}
      <span className={`text-[10px] ${active ? "opacity-80" : "text-[#697386]"}`}>{count}</span>
    </button>
  );
}

function SkillCard({
  skill,
  onView,
  onArchive,
}: {
  skill: Skill;
  onView: (s: Skill) => void;
  onArchive: (s: Skill) => void;
}) {
  const isAuto = !skill.is_user_uploaded;
  return (
    <div className="bg-white rounded-md p-4 shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{
            backgroundColor: isAuto ? "#003083" + "14" : "#10b981" + "14",
          }}
        >
          {isAuto ? (
            <Bot className="w-4 h-4 text-[#003083]" />
          ) : (
            <User className="w-4 h-4 text-emerald-600" />
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
            isAuto ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          }`}
        >
          {isAuto ? "Auto" : "Manual"}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-[#1a2c44] mb-1 truncate">{skill.title || skill.name}</div>
      {skill.description && (
        <p className="text-[11px] text-[#697386] line-clamp-2 mb-2">{skill.description}</p>
      )}
      <div className="text-[10px] text-[#697386] mb-3">
        {skill.relative_dir && <span className="font-mono">{skill.relative_dir}/</span>}
        <span className="font-mono">{(skill.size_bytes / 1024).toFixed(1)}KB</span>
        {skill.modified_at && (
          <>
            {" · "}
            <span>{new Date(skill.modified_at).toLocaleDateString("pt-BR")}</span>
          </>
        )}
      </div>
      <div className="mt-auto flex gap-1.5 pt-2">
        <button
          onClick={() => onView(skill)}
          className="flex-1 h-6 px-2 rounded text-[11px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          <FileText className="w-3 h-3" />
          Ver
        </button>
        <button
          onClick={() => onArchive(skill)}
          className="h-6 px-2 rounded text-[11px] font-medium inline-flex items-center justify-center gap-1 bg-white text-red-600 shadow-[0_0_0_1px_rgb(254,202,202)] hover:bg-red-50"
          title="Arquivar"
        >
          <Archive className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SkillContentDrawer({
  skill,
  content,
  loading,
  onClose,
}: {
  skill: Skill;
  content: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[600px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-[#1a2c44] truncate">
              {skill.title || skill.name}
            </h3>
            <div className="text-[10px] font-mono text-[#697386] truncate">{skill.path}</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
            </div>
          ) : (
            <pre className="text-[11px] font-mono text-[#1a2c44] whitespace-pre-wrap bg-slate-50 p-4 rounded-md overflow-x-auto">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

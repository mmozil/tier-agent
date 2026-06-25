import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Archive, Bot, FileText, Sparkles, User, X } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button, iconBtn, EmptyHint, SKEL } from "@/components/ds/fc";

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
    return <SkillsSkeleton />;
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start gap-3 p-6">
            <Link to="/admin/agentes" className={`${iconBtn} mt-0.5`}>
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex-1 min-w-0">
              <h2 className={`text-[20px] font-[500] fc-crisp tracking-[-0.1px] leading-7 truncate ${FC.ink}`}>Skills · {agent.nome}</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.dim}`}>Skills auto-criadas pelo Curator do agente e knowledge enviado por você.</p>
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
            <div className="py-12">
              <EmptyHint
                icon={filter === "auto" ? Bot : filter === "uploaded" ? User : Sparkles}
                text={
                  filter === "auto"
                    ? "Nenhuma skill auto-aprendida ainda. Quando o agente acumular padrões nas conversas, o Curator cria skills automaticamente."
                    : filter === "uploaded"
                      ? "Nenhum conhecimento enviado por você. Suba PDFs, planilhas ou MD pro agente usar."
                      : "Esse agente ainda não tem skills cadastradas."
                }
                {...(filter !== "auto" ? { ctaLabel: "Enviar conhecimento", ctaTo: "/admin/knowledge" } : {})}
              />
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

// SkillsSkeleton — carregando, a página mostra a própria forma (header + tabs + grid de cards).
function SkillsSkeleton() {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start gap-3 p-6">
            <div className={`w-7 h-7 rounded-md shrink-0 ${SKEL}`} />
            <div className="flex-1">
              <div className={`h-5 w-48 mb-2 ${SKEL}`} />
              <div className={`h-3 w-80 max-w-full ${SKEL}`} />
            </div>
          </div>
        </Row>
        <Row>
          <div className="flex items-center gap-2 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-7 w-28 ${SKEL}`} />
            ))}
          </div>
        </Row>
        <Row last>
          <HairCells cols={3} gridLines>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className={`w-8 h-8 rounded-md ${SKEL}`} />
                  <div className={`h-4 w-12 ${SKEL}`} />
                </div>
                <div className={`h-3.5 w-3/4 mb-2 ${SKEL}`} />
                <div className={`h-3 w-full mb-1.5 ${SKEL}`} />
                <div className={`h-3 w-2/3 mb-3 ${SKEL}`} />
                <div className="flex gap-1.5 pt-2">
                  <div className={`h-7 flex-1 ${SKEL}`} />
                  <div className={`h-7 w-9 ${SKEL}`} />
                </div>
              </div>
            ))}
          </HairCells>
        </Row>
      </PageFrame>
    </div>
  );
}

function FilterTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-[10px] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
        active
          ? "bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12]"
          : `border ${FC.hair} ${FC.sub} ${FC.hover}`
      }`}
    >
      {label}
      <span className={`text-[10px] tabular-nums ${active ? "opacity-80" : FC.sub}`}>{count}</span>
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
      <div className={`text-[10px] mb-3 ${FC.sub}`}>
        {/* relative_dir é caminho técnico → mono; tamanho/data são metadados de negócio → sans */}
        {skill.relative_dir && <span className="font-mono">{skill.relative_dir}/</span>}
        <span className="tabular-nums">{(skill.size_bytes / 1024).toFixed(1)}KB</span>
        {skill.modified_at && <>{" · "}<span className="tabular-nums">{new Date(skill.modified_at).toLocaleDateString("pt-BR")}</span></>}
      </div>
      <div className="mt-auto flex gap-1.5 pt-2">
        <Button variant="secondary" size="sm" onClick={() => onView(skill)} className="flex-1">
          <FileText className="w-3 h-3" /> Ver
        </Button>
        <Button variant="danger" size="sm" onClick={() => onArchive(skill)} title="Arquivar">
          <Archive className="w-3 h-3" />
        </Button>
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
          <button onClick={onClose} className={iconBtn}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-5">
          {loading ? (
            // Skeleton ecoa o bloco de conteúdo (linhas no painel), não um spinner no vazio.
            <div className="bg-[#F1F3F5] dark:bg-[#16191f] p-4 rounded-md space-y-2.5" aria-hidden>
              {["w-3/4", "w-full", "w-5/6", "w-2/3", "w-full", "w-1/2", "w-11/12", "w-4/5"].map((w, i) => (
                <div key={i} className={`h-3 ${w} ${SKEL}`} />
              ))}
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

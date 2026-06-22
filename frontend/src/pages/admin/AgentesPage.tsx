import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Bot,
  CheckCircle2,
  DollarSign,
  Edit3,
  HandCoins,
  LifeBuoy,
  Loader2,
  MoreVertical,
  PauseCircle,
  PawPrint,
  PlayCircle,
  Plus,
  ShoppingBag,
  Stethoscope,
  Store,
  Target,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, PageHero, Button, btnPrimary, iconBtn, SkeletonBar } from "@/components/ds/fc";

// SectionRow — cabeçalho de seção (label-x-large + subtítulo) numa Row FC.
function SectionRow({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Row>
      <div className="px-6 py-5">
        <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>{title}</h2>
        {subtitle && <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>{subtitle}</p>}
      </div>
    </Row>
  );
}

// CardGrid — grade 2 colunas (cards arredondados c/ gap), padrão /app/workflows do FC.
function CardGrid({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <Row last={last}>
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
      </div>
    </Row>
  );
}

// GhostCard — card tracejado "Agente em branco" (cria sem modelo).
function GhostCard({ onClick, busy, disabled }: { onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-[128px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed ${FC.hair} bg-transparent p-5 transition-all hover:border-[#003083]/60 dark:hover:border-[#5b9bff]/60 hover:bg-black/[0.015] dark:hover:bg-white/[0.02] disabled:opacity-60`}
    >
      <div className="w-10 h-10 rounded-[10px] bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.1] flex items-center justify-center text-[#003083] dark:text-[#5b9bff] group-hover:bg-[#003083]/[0.12] dark:group-hover:bg-[#5b9bff]/[0.18] transition-colors">
        {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Plus className="w-[18px] h-[18px]" />}
      </div>
      <span className={`text-[13px] font-medium ${FC.ink}`}>Agente em branco</span>
      <span className={`text-[11px] ${FC.mut}`}>Sem modelo — você configura do zero</span>
    </button>
  );
}

// TemplateCard — card de modelo (1 clique cria o agente). Estilo workflow do FC.
function TemplateCard({
  template: t,
  busy,
  disabled,
  onClick,
}: {
  template: Template;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = KEY_ICON[t.key] || ICONS[t.icon] || ShoppingBag;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex min-h-[128px] flex-col rounded-xl border ${FC.hair} bg-white dark:bg-[#14171c] p-5 text-left transition-all duration-150 hover:border-[#003083]/70 dark:hover:border-[#5b9bff]/70 hover:shadow-[0_2px_10px_rgba(0,48,131,0.06)] disabled:opacity-60`}
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-[10px] bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center text-[#003083] dark:text-[#5b9bff]">
          {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Icon className="w-[18px] h-[18px]" />}
        </div>
        <span className="inline-flex w-7 h-7 items-center justify-center rounded-[8px] text-[#262626]/30 dark:text-[#6b7280] transition-all group-hover:bg-[#003083]/[0.06] group-hover:text-[#003083] dark:group-hover:bg-[#5b9bff]/[0.12] dark:group-hover:text-[#5b9bff]">
          <Plus className="w-4 h-4" />
        </span>
      </div>
      <div className="mt-6">
        <h3 className={`text-[15px] font-medium tracking-[-0.01em] mb-1 ${FC.ink}`}>{t.label}</h3>
        <p className={`text-[13px] leading-5 line-clamp-2 ${FC.sub}`}>{t.description}</p>
        <div className="mt-2 flex gap-1 flex-wrap">
          {t.suggested_channels.map((c) => (
            <span
              key={c}
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-[#262626]/[0.06] dark:bg-white/[0.08] ${FC.dim}`}
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

// Skeleton da grade (mostra a forma, não spinner no vazio).
function AgentsSkeleton() {
  return (
    <div className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`rounded-xl border ${FC.hair} bg-white dark:bg-[#14171c] p-5 min-h-[128px]`}>
            <div className="flex items-start justify-between">
              <SkeletonBar className="w-10 h-10 rounded-[10px]" />
              <SkeletonBar className="w-4 h-4 rounded" />
            </div>
            <div className="mt-6">
              <SkeletonBar className="h-3.5 w-1/2 mb-2" />
              <SkeletonBar className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  template_kind: string | null;
  avatar_url?: string | null;
  active: boolean;
}

interface Template {
  key: string;
  label: string;
  description: string;
  icon: string;
  suggested_channels: string[];
  skills_count: number;
}

interface AgentStats {
  agent_id: number;
  playbooks_total: number;
  playbooks_published: number;
  conversations_total: number;
  conversations_active: number;
  knowledge_total: number;
  connectors_total: number;
}

const ICONS: Record<string, typeof ShoppingBag> = {
  ShoppingBag,
  Target,
  LifeBuoy,
  DollarSign,
  PawPrint,
  Store,
  Stethoscope,
  HandCoins,
};

// Ícone distinto por papel (o backend ainda repete ShoppingBag/LifeBuoy/DollarSign
// em alguns templates). Resolve por key primeiro; cai pro icon do backend e default.
const KEY_ICON: Record<string, typeof ShoppingBag> = {
  atendente_loja: ShoppingBag,
  sdr: Target,
  suporte: LifeBuoy,
  cobranca: DollarSign,
  atendente_petshop: PawPrint,
  vendedor_marketplace: Store,
  recepcionista_medica: Stethoscope,
  cobrador_inteligente: HandCoins,
};

// Glifo do agente (ícone "navigation-ai" da marca, recolorido p/ currentColor +
// fill none p/ funcionar claro/escuro). Usado a 40px no estado vazio (ilustração).
function AgentGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M20 30.5c5.799 0 10.5-4.7 10.5-10.5 0-5.798-4.701-10.5-10.5-10.5S9.5 14.203 9.5 20c0 5.8 4.701 10.5 10.5 10.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        opacity=".6"
        d="M22.5 9.501c4.815-3.224 10.795-5.896 12.346-4.345 1.996 1.996-.71 8.08-6.2 14.692M26.5 22.303a70.145 70.145 0 0 1-2.055 2.142C16.247 32.644 7.61 37.3 5.155 34.845 3.686 33.376 6.96 27.714 10 23.002"
        stroke="currentColor"
        strokeWidth=".7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1.6 1.6"
      />
      <path
        opacity=".6"
        d="M8.999 16.736C5.839 11.966 3.46 6.541 5 5c1.817-1.821 5.925 1.537 11.83 6.062 2.093 1.604 4.276 3.517 6.429 5.674 8.223 8.24 14.139 15.64 11.677 18.106-1.555 1.558-6.848-.601-11.677-3.841"
        stroke="currentColor"
        strokeWidth=".7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1.6 1.6"
      />
    </svg>
  );
}

export default function AgentesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        api.get<Agent[]>("/agents"),
        api.get<{ templates: Template[] }>("/templates"),
      ]);
      setAgents(a.data);
      setTemplates(t.data.templates);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

  // Cria agente direto de um modelo (1 clique) ou em branco — sem modal.
  // Abre o drawer do novo agente pra renomear / ajustar a persona.
  async function createAgent(template_kind: string | null, nome: string) {
    if (creatingKey) return;
    setCreatingKey(template_kind ?? "__blank__");
    try {
      const { data } = await api.post<Agent>("/agents", { nome, persona: "", template_kind: template_kind ?? "" });
      toast.success("Agente criado");
      await load();
      if (data?.id) setSelectedAgentId(data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao criar agente");
    } finally {
      setCreatingKey(null);
    }
  }

  async function toggleActive(agent: Agent) {
    setOpenMenuId(null);
    try {
      const { data } = await api.post<Agent>(`/agents/${agent.id}/toggle-active`);
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? data : a)));
      toast.success(data.active ? "Agente ativado" : "Agente pausado");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao alternar");
    }
  }

  async function deleteAgent(agent: Agent) {
    try {
      await api.delete(`/agents/${agent.id}`);
      toast.success("Agente excluído");
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      setOpenMenuId(null);
      if (selectedAgentId === agent.id) setSelectedAgentId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao excluir");
    }
  }

  function onAgentUpdated(updated: Agent) {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Agentes"
          subtitle="Funcionários digitais do seu workspace — cada um com persona, skills e canais. Comece por um modelo abaixo."
          right={
            <Button
              variant="primary"
              onClick={() =>
                document.getElementById("ag-modelos")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <Plus className="w-3.5 h-3.5" /> Novo agente
            </Button>
          }
        />

        {loading ? (
          <Row last>
            <AgentsSkeleton />
          </Row>
        ) : (
          <>
            {agents.length > 0 && (
              <>
                <SectionRow
                  title="Seus agentes"
                  subtitle={`${agents.length} ${agents.length === 1 ? "agente configurado" : "agentes configurados"}`}
                />
                <CardGrid>
                  {agents.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      menuOpen={openMenuId === a.id}
                      onOpenMenu={(open) => setOpenMenuId(open ? a.id : null)}
                      onClick={() => setSelectedAgentId(a.id)}
                      onToggleActive={() => toggleActive(a)}
                      onDelete={() => deleteAgent(a)}
                    />
                  ))}
                </CardGrid>
              </>
            )}

            <div id="ag-modelos" className="scroll-mt-4">
              <SectionRow
                title={agents.length > 0 ? "Criar a partir de um modelo" : "Comece com um modelo"}
                subtitle="Um clique cria o agente já com a persona e as skills do modelo — você ajusta tudo depois."
              />
              <CardGrid last>
                {templates.map((t) => (
                  <TemplateCard
                    key={t.key}
                    template={t}
                    busy={creatingKey === t.key}
                    disabled={!!creatingKey}
                    onClick={() => createAgent(t.key, t.label)}
                  />
                ))}
                <GhostCard
                  busy={creatingKey === "__blank__"}
                  disabled={!!creatingKey}
                  onClick={() => createAgent(null, "Novo agente")}
                />
              </CardGrid>
            </div>
          </>
        )}
      </PageFrame>

      {selectedAgent && (
        <AgentDetailsDrawer
          agent={selectedAgent}
          onClose={() => setSelectedAgentId(null)}
          onUpdated={onAgentUpdated}
          onDeleted={() => {
            setAgents((prev) => prev.filter((a) => a.id !== selectedAgent.id));
            setSelectedAgentId(null);
          }}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  menuOpen,
  onOpenMenu,
  onClick,
  onToggleActive,
  onDelete,
}: {
  agent: Agent;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onClick: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenMenu(false);
        setConfirmDelete(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen, onOpenMenu]);

  return (
    <div
      onClick={onClick}
      className={`group relative flex min-h-[128px] flex-col cursor-pointer rounded-xl border ${FC.hair} bg-white dark:bg-[#14171c] p-5 transition-all duration-150 hover:border-[#003083]/70 dark:hover:border-[#5b9bff]/70 hover:shadow-[0_2px_10px_rgba(0,48,131,0.06)]`}
    >
      {/* Topo: glifo + menu */}
      <div className="flex items-start justify-between">
        <div
          className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 ${
            agent.active
              ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.12] dark:text-[#5b9bff]"
              : "bg-[#262626]/[0.05] text-[#262626]/40 dark:bg-white/[0.06] dark:text-[#6b7280]"
          }`}
        >
          <AgentGlyph className="w-[22px] h-[22px]" />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(!menuOpen);
          }}
          className={`${iconBtn} -mr-1 -mt-1`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* Nome + status + persona */}
      <div className="mt-6">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className={`text-[15px] font-medium tracking-[-0.01em] ${FC.ink}`}>{agent.nome}</h3>
          {agent.active ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#0a8f5a]/[0.12] text-[#0a8f5a]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a]" /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#262626]/[0.06] text-[#262626]/[0.5] dark:bg-white/[0.08] dark:text-[#8b93a0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#262626]/30 dark:bg-white/30" /> Pausado
            </span>
          )}
        </div>
        <p className={`text-[13px] leading-5 line-clamp-2 ${FC.sub}`}>
          {agent.persona || "Sem persona definida."}
        </p>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-4 top-12 z-20 w-[180px] bg-white rounded-md shadow-xl border border-[#EDEDED] py-1"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(false);
              onClick();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[#262626]/[0.72] hover:bg-black/[0.03]"
          >
            <Edit3 className="w-3.5 h-3.5" /> Ver detalhes
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[#262626]/[0.72] hover:bg-black/[0.03]"
          >
            {agent.active ? (
              <>
                <PauseCircle className="w-3.5 h-3.5" /> Pausar
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" /> Ativar
              </>
            )}
          </button>
          {confirmDelete ? (
            <div className="px-3 py-2 border-t border-[#EDEDED]">
              <p className="text-[11px] text-[#262626]/[0.72] mb-2 leading-snug">
                Excluir <strong>{agent.nome}</strong>? Remove playbooks, conversas, knowledge e canais.
              </p>
              <div className="flex gap-1.5">
                <Button
                  variant="secondary"
                  onClick={(e: any) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                  className="flex-1"
                >
                  Não
                </Button>
                <Button
                  variant="danger"
                  onClick={(e: any) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="flex-1"
                >
                  Excluir
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 border-t border-[#EDEDED]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AgentDetailsDrawer({
  agent,
  onClose,
  onUpdated,
  onDeleted,
}: {
  agent: Agent;
  onClose: () => void;
  onUpdated: (a: Agent) => void;
  onDeleted: () => void;
}) {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ nome: agent.nome, persona: agent.persona || "", avatar_url: agent.avatar_url || "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm({ nome: agent.nome, persona: agent.persona || "", avatar_url: agent.avatar_url || "" });
    setEditing(false);
    (async () => {
      setStatsLoading(true);
      try {
        const { data } = await api.get<AgentStats>(`/agents/${agent.id}/stats`);
        setStats(data);
      } catch {
        // ignore
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [agent.id]);

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.patch<Agent>(`/agents/${agent.id}`, form);
      onUpdated(data);
      toast.success("Salvo");
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    try {
      const { data } = await api.post<Agent>(`/agents/${agent.id}/toggle-active`);
      onUpdated(data);
      toast.success(data.active ? "Ativado" : "Pausado");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro");
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await api.delete(`/agents/${agent.id}`);
      toast.success("Agente excluído");
      onDeleted();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao excluir");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-[720px] max-w-[94vw] bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#EDEDED] flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center shrink-0 text-[#003083] dark:text-[#5b9bff]">
              <AgentGlyph className="w-[22px] h-[22px]" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#262626] truncate">{agent.nome}</div>
              <div className="text-[11px] text-[#697386]">
                #{agent.id} · {agent.active ? "Ativo" : "Pausado"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className={iconBtn}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="px-5 py-4 border-b border-[#EDEDED]">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#697386] mb-3">
            Visão geral
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon={Workflow}
              label="Playbooks"
              value={statsLoading ? "..." : `${stats?.playbooks_published || 0} / ${stats?.playbooks_total || 0}`}
              hint="publicados / total"
            />
            <StatCard
              icon={Bot}
              label="Conversas"
              value={statsLoading ? "..." : `${stats?.conversations_active || 0} / ${stats?.conversations_total || 0}`}
              hint="ativas / total"
            />
            <StatCard
              icon={CheckCircle2}
              label="Knowledge"
              value={statsLoading ? "..." : String(stats?.knowledge_total || 0)}
              hint="documentos"
            />
            <StatCard
              icon={CheckCircle2}
              label="Canais"
              value={statsLoading ? "..." : String(stats?.connectors_total || 0)}
              hint="conectados"
            />
          </div>
        </div>

        {/* Edit form */}
        <div className="px-5 py-4 border-b border-[#EDEDED]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#697386]">
              Configuração
            </h3>
            {!editing && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Edit3 className="w-3 h-3" /> Editar
              </Button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#697386] mb-1">Nome</label>
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className="w-full h-7 px-3 text-[13px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#697386] mb-1">Persona</label>
                <textarea
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 text-[13px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow font-mono"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#697386] mb-1">Foto do agente (URL)</label>
                <div className="flex items-center gap-3">
                  {form.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.avatar_url}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover border border-[#EDEDED] shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#003083]/[0.08] flex items-center justify-center text-[#003083] shrink-0">
                      <AgentGlyph className="w-7 h-7" />
                    </div>
                  )}
                  <input
                    value={form.avatar_url}
                    onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                    placeholder="https://.../foto.png"
                    className="flex-1 h-7 px-3 text-[13px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
                  />
                </div>
                <p className="mt-1 text-[11px] text-[#697386]">
                  Aparece nas conversas (ex: no Hovio Pet). Cole a URL de uma imagem hospedada.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setForm({ nome: agent.nome, persona: agent.persona || "", avatar_url: agent.avatar_url || "" });
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-[13px]">
              <div>
                <span className="text-[#697386]">Template: </span>
                <span className="text-[#262626]">{agent.template_kind || "—"}</span>
              </div>
              <div>
                <span className="text-[#697386]">Persona:</span>
                <p className="text-[#262626] mt-1 leading-relaxed whitespace-pre-wrap">
                  {agent.persona || <span className="italic text-[#697386]">—</span>}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#697386] mb-3">
            Ações
          </h3>
          <div className="space-y-2">
            <Link to={`/admin/agentes/${agent.id}/skills`} className={`${btnPrimary} w-full`}>
              ✨ Ver skills do agente
            </Link>
            <Button variant="secondary" onClick={toggleActive} className="w-full">
              {agent.active ? (
                <>
                  <PauseCircle className="w-3.5 h-3.5" /> Pausar agente
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" /> Ativar agente
                </>
              )}
            </Button>

            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 space-y-2">
                <p className="text-[12px] text-red-700 leading-relaxed">
                  <strong>Excluir definitivamente {agent.nome}?</strong>
                  <br />
                  Isso remove TODOS os playbooks, conversas, knowledge e canais conectados a este
                  agente. <strong>Não dá pra desfazer.</strong>
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setConfirmDelete(false)} className="flex-1">
                    Cancelar
                  </Button>
                  <Button variant="danger" onClick={doDelete} disabled={deleting} className="flex-1">
                    {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                    Sim, excluir
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} className="w-full">
                <Trash2 className="w-3.5 h-3.5" /> Excluir agente
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-[#F9F9F9] dark:bg-[#16191f] rounded-md p-3 border border-[#EDEDED] dark:border-[#23272e]">
      <div className="flex items-center gap-1.5 text-[11px] text-[#697386] mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-[18px] font-semibold text-[#262626] leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-[#697386] mt-0.5">{hint}</div>}
    </div>
  );
}

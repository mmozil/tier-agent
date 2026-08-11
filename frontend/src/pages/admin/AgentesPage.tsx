import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  DollarSign,
  Edit3,
  HandCoins,
  LifeBuoy,
  Loader2,
  BookOpen,
  MoreVertical,
  PauseCircle,
  PawPrint,
  PlayCircle,
  Plus,
  Settings,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Store,
  Target,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, CurvyRect, Button, btnPrimary, iconBtn, SkeletonBar, EmptyHint } from "@/components/ds/fc";

// Blueprint — fundo "planta técnica" do Firecrawl: grade hairline + marcas "+" nos
// cruzamentos, esmaecendo pra baixo. pointer-events-none, atrás do conteúdo.
function Blueprint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[460px] overflow-hidden"
      style={{
        WebkitMaskImage: "linear-gradient(to top, #000 0%, #000 24%, transparent 88%)",
        maskImage: "linear-gradient(to top, #000 0%, #000 24%, transparent 88%)",
      }}
    >
      <div className="bp-grid absolute inset-0" />
      <svg className="absolute inset-0 h-full w-full text-[#003083]/30 dark:text-[#5b9bff]/25" aria-hidden>
        <defs>
          <pattern id="ag-plus" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M0 -4v8M-4 0h8" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ag-plus)" />
      </svg>
    </div>
  );
}

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

type AgentTab = "geral" | "conhecimento" | "modelo" | "recuperacao";

// Espelha GET /agents/{id}/runtime-config — o que este agente usa DE FATO em execução.
interface RuntimeConfig {
  llm: {
    scope: string;
    provider: string | null;
    model: string | null;
    inherited: boolean;
    tenant_default_model: string | null;
    provider_id: number | null;
    fallback: string[];
    options: { id: number; provider: string; default_model: string }[];
  };
  embedding: {
    scope: string;
    locked_reason: string;
    provider: string | null;
    model: string | null;
    dimensions: number;
  };
  knowledge: {
    total: number;
    ready: number;
    failed: number;
    chunks: number;
    items: { id: number; title: string | null; kind: string; status: string; chunks_count: number }[];
  };
}

// GhostCard — card "Agente em branco" (cria sem modelo). Mesma caixa dos modelos:
// primeiro do grid e com o fundo padrão, pra não parecer opção de segunda linha.
function GhostCard({ onClick, busy, disabled }: { onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex min-h-[96px] flex-col rounded-xl border ${FC.hair} bg-white dark:bg-[#14171c] p-4 text-left transition-all duration-150 hover:border-[#003083]/70 dark:hover:border-[#5b9bff]/70 hover:shadow-[0_2px_10px_rgba(0,48,131,0.06)] disabled:opacity-60`}
    >
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-[10px] bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center text-[#003083] dark:text-[#5b9bff]">
          {busy ? <Loader2 className="w-[17px] h-[17px] animate-spin" /> : <Sparkles className="w-[17px] h-[17px]" />}
        </div>
        <span className="inline-flex w-7 h-7 items-center justify-center rounded-[8px] text-[#262626]/30 dark:text-[#6b7280] transition-all group-hover:bg-[#003083]/[0.06] group-hover:text-[#003083] dark:group-hover:bg-[#5b9bff]/[0.12] dark:group-hover:text-[#5b9bff]">
          <Plus className="w-4 h-4" />
        </span>
      </div>
      <div className="mt-3">
        <h3 className={`text-[15px] font-medium tracking-[-0.01em] mb-0.5 ${FC.ink}`}>Agente em branco</h3>
        <p className={`text-[13px] leading-5 line-clamp-1 ${FC.sub}`}>Começa do zero — você define persona e skills</p>
      </div>
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
      className={`group relative flex min-h-[96px] flex-col rounded-xl border ${FC.hair} bg-white dark:bg-[#14171c] p-4 text-left transition-all duration-150 hover:border-[#003083]/70 dark:hover:border-[#5b9bff]/70 hover:shadow-[0_2px_10px_rgba(0,48,131,0.06)] disabled:opacity-60`}
    >
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-[10px] bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center text-[#003083] dark:text-[#5b9bff]">
          {busy ? <Loader2 className="w-[17px] h-[17px] animate-spin" /> : <Icon className="w-[17px] h-[17px]" />}
        </div>
        <span className="inline-flex w-7 h-7 items-center justify-center rounded-[8px] text-[#262626]/30 dark:text-[#6b7280] transition-all group-hover:bg-[#003083]/[0.06] group-hover:text-[#003083] dark:group-hover:bg-[#5b9bff]/[0.12] dark:group-hover:text-[#5b9bff]">
          <Plus className="w-4 h-4" />
        </span>
      </div>
      <div className="mt-3">
        <h3 className={`text-[15px] font-medium tracking-[-0.01em] mb-0.5 ${FC.ink}`}>{t.label}</h3>
        <p className={`text-[13px] leading-5 line-clamp-1 ${FC.sub}`}>{t.description}</p>
        <div className="mt-1.5 flex gap-1 flex-wrap">
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

// Mesmo desenho do <Button variant="secondary">, mas aplicavel em <Link> (o Button
// do ds e <button> e nao aceita href).
const btnSecondary =
  `inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[12px] font-medium h-8 px-3 transition-all active:scale-[0.98] ${FC.ink} border ${FC.hair} ${FC.hover}`;

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  template_kind: string | null;
  avatar_url?: string | null;
  llm_model?: string | null;
  llm_provider_id?: number | null;
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
        <div className="relative">
          {/* Fundo "planta técnica" do Firecrawl — grade + marcas "+" esmaecendo */}
          <Blueprint />

          <div className="relative z-10">
            {/* Hero */}
            <Row>
              <div className="flex items-start justify-between gap-4 px-6 py-11">
                <div className="min-w-0">
                  <div className={`mb-2.5 inline-flex items-center gap-2 font-mono text-[11px] ${FC.mut}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a]" />
                    {agents.filter((a) => a.active).length} ativos · {agents.length} no total
                  </div>
                  <h1 className={`text-[28px] font-semibold tracking-[-0.4px] leading-9 fc-crisp ${FC.ink}`}>Agentes</h1>
                  <p className={`mt-2 max-w-[600px] text-[14px] leading-6 ${FC.sub}`}>
                    Funcionários digitais do seu workspace — cada um com persona, skills e canais. Comece por um modelo abaixo.
                  </p>
                </div>
                <Button
                  variant="primary"
                  onClick={() =>
                    document.getElementById("ag-modelos")?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  <Plus className="w-3.5 h-3.5" /> Novo agente
                </Button>
              </div>
            </Row>

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
                    <Row>
                      <div className="relative">
                        <CurvyRect />
                        <HairCells cols={3} gridLines>
                          {agents.map((a) => (
                            <AgentCard
                              key={a.id}
                              agent={a}
                              templateLabel={templates.find((t) => t.key === a.template_kind)?.label}
                              menuOpen={openMenuId === a.id}
                              onOpenMenu={(open) => setOpenMenuId(open ? a.id : null)}
                              onClick={() => setSelectedAgentId(a.id)}
                              onToggleActive={() => toggleActive(a)}
                              onDelete={() => deleteAgent(a)}
                            />
                          ))}
                        </HairCells>
                      </div>
                    </Row>
                  </>
                )}

                <div id="ag-modelos" className="scroll-mt-4">
                  <SectionRow
                    title={agents.length > 0 ? "Criar a partir de um modelo" : "Comece com um modelo"}
                    subtitle="Um clique cria o agente já com a persona e as skills do modelo — você ajusta tudo depois."
                  />
                  <CardGrid last>
                    <GhostCard
                      busy={creatingKey === "__blank__"}
                      disabled={!!creatingKey}
                      onClick={() => createAgent(null, "Novo agente")}
                    />
                    {templates.map((t) => (
                      <TemplateCard
                        key={t.key}
                        template={t}
                        busy={creatingKey === t.key}
                        disabled={!!creatingKey}
                        onClick={() => createAgent(t.key, t.label)}
                      />
                    ))}
                  </CardGrid>
                </div>
              </>
            )}
          </div>
        </div>
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
  templateLabel,
  menuOpen,
  onOpenMenu,
  onClick,
  onToggleActive,
  onDelete,
}: {
  agent: Agent;
  templateLabel?: string;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onClick: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const RoleIcon = agent.template_kind ? KEY_ICON[agent.template_kind] : null;

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
      className={`group relative flex h-full min-h-[156px] flex-col cursor-pointer p-5 transition-colors ${FC.hover}`}
    >
      {/* Topo: avatar/glifo + menu */}
      <div className="flex items-start justify-between">
        {agent.avatar_url ? (
          <img
            src={agent.avatar_url}
            alt=""
            className={`w-11 h-11 rounded-[12px] object-cover shrink-0 ${agent.active ? "" : "grayscale opacity-70"}`}
          />
        ) : (
          <div
            className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${
              agent.active
                ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.12] dark:text-[#5b9bff]"
                : "bg-[#262626]/[0.05] text-[#262626]/40 dark:bg-white/[0.06] dark:text-[#6b7280]"
            }`}
          >
            <AgentGlyph className="w-6 h-6" />
          </div>
        )}
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
      <div className="mt-4 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <h3 className={`text-[15px] font-semibold tracking-[-0.01em] ${FC.ink}`}>{agent.nome}</h3>
          {agent.active ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#0a8f5a]/[0.12] text-[#0a8f5a]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a]" /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[#262626]/[0.06] text-[#262626]/[0.5] dark:bg-white/[0.08] dark:text-[#8b93a0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#262626]/30 dark:bg-white/30" /> Pausado
            </span>
          )}
        </div>
        <p className={`text-[13px] leading-5 line-clamp-2 ${FC.sub}`}>
          {agent.persona || "Sem persona definida."}
        </p>
      </div>

      {/* Rodapé: papel/modelo + abrir */}
      <div className={`mt-3 pt-3 flex items-center justify-between gap-2 border-t ${FC.hair}`}>
        <span className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] ${FC.sub}`}>
          {RoleIcon && <RoleIcon className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">{templateLabel || agent.template_kind || "Sem modelo"}</span>
        </span>
        <span className="font-mono text-[11px] text-[#262626]/30 dark:text-[#6b7280] group-hover:hidden">#{agent.id}</span>
        <span className="hidden items-center gap-0.5 text-[11px] font-medium text-[#003083] dark:text-[#5b9bff] group-hover:inline-flex">
          Abrir <ArrowUpRight className="w-3 h-3" />
        </span>
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
            className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-[#262626]/[0.72] hover:bg-black/[0.03]"
          >
            <Edit3 className="w-3.5 h-3.5" /> Ver detalhes
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive();
            }}
            className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-[#262626]/[0.72] hover:bg-black/[0.03]"
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
              className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-red-600 hover:bg-red-50 border-t border-[#EDEDED]"
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
  const [tab, setTab] = useState<AgentTab>("geral");
  const [rt, setRt] = useState<RuntimeConfig | null>(null);
  const [rtLoading, setRtLoading] = useState(true);
  const [savingModel, setSavingModel] = useState(false);

  async function loadRuntime() {
    setRtLoading(true);
    try {
      const { data } = await api.get<RuntimeConfig>(`/agents/${agent.id}/runtime-config`);
      setRt(data);
    } catch {
      setRt(null);
    } finally {
      setRtLoading(false);
    }
  }

  useEffect(() => {
    setForm({ nome: agent.nome, persona: agent.persona || "", avatar_url: agent.avatar_url || "" });
    setEditing(false);
    setTab("geral");
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
    loadRuntime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // Modelo do agente: string vazia volta a herdar o default da conta.
  async function saveModel(next: { llm_model?: string; llm_provider_id?: number | null }) {
    setSavingModel(true);
    try {
      const { data } = await api.patch<Agent>(`/agents/${agent.id}`, next);
      onUpdated(data);
      await loadRuntime();
      toast.success("Modelo atualizado");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar o modelo");
    } finally {
      setSavingModel(false);
    }
  }

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

  const TABS: { key: AgentTab; label: string }[] = [
    { key: "geral", label: "Visão geral" },
    { key: "conhecimento", label: "Conhecimento" },
    { key: "modelo", label: "Modelo" },
    { key: "recuperacao", label: "Recuperação" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className={`w-[760px] max-w-[94vw] bg-white dark:bg-[#0c0e12] h-full overflow-y-auto shadow-2xl border-l ${FC.hair}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + abas (sticky: a navegação acompanha a rolagem) */}
        <div className={`sticky top-0 z-10 bg-white dark:bg-[#0c0e12] border-b ${FC.hair}`}>
          <div className="px-5 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {agent.avatar_url ? (
                <img src={agent.avatar_url} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center shrink-0 text-[#003083] dark:text-[#5b9bff]">
                  <AgentGlyph className="w-[22px] h-[22px]" />
                </div>
              )}
              <div className="min-w-0">
                <div className={`text-[15px] font-semibold truncate ${FC.ink}`}>{agent.nome}</div>
                <div className={`text-[11px] flex items-center gap-1.5 ${FC.mut}`}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${agent.active ? "bg-[#00A66C]" : "bg-[#B4600A]"}`}
                  />
                  {agent.active ? "Ativo" : "Pausado"} · #{agent.id}
                  {rt?.llm.model && (
                    <>
                      <span className={FC.mut}>·</span>
                      <span className="font-mono">{rt.llm.model}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className={iconBtn}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 flex items-center gap-1 -mb-px">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative h-9 px-3 text-[13px] transition-colors ${
                    on ? `font-medium ${FC.ink}` : `${FC.sub} hover:${FC.ink}`
                  }`}
                >
                  {t.label}
                  {t.key === "conhecimento" && rt && rt.knowledge.failed > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#C0271F]/10 text-[#C0271F] text-[10px] font-semibold">
                      {rt.knowledge.failed}
                    </span>
                  )}
                  {on && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#003083] dark:bg-[#5b9bff]" />}
                </button>
              );
            })}
          </div>
        </div>

        {tab === "geral" && (
        <>
        {/* Stats */}
        <div className={`px-5 py-4 border-b ${FC.hair}`}>
          <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${FC.mut}`}>
            Resumo
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
        <div className={`px-5 py-4 border-b ${FC.hair}`}>
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
                <label className={`block text-[12px] font-medium mb-1 ${FC.sub}`}>Nome</label>
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className={`w-full h-8 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow`}
                />
              </div>
              <div>
                <label className={`block text-[12px] font-medium mb-1 ${FC.sub}`}>Persona</label>
                <textarea
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  rows={6}
                  className={`w-full px-3 py-2 text-[13px] rounded-md bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow font-mono`}
                />
              </div>
              <div>
                <label className={`block text-[12px] font-medium mb-1 ${FC.sub}`}>Foto do agente (URL)</label>
                <div className="flex items-center gap-3">
                  {form.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.avatar_url}
                      alt=""
                      className={`w-12 h-12 rounded-full object-cover border ${FC.hair} shrink-0`}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[#003083] dark:text-[#5b9bff] shrink-0">
                      <AgentGlyph className="w-7 h-7" />
                    </div>
                  )}
                  <input
                    value={form.avatar_url}
                    onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                    placeholder="https://.../foto.png"
                    className={`flex-1 h-8 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow`}
                  />
                </div>
                <p className={`mt-1 text-[11px] ${FC.mut}`}>
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
                <span className={FC.mut}>Template: </span>
                <span className={FC.ink}>{agent.template_kind || "—"}</span>
              </div>
              <div>
                <span className={FC.mut}>Persona:</span>
                <p className={`mt-1 leading-relaxed whitespace-pre-wrap ${FC.ink}`}>
                  {agent.persona || <span className={`italic ${FC.mut}`}>—</span>}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="px-5 py-4">
          <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${FC.mut}`}>
            Ações
          </h3>
          <div className="space-y-2">
            <Link to={`/admin/agentes/${agent.id}/skills`} className={`${btnPrimary} w-full`}>
              <Sparkles className="w-3.5 h-3.5" /> Ver skills do agente
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
              <div className="rounded-md border border-[#C0271F]/30 bg-[#C0271F]/[0.05] p-3 space-y-2">
                <p className="text-[12px] text-[#C0271F] leading-relaxed">
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
        </>
        )}

        {tab === "conhecimento" && (
          <div className="px-5 py-4">
            <ScopeNote
              scope="agente"
              text="O que este agente sabe. Cada documento é indexado só para ele — outros agentes da conta não enxergam."
            />
            {rtLoading ? (
              <div className="space-y-2 mt-3">
                <SkeletonBar className="h-10 w-full" />
                <SkeletonBar className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <MiniStat label="Documentos" value={String(rt?.knowledge.total ?? 0)} />
                  <MiniStat label="Trechos indexados" value={String(rt?.knowledge.chunks ?? 0)} />
                  <MiniStat
                    label="Com falha"
                    value={String(rt?.knowledge.failed ?? 0)}
                    tone={rt && rt.knowledge.failed > 0 ? "bad" : undefined}
                  />
                </div>

                {rt && rt.knowledge.failed > 0 && (
                  <div className="mt-3 rounded-md border border-[#C0271F]/30 bg-[#C0271F]/[0.05] px-3 py-2.5">
                    <p className="text-[12px] text-[#C0271F] leading-relaxed">
                      <strong>{rt.knowledge.failed} documento(s) não entraram na busca.</strong> Enquanto
                      estiverem assim, o agente responde como se eles não existissem. Reindexe pela tela de
                      Conhecimento.
                    </p>
                  </div>
                )}

                <div className={`mt-3 rounded-lg border ${FC.hair} overflow-hidden`}>
                  {(rt?.knowledge.items || []).length === 0 ? (
                    <div className={`px-3 py-6 text-center text-[13px] ${FC.mut}`}>
                      Nenhum documento ainda.
                    </div>
                  ) : (
                    (rt?.knowledge.items || []).map((k, i) => (
                      <div
                        key={k.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                          i > 0 ? `border-t ${FC.hair}` : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`text-[13px] truncate ${FC.ink}`}>{k.title || `#${k.id}`}</div>
                          <div className={`text-[11px] ${FC.mut}`}>
                            {k.kind} · {k.chunks_count} trecho(s)
                          </div>
                        </div>
                        <StatusPill status={k.status} />
                      </div>
                    ))
                  )}
                </div>

                <Link to="/admin/knowledge" className={`${btnSecondary} w-full mt-3`}>
                  <BookOpen className="w-3.5 h-3.5" /> Gerenciar conhecimento
                </Link>
              </>
            )}
          </div>
        )}

        {tab === "modelo" && (
          <div className="px-5 py-4">
            <ScopeNote
              scope="agente"
              text="O modelo que este agente usa para pensar. A chave de API continua na conta — aqui você só escolhe o modelo."
            />
            {rtLoading ? (
              <SkeletonBar className="h-10 w-full mt-3" />
            ) : !rt?.llm.provider ? (
              <div className="mt-3">
                <EmptyHint
                  icon={Bot}
                  text="Nenhuma LLM ativa nesta conta — o agente não consegue responder."
                />
                <Link to="/admin/configuracoes/llm" className={`${btnPrimary} w-full mt-3`}>
                  Configurar LLM
                </Link>
              </div>
            ) : (
              <>
                <div className={`mt-3 rounded-lg border ${FC.hair} p-3.5`}>
                  <div className={`text-[11px] uppercase tracking-wider font-semibold ${FC.mut}`}>
                    Em uso agora
                  </div>
                  <div className={`mt-1.5 text-[17px] font-medium font-mono ${FC.ink}`}>{rt.llm.model}</div>
                  <div className={`text-[12px] mt-0.5 ${FC.sub}`}>
                    via {rt.llm.provider}
                    {rt.llm.inherited ? " · herdado do padrão da conta" : " · escolhido para este agente"}
                  </div>
                  {rt.llm.fallback.length > 0 && (
                    <div className={`mt-2 text-[11px] ${FC.mut}`}>
                      Se falhar, tenta: {rt.llm.fallback.join(" → ")}
                    </div>
                  )}
                </div>

                <label className={`block text-[12px] font-medium mt-4 mb-1 ${FC.sub}`}>
                  Modelo deste agente
                </label>
                <input
                  defaultValue={agent.llm_model || ""}
                  placeholder={rt.llm.tenant_default_model || "modelo"}
                  disabled={savingModel}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (agent.llm_model || "")) saveModel({ llm_model: v });
                  }}
                  className={`w-full h-8 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow font-mono`}
                />
                <p className={`mt-1 text-[11px] ${FC.mut}`}>
                  Deixe vazio para herdar o padrão da conta ({rt.llm.tenant_default_model || "—"}).
                </p>

                {rt.llm.options.length > 1 && (
                  <>
                    <label className={`block text-[12px] font-medium mt-4 mb-1 ${FC.sub}`}>
                      Credencial usada
                    </label>
                    <select
                      value={agent.llm_provider_id ?? ""}
                      disabled={savingModel}
                      onChange={(e) =>
                        saveModel({ llm_provider_id: e.target.value ? Number(e.target.value) : null })
                      }
                      className={`w-full h-8 px-2 text-[13px] rounded-md bg-white dark:bg-[#14171c] ${FC.ink} outline-none shadow-[0_0_0_1px_rgb(226,232,240)] dark:shadow-[0_0_0_1px_#23272e]`}
                    >
                      <option value="">Padrão da conta</option>
                      {rt.llm.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.provider} · {o.default_model}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <Link to="/admin/configuracoes/llm" className={`${btnSecondary} w-full mt-4`}>
                  <Settings className="w-3.5 h-3.5" /> Chaves e padrões da conta
                </Link>
              </>
            )}
          </div>
        )}

        {tab === "recuperacao" && (
          <div className="px-5 py-4">
            <ScopeNote
              scope="conta"
              text="Como o texto do conhecimento vira busca. Vale para todos os agentes da conta."
            />
            {rtLoading ? (
              <SkeletonBar className="h-10 w-full mt-3" />
            ) : (
              <>
                <div className={`mt-3 rounded-lg border ${FC.hair} p-3.5`}>
                  <div className={`text-[11px] uppercase tracking-wider font-semibold ${FC.mut}`}>
                    Modelo de embedding
                  </div>
                  <div className={`mt-1.5 text-[15px] font-medium font-mono ${FC.ink}`}>
                    {rt?.embedding.model || "—"}
                  </div>
                  <div className={`text-[12px] mt-0.5 ${FC.sub}`}>
                    via {rt?.embedding.provider || "—"} · {rt?.embedding.dimensions} dimensões
                  </div>
                </div>

                <div className={`mt-3 rounded-md border ${FC.hair} ${FC.base} px-3 py-2.5`}>
                  <p className={`text-[12px] leading-relaxed ${FC.sub}`}>{rt?.embedding.locked_reason}</p>
                </div>

                <Link to="/admin/configuracoes/embedding" className={`${btnSecondary} w-full mt-3`}>
                  <Settings className="w-3.5 h-3.5" /> Configurar embedding da conta
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Etiqueta de escopo — o que é deste agente e o que é compartilhado com a conta.
// Sem isso o usuário muda algo achando que é local e afeta todo mundo.
function ScopeNote({ scope, text }: { scope: "agente" | "conta"; text: string }) {
  const isAgent = scope === "agente";
  return (
    <div className={`flex items-start gap-2.5 rounded-md border ${FC.hair} ${FC.base} px-3 py-2.5`}>
      <span
        className={`shrink-0 mt-px inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
          isAgent
            ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
            : "bg-[#B4600A]/[0.10] text-[#B4600A] dark:bg-[#d69b4e]/[0.14] dark:text-[#d69b4e]"
        }`}
      >
        {isAgent ? "deste agente" : "toda a conta"}
      </span>
      <p className={`text-[12px] leading-relaxed ${FC.sub}`}>{text}</p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className={`rounded-md border ${FC.hair} ${FC.base} px-3 py-2.5`}>
      <div className={`text-[11px] ${FC.mut}`}>{label}</div>
      <div className={`text-[18px] font-semibold leading-tight ${tone === "bad" ? "text-[#C0271F]" : FC.ink}`}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    ready: { t: "indexado", c: "bg-[#00A66C]/10 text-[#0B7A55] dark:text-[#5FC091]" },
    failed: { t: "falhou", c: "bg-[#C0271F]/10 text-[#C0271F]" },
    indexing: { t: "indexando", c: "bg-[#B4600A]/10 text-[#B4600A]" },
  };
  const s = map[status] || { t: status, c: `${FC.base} ${FC.mut}` };
  return (
    <span className={`shrink-0 inline-flex items-center h-[20px] px-2 rounded-full text-[11px] font-medium ${s.c}`}>
      {s.t}
    </span>
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
      <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${FC.mut}`}>
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`text-[18px] font-semibold leading-tight ${FC.ink}`}>{value}</div>
      {hint && <div className={`text-[10px] mt-0.5 ${FC.mut}`}>{hint}</div>}
    </div>
  );
}

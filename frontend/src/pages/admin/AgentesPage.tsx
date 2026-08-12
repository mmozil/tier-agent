import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
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
  Sparkles,
  Stethoscope,
  Store,
  Target,
  Trash2,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, CurvyRect, Button, iconBtn, SkeletonBar } from "@/components/ds/fc";

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


// Espelha GET /agents/{id}/runtime-config — o que este agente usa DE FATO em execução.
/**
 * EmbeddingRow — o modelo de INDEXAÇÃO (RAG) do agente, mostrado junto do de
 * raciocínio. É read-only de propósito: a coluna de vetores é fixa em 768
 * dimensões, então trocar por aqui quebraria a busca de todos os agentes.
 * O backend já explica o motivo em `embedding.locked_reason` — antes esse texto
 * era enviado e nunca renderizado, e a tela só mostrava a porta de configurar.
 */
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
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
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


  // Cria agente direto de um modelo (1 clique) ou em branco — sem modal.
  // Abre o drawer do novo agente pra renomear / ajustar a persona.
  async function createAgent(template_kind: string | null, nome: string) {
    if (creatingKey) return;
    setCreatingKey(template_kind ?? "__blank__");
    try {
      const { data } = await api.post<Agent>("/agents", { nome, persona: "", template_kind: template_kind ?? "" });
      toast.success("Agente criado");
      await load();
      // Recem-criado ja abre na pagina de configuracao — e onde se ajusta
      // persona/modelo, que e o proximo passo de quem acabou de criar.
      if (data?.id) navigate(`/admin/agentes/${data.id}`);
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
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao excluir");
    }
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
                              onClick={() => navigate(`/admin/agentes/${a.id}`)}
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

    </div>
  );
}

/**
 * resumoPersona — preview da persona pro card, sem markdown cru.
 *
 * A persona costuma ser um prompt estruturado ("# Identidade

Você é a
 * **Nathalia**…"). Jogado direto no card, o cliente lê "# Identidade Você é a
 * **Nathalia" — cerquilha, asterisco e tudo. Aqui os marcadores caem e sobra a
 * primeira frase de conteúdo, que é o que o card precisa dizer.
 */
function resumoPersona(persona: string | null | undefined): string {
  if (!persona) return "";
  const limpo = persona
    .replace(/^#{1,6}\s+.*$/gm, "") // linhas de cabeçalho inteiras
    .replace(/\*\*(.+?)\*\*/g, "$1") // negrito
    .replace(/\*(.+?)\*/g, "$1") // itálico
    .replace(/`+/g, "")
    .replace(/^[-*+]\s+/gm, "") // bullets
    .replace(/\s+/g, " ")
    .trim();
  return limpo;
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
          {resumoPersona(agent.persona) || "Sem persona definida."}
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


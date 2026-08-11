import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Plus, Workflow, Loader2, FileText, ArrowUpRight,
  LifeBuoy, TrendingUp, Repeat, Megaphone, MessageSquare,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, PageHero, Row, Button, btnPrimary, SkeletonBar, HairCells } from "@/components/ds/fc";

interface PlaybookListItem {
  id: number;
  agent_id: number;
  nome: string;
  descricao: string | null;
  status: "draft" | "published" | "archived";
  nodes_count: number;
  published_at: string | null;
  updated_at: string;
}

interface Agent {
  id: number;
  nome: string;
}

interface TemplateInfo {
  key: string;
  nome: string;
  descricao: string;
  nodes_count: number;
}

const inputCls = `w-full h-9 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow`;

export default function PlaybooksPage() {
  const navigate = useNavigate();
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ agent_id: 0, nome: "", descricao: "" });
  const [createMode, setCreateMode] = useState<"choose" | "blank" | "template">("choose");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [pbs, ags, tpls] = await Promise.all([
        api.get<PlaybookListItem[]>("/playbooks"),
        api.get<Agent[]>("/agents"),
        api.get<TemplateInfo[]>("/playbooks/templates"),
      ]);
      setPlaybooks(pbs.data);
      setAgents(ags.data);
      setTemplates(tpls.data);
      if (ags.data.length > 0) setCreateForm((f) => ({ ...f, agent_id: ags.data[0].id }));
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar playbooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setShowCreate(true);
    setCreateMode("choose");
    setSelectedTemplate(null);
  }

  async function onCreateBlank(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.agent_id || !createForm.nome) {
      toast.error("Escolha um agente e dê um nome");
      return;
    }
    setCreating(true);
    try {
      const { data } = await api.post<{ id: number }>("/playbooks", createForm);
      toast.success("Playbook criado");
      navigate(`/admin/playbooks/${data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao criar");
    } finally {
      setCreating(false);
    }
  }

  async function onCreateFromTemplate(templateKey: string) {
    if (!createForm.agent_id) {
      toast.error("Escolha um agente");
      return;
    }
    setCreating(true);
    try {
      const { data } = await api.post<{ id: number }>(`/playbooks/seed/${templateKey}`, { agent_id: createForm.agent_id });
      toast.success("Playbook criado a partir do template");
      navigate(`/admin/playbooks/${data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao criar");
    } finally {
      setCreating(false);
    }
  }

  // Card de template inline: 1 agente → cria direto; vários → abre o modal pra escolher.
  function useTemplateInline(templateKey: string) {
    if (creating) return;
    if (agents.length === 1) {
      setSelectedTemplate(templateKey);
      onCreateFromTemplate(templateKey);
      return;
    }
    setShowCreate(true);
    setCreateMode("template");
    setSelectedTemplate(templateKey);
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Playbooks"
          subtitle="Fluxos visuais de atendimento — desenhe gatilhos, ações e o agente IA segue o roteiro quando faz sentido."
          right={
            agents.length > 0 ? (
              <Button variant="primary" onClick={openCreate}><Plus className="w-3.5 h-3.5" /> Novo playbook</Button>
            ) : undefined
          }
        />

        {loading ? (
          <Row last><PlaybooksSkeleton /></Row>
        ) : agents.length === 0 ? (
          <Row last><EmptyState hasAgents={false} onCreate={openCreate} /></Row>
        ) : (
          <>
            <SectionRow
              title="Seus playbooks"
              subtitle={
                playbooks.length > 0
                  ? `${playbooks.length} ${playbooks.length === 1 ? "fluxo configurado" : "fluxos configurados"}`
                  : "Você ainda não criou nenhum — comece em branco ou puxe um template abaixo."
              }
            />
            <CardGrid last={templates.length === 0}>
              {playbooks.map((pb) => (
                <WorkflowCard
                  key={pb.id}
                  to={`/admin/playbooks/${pb.id}`}
                  icon={Workflow}
                  title={pb.nome}
                  tag={statusLabel(pb.status)}
                  tagTone={statusTone(pb.status)}
                  desc={pb.descricao || "Sem descrição."}
                />
              ))}
              <GhostCard onClick={openCreate} />
            </CardGrid>

            {templates.length > 0 && (
              <>
                <SectionRow
                  title="Comece rápido com um template"
                  subtitle="Skills prontas pra editar — um clique cria a cópia no seu agente."
                />
                <CardGrid last>
                  {templates.map((t) => {
                    const cat = templateTag(t);
                    return (
                      <WorkflowCard
                        key={t.key}
                        onClick={() => useTemplateInline(t.key)}
                        busy={creating && selectedTemplate === t.key}
                        icon={CAT_META[cat].icon}
                        title={t.nome}
                        tag={cat}
                        desc={t.descricao}
                      />
                    );
                  })}
                </CardGrid>
              </>
            )}
          </>
        )}
      </PageFrame>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} wide={createMode === "choose" || createMode === "template"}>
          {createMode === "choose" && (
            <div className="space-y-4">
              <h2 className={`text-[20px] font-[500] leading-7 fc-crisp ${FC.ink}`}>Novo playbook</h2>
              <p className={`text-[13px] ${FC.sub}`}>Comece em branco ou escolha um template pronto.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setCreateMode("blank")} className={`text-left rounded-lg p-4 border ${FC.hair} hover:border-[#003083] transition-colors`}>
                  <div className="w-9 h-9 rounded-md bg-[#262626]/[0.06] flex items-center justify-center mb-2"><Plus className={`w-[18px] h-[18px] ${FC.mut}`} /></div>
                  <div className={`text-[13px] font-medium mb-0.5 ${FC.ink}`}>Em branco</div>
                  <div className={`text-[11px] ${FC.sub}`}>Canvas vazio, monta do zero.</div>
                </button>
                <button onClick={() => setCreateMode("template")} className={`text-left rounded-lg p-4 border ${FC.hair} hover:border-[#003083] transition-colors`}>
                  <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center mb-2"><FileText className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" /></div>
                  <div className={`text-[13px] font-medium mb-0.5 ${FC.ink}`}>Template pronto</div>
                  <div className={`text-[11px] ${FC.sub}`}>FAQ, recuperar carrinho, qualificação SDR.</div>
                </button>
              </div>
              <div className="flex justify-end pt-2"><Button variant="secondary" onClick={() => setShowCreate(false)}>Cancelar</Button></div>
            </div>
          )}

          {createMode === "blank" && (
            <form onSubmit={onCreateBlank} className="space-y-4">
              <h2 className={`text-[20px] font-[500] leading-7 fc-crisp ${FC.ink}`}>Playbook em branco</h2>
              <AgentSelect agents={agents} value={createForm.agent_id} onChange={(v) => setCreateForm({ ...createForm, agent_id: v })} />
              <FormField label="Nome">
                <input type="text" value={createForm.nome} onChange={(e) => setCreateForm({ ...createForm, nome: e.target.value })} placeholder="Ex: Recuperar carrinho abandonado" required className={inputCls} />
              </FormField>
              <FormField label="Descrição (opcional)">
                <input type="text" value={createForm.descricao} onChange={(e) => setCreateForm({ ...createForm, descricao: e.target.value })} placeholder="Quando rodar? Qual o objetivo?" className={inputCls} />
              </FormField>
              <div className="flex justify-between pt-2">
                <Button variant="secondary" onClick={() => setCreateMode("choose")}>← Voltar</Button>
                <Button variant="primary" type="submit" disabled={creating}>{creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar e abrir</Button>
              </div>
            </form>
          )}

          {createMode === "template" && (
            <div className="space-y-4">
              <h2 className={`text-[20px] font-[500] leading-7 fc-crisp ${FC.ink}`}>Escolha um template</h2>
              <AgentSelect agents={agents} value={createForm.agent_id} onChange={(v) => setCreateForm({ ...createForm, agent_id: v })} />
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setSelectedTemplate(t.key); onCreateFromTemplate(t.key); }}
                    disabled={creating}
                    className={`w-full text-left rounded-lg p-3 border transition-colors disabled:opacity-50 ${selectedTemplate === t.key ? "border-[#003083]" : `${FC.hair} hover:border-[#003083]`}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center shrink-0 mt-0.5">
                        {selectedTemplate === t.key && creating ? <Loader2 className="w-3.5 h-3.5 text-[#003083] dark:text-[#5b9bff] animate-spin" /> : <FileText className="w-3.5 h-3.5 text-[#003083] dark:text-[#5b9bff]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13px] font-medium ${FC.ink}`}>{t.nome}</div>
                        <div className={`text-[11px] mt-0.5 ${FC.sub}`}>{t.descricao}</div>
                        <div className={`text-[10px] mt-1 ${FC.sub}`}>{t.nodes_count} nós</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-start pt-2"><Button variant="secondary" onClick={() => setCreateMode("choose")}>← Voltar</Button></div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function AgentSelect({ agents, value, onChange }: { agents: Agent[]; value: number; onChange: (v: number) => void }) {
  return (
    <FormField label="Agente">
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
        {agents.map((a) => (<option key={a.id} value={a.id}>{a.nome}</option>))}
      </select>
    </FormField>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block text-[12px] font-medium mb-1 ${FC.sub}`}>{label}</label>
      {children}
    </div>
  );
}

// SectionRow — cabeçalho de seção (label-x-large + subtítulo) numa Row FC, pra
// ficar conectado ao grid logo abaixo (linha única entre eles).
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

// CardGrid — grade FLUSH do Firecrawl: as celulas encostam e as bordas internas se
// CRUZAM, formando o "+". Era grid com gap e cards arredondados flutuando — o mesmo
// visual generico de "card de IA" que a lista de Agentes ja nao usa. Duas listas
// irmas do mesmo produto tinham dois sistemas; agora tem um.
function CardGrid({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return (
    <Row last={last}>
      <HairCells cols={3} gridLines>
        {children}
      </HairCells>
    </Row>
  );
}

// WorkflowCard — card no estilo Firecrawl workflows: ícone tintado + seta ↗ no topo,
// título + tag, descrição. Hover = borda na cor de destaque (azul Tier) + seta azul.
function WorkflowCard({
  icon: Icon, title, tag, tagTone = "neutral", desc, to, onClick, busy,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  tag?: string;
  tagTone?: "neutral" | "amber" | "green" | "gray";
  desc: string;
  to?: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  const tone =
    tagTone === "amber"
      ? "bg-[#F5A300]/[0.14] text-[#9a6700] dark:text-[#e0a93a]"
      : tagTone === "green"
        ? "bg-[#0a8f5a]/[0.12] text-[#0a8f5a]"
        : tagTone === "gray"
          ? "bg-[#262626]/[0.06] text-[#262626]/[0.5] dark:bg-white/[0.08] dark:text-[#8b93a0]"
          : "bg-[#262626]/[0.06] text-[#262626]/[0.6] dark:bg-white/[0.08] dark:text-[#9aa1ab]";
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-[10px] bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center">
          {busy ? (
            <Loader2 className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff] animate-spin" />
          ) : (
            <Icon className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" />
          )}
        </div>
        <ArrowUpRight className="w-4 h-4 text-[#262626]/25 dark:text-[#6b7280] group-hover:text-[#003083] dark:group-hover:text-[#5b9bff] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
      </div>
      <div className="mt-6">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className={`text-[15px] font-medium tracking-[-0.01em] ${FC.ink}`}>{title}</h3>
          {tag && <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${tone}`}>{tag}</span>}
        </div>
        <p className={`text-[13px] leading-5 line-clamp-1 ${FC.sub}`}>{desc}</p>
      </div>
    </>
  );
  // Celula flush: quem desenha a linha e a grade (HairCells), nao o card. Sem
  // raio, sem sombra e sem borda propria — hover so muda a superficie.
  const cls = `group relative flex h-full min-h-[132px] w-full flex-col p-5 transition-colors ${FC.hover}`;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return <button onClick={onClick} disabled={busy} className={`${cls} text-left disabled:opacity-60`}>{inner}</button>;
}

function GhostCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-1.5 p-5 transition-colors ${FC.hover}`}
    >
      <div className="w-10 h-10 rounded-[10px] bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.1] flex items-center justify-center group-hover:bg-[#003083]/[0.12] dark:group-hover:bg-[#5b9bff]/[0.18] transition-colors">
        <Plus className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" />
      </div>
      <span className={`text-[13px] font-medium ${FC.ink}`}>Novo playbook</span>
      <span className={`text-[11px] ${FC.mut}`}>Em branco ou de um template</span>
    </button>
  );
}

// Status do playbook → tag (rótulo + tom).
function statusLabel(s: PlaybookListItem["status"]) {
  return s === "published" ? "Publicado" : s === "archived" ? "Arquivado" : "Rascunho";
}
function statusTone(s: PlaybookListItem["status"]): "amber" | "green" | "gray" {
  return s === "published" ? "green" : s === "archived" ? "gray" : "amber";
}

// Categoria do template (heurística por palavra-chave) + ícone — pro look "catálogo"
// do Firecrawl (tags variadas Suporte/Vendas/Pós-venda/Marketing).
const CAT_META: Record<string, { icon: ComponentType<{ className?: string }> }> = {
  Suporte: { icon: LifeBuoy },
  Vendas: { icon: TrendingUp },
  "Pós-venda": { icon: Repeat },
  Marketing: { icon: Megaphone },
  Atendimento: { icon: MessageSquare },
};
function templateTag(t: TemplateInfo): keyof typeof CAT_META {
  const s = `${t.nome} ${t.descricao}`.toLowerCase();
  if (/faq|suporte|atendimento|triagem|\bl1\b|\bl2\b|d[úu]vida/.test(s)) return "Suporte";
  if (/sdr|qualific|\blead\b|bant|prospec|reuni[ãa]o/.test(s)) return "Vendas";
  if (/carrinho|recompra|reativ|\bnps\b|p[óo]s[- ]compra|cupom|fideliz/.test(s)) return "Pós-venda";
  if (/marketing|campanha|disparo|broadcast/.test(s)) return "Marketing";
  return "Atendimento";
}

// Carregando, a grade mostra a própria forma (cards) — não um spinner no vazio.
function PlaybooksSkeleton() {
  return (
    <div className="p-5">
      <div className="grid grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`border-r border-b ${FC.hair} p-5 min-h-[132px]`}>
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

function EmptyState({ hasAgents, onCreate }: { hasAgents: boolean; onCreate: () => void }) {
  return (
    <div className="p-12 text-center">
      <div className={`inline-flex w-12 h-12 rounded-md ${FC.base} items-center justify-center mb-4 border ${FC.hair}`}>
        <Workflow className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
      </div>
      <h3 className={`text-[20px] font-[500] leading-7 fc-crisp mb-1 ${FC.ink}`}>{hasAgents ? "Nenhum playbook ainda" : "Crie um agente primeiro"}</h3>
      <p className={`text-[13px] mb-5 max-w-md mx-auto ${FC.sub}`}>
        {hasAgents
          ? "Playbooks são fluxos visuais de atendimento. Quando uma mensagem matchar o trigger, o playbook executa em vez do agente IA livre."
          : "Você precisa de pelo menos um agente antes de criar playbooks. Vá em Agentes e crie o primeiro."}
      </p>
      {hasAgents ? (
        <Button variant="primary" onClick={onCreate} className="mx-auto"><Plus className="w-3.5 h-3.5" /> Criar playbook</Button>
      ) : (
        <Link to="/admin/agentes" className={btnPrimary}>Ir para Agentes</Link>
      )}
    </div>
  );
}

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`bg-white dark:bg-[#0c0e12] rounded-xl p-6 w-full shadow-xl border ${FC.hair} ${wide ? "max-w-lg" : "max-w-md"}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

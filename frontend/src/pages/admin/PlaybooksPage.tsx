import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Workflow, Loader2, CheckCircle2, Archive, FileText } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button, btnPrimary } from "@/components/ds/fc";

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

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Playbooks</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Fluxos visuais de atendimento — desenhe gatilhos, ações e o agente IA segue quando faz sentido.
              </p>
            </div>
            {agents.length > 0 && (
              <Button variant="primary" onClick={openCreate} className="shrink-0"><Plus className="w-3.5 h-3.5" /> Novo playbook</Button>
            )}
          </div>
        </Row>

        {loading ? (
          <Row last>
            <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 text-[#003083] dark:text-[#5b9bff] animate-spin" /></div>
          </Row>
        ) : playbooks.length === 0 ? (
          <Row last><EmptyState hasAgents={agents.length > 0} onCreate={openCreate} /></Row>
        ) : (
          <Row last>
            <HairCells cols={3} gridLines>
              {playbooks.map((pb) => (
                <PlaybookCard key={pb.id} pb={pb} />
              ))}
            </HairCells>
          </Row>
        )}
      </PageFrame>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} wide={createMode === "choose" || createMode === "template"}>
          {createMode === "choose" && (
            <div className="space-y-4">
              <h2 className={`text-[16px] font-[450] ${FC.ink}`}>Novo playbook</h2>
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
              <h2 className={`text-[16px] font-[450] ${FC.ink}`}>Playbook em branco</h2>
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
              <h2 className={`text-[16px] font-[450] ${FC.ink}`}>Escolha um template</h2>
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
                        <div className={`text-[10px] mt-1 ${FC.mut}`}>{t.nodes_count} nós</div>
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

function PlaybookCard({ pb }: { pb: PlaybookListItem }) {
  const StatusBadge = () => {
    if (pb.status === "published")
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#0a8f5a]/[0.12] text-[#0a8f5a]"><CheckCircle2 className="w-3 h-3" /> Publicado</span>;
    if (pb.status === "archived")
      return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#262626]/[0.08] ${FC.sub}`}><Archive className="w-3 h-3" /> Arquivado</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#F5A300]/[0.14] text-[#9a6700]"><FileText className="w-3 h-3" /> Rascunho</span>;
  };

  return (
    <Link to={`/admin/playbooks/${pb.id}`} className={`block p-5 h-full transition-colors ${FC.hover}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center">
          <Workflow className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" />
        </div>
        <StatusBadge />
      </div>
      <div className={`text-[14px] font-medium mb-1 truncate ${FC.ink}`}>{pb.nome}</div>
      {pb.descricao && <p className={`text-[12px] leading-relaxed mb-3 line-clamp-2 ${FC.sub}`}>{pb.descricao}</p>}
      <div className={`flex items-center justify-between text-[11px] ${FC.sub}`}>
        <span>{pb.nodes_count} {pb.nodes_count === 1 ? "nó" : "nós"}</span>
        <span>Atualizado {new Date(pb.updated_at).toLocaleDateString("pt-BR")}</span>
      </div>
    </Link>
  );
}

function EmptyState({ hasAgents, onCreate }: { hasAgents: boolean; onCreate: () => void }) {
  return (
    <div className="p-12 text-center">
      <div className={`inline-flex w-12 h-12 rounded-md ${FC.base} items-center justify-center mb-4 border ${FC.hair}`}>
        <Workflow className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
      </div>
      <h3 className={`text-[16px] font-[450] mb-1 ${FC.ink}`}>{hasAgents ? "Nenhum playbook ainda" : "Crie um agente primeiro"}</h3>
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

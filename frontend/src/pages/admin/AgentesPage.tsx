import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  DollarSign,
  Edit3,
  LifeBuoy,
  Loader2,
  MoreVertical,
  PauseCircle,
  PlayCircle,
  Plus,
  ShoppingBag,
  Target,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, Spacer, HairCells, Button, btnPrimary, EmptyHint, SkeletonBar } from "@/components/ds/fc";

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
};

export default function AgentesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", persona: "", template_kind: "atendente_loja" });
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

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

  const selectedTemplate = templates.find((t) => t.key === form.template_kind);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/agents", form);
      toast.success("Agente criado");
      setShowForm(false);
      setForm({ nome: "", persona: "", template_kind: "atendente_loja" });
      load();
    } catch (err) {
      toast.error("Erro ao salvar");
      console.error(err);
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
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Agentes</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Crie e gerencie os funcionários digitais do seu workspace.</p>
            </div>
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> Novo agente
            </Button>
          </div>
        </Row>

        <Spacer />

      {showForm && (
        <Row>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <h2 className="text-[14px] font-medium text-[#262626]">Novo agente</h2>

          <label className="block">
            <span className="text-[12px] text-[#262626]/[0.72]">Nome do agente</span>
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="ex: Atendente principal"
              className="mt-1 w-full h-7 px-3 text-[14px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              required
            />
          </label>

          <div>
            <span className="text-[12px] text-[#262626]/[0.72] block mb-2">Template inicial</span>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => {
                const Icon = ICONS[t.icon] || ShoppingBag;
                const active = form.template_kind === t.key;
                return (
                  <label
                    key={t.key}
                    className={`block cursor-pointer rounded-md border p-3 transition-colors ${
                      active ? "border-[#003083] bg-[#003083]/[0.05]" : "border-[#EDEDED] hover:border-[#262626]/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t.key}
                      checked={active}
                      onChange={(e) => setForm({ ...form, template_kind: e.target.value })}
                      className="sr-only"
                    />
                    <div className="flex items-start gap-2.5">
                      <div className={`p-1.5 rounded ${active ? "bg-[#003083] text-white" : "bg-[#262626]/[0.06] text-[#262626]/[0.56]"}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[#262626]">{t.label}</div>
                        <div className="text-[11px] text-[#262626]/[0.56] mt-0.5">{t.description}</div>
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {t.suggested_channels.map((c) => (
                            <span
                              key={c}
                              className="px-1.5 py-0.5 bg-[#262626]/[0.06] text-[#262626]/[0.72] text-[10px] rounded uppercase tracking-wide"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {selectedTemplate && (
              <p className="mt-2 text-[11px] text-[#262626]/[0.56]">
                💡 A persona e prompt deste template serão aplicados automaticamente (você pode
                sobrescrever editando depois).
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-[12px] text-[#262626]/[0.72]">Persona (livre)</span>
            <textarea
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
              placeholder="ex: Você é um atendente cordial e direto, fala em pt-BR..."
              rows={4}
              className="mt-1 w-full px-3 py-2 text-[13px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow font-mono"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-6 px-3 text-[12px] font-medium text-[#404452] rounded-md inline-flex items-center justify-center bg-white shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimary}
            >
              Criar agente
            </button>
          </div>
        </form>
        </Row>
      )}

      <Row last curvy={false}>
        {loading ? (
          // skeleton ecoa a grade de 3 cards (forma da página, não spinner no vazio)
          <HairCells cols={3} gridLines>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-full flex-col p-5">
                <div className="flex items-start gap-3">
                  <SkeletonBar className="w-9 h-9 rounded-[10px] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <SkeletonBar className="h-3.5 w-32 mb-2" />
                    <SkeletonBar className="h-3 w-20" />
                  </div>
                </div>
                <SkeletonBar className="mt-3 h-3 w-full" />
                <SkeletonBar className="mt-2 h-3 w-3/4" />
                <div className="mt-3 pt-3 border-t border-[#EDEDED] dark:border-[#23272e]">
                  <SkeletonBar className="h-3 w-24" />
                </div>
              </div>
            ))}
          </HairCells>
        ) : agents.length === 0 ? (
          <EmptyHint
            icon={Bot}
            text='Nenhum agente ainda — clique em "Novo agente" pra criar o primeiro funcionário digital.'
            className="py-12"
          />
        ) : (
          <HairCells cols={3} gridLines>
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
          </HairCells>
        )}
      </Row>
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
      className="group relative flex h-full flex-col p-5 cursor-pointer transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
    >
      {/* Topo: avatar + nome + status + menu */}
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
            agent.active
              ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
              : "bg-[#262626]/[0.05] text-[#262626]/40 dark:bg-white/[0.06] dark:text-[#6b7280]"
          }`}
        >
          <Bot className="w-[18px] h-[18px]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[#262626] dark:text-[#e6e8eb] truncate leading-5">{agent.nome}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            {agent.active ? (
              <span className="inline-flex items-center gap-1 font-medium text-[#0a8f5a]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0a8f5a]" /> Ativo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-[#262626]/40 dark:text-[#6b7280]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#262626]/25" /> Pausado
              </span>
            )}
            <span className="text-[#262626]/25">·</span>
            <span className="text-[#262626]/40 dark:text-[#6b7280] tabular-nums">#{agent.id}</span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(!menuOpen);
          }}
          className="w-7 h-7 -mr-1 -mt-0.5 inline-flex items-center justify-center rounded-md text-[#262626]/40 hover:text-[#262626] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] dark:hover:text-white"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* Persona */}
      <p className="mt-3 text-[12.5px] leading-relaxed text-[#262626]/[0.56] dark:text-[#8b93a0] line-clamp-2 min-h-[36px]">
        {agent.persona || <span className="italic text-[#262626]/30 dark:text-[#565d68]">Sem persona definida.</span>}
      </p>

      {/* Rodapé: template + abrir */}
      <div className="mt-3 pt-3 flex items-center justify-between border-t border-[#EDEDED] dark:border-[#23272e]">
        {agent.template_kind ? (
          <span className="inline-flex items-center text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-[#262626]/[0.05] text-[#262626]/[0.72] dark:bg-white/[0.06] dark:text-[#9aa1ab]">
            {agent.template_kind}
          </span>
        ) : (
          <span className="text-[10.5px] text-[#262626]/30">sem template</span>
        )}
        <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#003083] dark:text-[#5b9bff] opacity-0 group-hover:opacity-100 transition-opacity">
          Abrir <ArrowRight className="w-3 h-3" />
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                  className="flex-1 h-6 rounded text-[11px] text-[#262626]/[0.72] bg-[#262626]/[0.06] hover:bg-black/[0.06]"
                >
                  Não
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="flex-1 h-6 rounded text-[11px] text-white bg-red-500 hover:bg-red-600"
                >
                  Excluir
                </button>
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
        className="w-[520px] bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#EDEDED] flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] flex items-center justify-center shrink-0">
              <Bot className="w-[18px] h-[18px] text-[#003083]" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#262626] truncate">{agent.nome}</div>
              <div className="text-[11px] text-[#697386]">
                #{agent.id} · {agent.active ? "Ativo" : "Pausado"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[#262626]/40 hover:text-[#262626]/[0.72] hover:bg-black/[0.04]"
          >
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
              <button
                onClick={() => setEditing(true)}
                className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
              >
                <Edit3 className="w-3 h-3" /> Editar
              </button>
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
                      <Bot className="w-5 h-5" />
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
                <button
                  onClick={() => {
                    setEditing(false);
                    setForm({ nome: agent.nome, persona: agent.persona || "", avatar_url: agent.avatar_url || "" });
                  }}
                  className="h-6 px-3 rounded-md text-[12px] font-medium bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)]"
                >
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className={btnPrimary}
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Salvar
                </button>
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
            <a
              href={`/admin/agentes/${agent.id}/skills`}
              className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-white text-[#003083] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_#003083]"
            >
              ✨ Ver skills do agente
            </a>
            <button
              onClick={toggleActive}
              className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
            >
              {agent.active ? (
                <>
                  <PauseCircle className="w-3.5 h-3.5" /> Pausar agente
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" /> Ativar agente
                </>
              )}
            </button>

            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 space-y-2">
                <p className="text-[12px] text-red-700 leading-relaxed">
                  <strong>Excluir definitivamente {agent.nome}?</strong>
                  <br />
                  Isso remove TODOS os playbooks, conversas, knowledge e canais conectados a este
                  agente. <strong>Não dá pra desfazer.</strong>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 h-7 rounded-md text-[12px] font-medium bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)]"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={doDelete}
                    disabled={deleting}
                    className="flex-1 h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                    Sim, excluir
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir agente
              </button>
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

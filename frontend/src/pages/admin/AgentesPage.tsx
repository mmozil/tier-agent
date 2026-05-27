import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
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

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  template_kind: string | null;
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
    <div>
      <div className="flex items-center justify-between mt-6 mb-2">
        <h1 className="text-[28px] font-bold text-[#30313d]">Agentes</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-6 px-2 bg-[#003083] hover:bg-[#002266] text-white text-[12px] font-medium rounded-md inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Novo agente
        </button>
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Crie e gerencie os funcionários digitais do seu workspace.
      </p>

      {showForm && (
        <form onSubmit={onSubmit} className="bg-white rounded-md shadow-[0_0_0_1px_rgb(226,232,240)] p-6 mb-6 space-y-4">
          <h2 className="text-[14px] font-medium text-slate-900">Novo agente</h2>

          <label className="block">
            <span className="text-[12px] text-slate-700">Nome do agente</span>
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="ex: Atendente principal"
              className="mt-1 w-full h-7 px-3 text-[14px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              required
            />
          </label>

          <div>
            <span className="text-[12px] text-slate-700 block mb-2">Template inicial</span>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => {
                const Icon = ICONS[t.icon] || ShoppingBag;
                const active = form.template_kind === t.key;
                return (
                  <label
                    key={t.key}
                    className={`block cursor-pointer rounded-md border p-3 transition-colors ${
                      active ? "border-[#003083] bg-[#003083]/[0.05]" : "border-slate-200 hover:border-slate-300"
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
                      <div className={`p-1.5 rounded ${active ? "bg-[#003083] text-white" : "bg-slate-100 text-slate-500"}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-slate-900">{t.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{t.description}</div>
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {t.suggested_channels.map((c) => (
                            <span
                              key={c}
                              className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded uppercase tracking-wide"
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
              <p className="mt-2 text-[11px] text-slate-500">
                💡 A persona e prompt deste template serão aplicados automaticamente (você pode
                sobrescrever editando depois).
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-[12px] text-slate-700">Persona (livre)</span>
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
              className="h-6 px-3 text-[12px] font-medium bg-[#003083] text-white rounded-md hover:bg-[#002266] inline-flex items-center justify-center"
            >
              Criar agente
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading && (
          <div className="col-span-3 flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
          </div>
        )}
        {!loading && agents.length === 0 && (
          <div className="col-span-3 bg-[#f4f7fa] rounded-lg p-12 text-center">
            <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
              <Bot className="w-6 h-6 text-[#003083]" />
            </div>
            <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">Nenhum agente ainda</h3>
            <p className="text-[13px] text-[#697386]">Clique em "Novo agente" pra começar.</p>
          </div>
        )}
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
      </div>

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
      className="bg-white rounded-md p-5 shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow cursor-pointer relative"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-4 h-4 text-[#003083] shrink-0" />
            <div className="text-[14px] font-semibold text-[#1a2c44] truncate">{agent.nome}</div>
          </div>
          <div className="text-[11px] text-[#697386]">
            #{agent.id}
            {agent.template_kind && (
              <>
                {" · "}
                <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                  {agent.template_kind}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {agent.active ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" /> Pausado
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(!menuOpen);
            }}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {agent.persona && (
        <p className="mt-3 text-[12px] text-[#697386] line-clamp-3 leading-relaxed">{agent.persona}</p>
      )}

      {menuOpen && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-4 top-12 z-20 w-[180px] bg-white rounded-md shadow-xl border border-slate-200 py-1"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(false);
              onClick();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
          >
            <Edit3 className="w-3.5 h-3.5" /> Ver detalhes
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
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
            <div className="px-3 py-2 border-t border-slate-100">
              <p className="text-[11px] text-slate-600 mb-2 leading-snug">
                Excluir <strong>{agent.nome}</strong>? Remove playbooks, conversas, knowledge e canais.
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                  className="flex-1 h-6 rounded text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200"
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
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 border-t border-slate-100"
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
  const [form, setForm] = useState({ nome: agent.nome, persona: agent.persona || "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm({ nome: agent.nome, persona: agent.persona || "" });
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
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] flex items-center justify-center shrink-0">
              <Bot className="w-[18px] h-[18px] text-[#003083]" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#1a2c44] truncate">{agent.nome}</div>
              <div className="text-[11px] text-[#697386]">
                #{agent.id} · {agent.active ? "Ativo" : "Pausado"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="px-5 py-4 border-b border-slate-100">
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
        <div className="px-5 py-4 border-b border-slate-100">
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
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    setEditing(false);
                    setForm({ nome: agent.nome, persona: agent.persona || "" });
                  }}
                  className="h-6 px-3 rounded-md text-[12px] font-medium bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)]"
                >
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
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
                <span className="text-[#1a2c44]">{agent.template_kind || "—"}</span>
              </div>
              <div>
                <span className="text-[#697386]">Persona:</span>
                <p className="text-[#1a2c44] mt-1 leading-relaxed whitespace-pre-wrap">
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
    <div className="bg-[#f4f7fa] rounded-md p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[#697386] mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-[18px] font-semibold text-[#1a2c44] leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-[#697386] mt-0.5">{hint}</div>}
    </div>
  );
}

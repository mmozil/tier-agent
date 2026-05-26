import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Workflow, Loader2, CheckCircle2, Archive, FileText } from "lucide-react";

import { api } from "@/lib/api";

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

export default function PlaybooksPage() {
  const navigate = useNavigate();
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ agent_id: 0, nome: "", descricao: "" });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [pbs, ags] = await Promise.all([
        api.get<PlaybookListItem[]>("/playbooks"),
        api.get<Agent[]>("/agents"),
      ]);
      setPlaybooks(pbs.data);
      setAgents(ags.data);
      if (ags.data.length > 0) {
        setCreateForm((f) => ({ ...f, agent_id: ags.data[0].id }));
      }
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

  async function onCreate(e: React.FormEvent) {
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

  return (
    <div>
      <div className="flex items-center justify-between mt-6 mb-2">
        <h1 className="text-[28px] font-bold text-[#30313d]">Playbooks</h1>
        {agents.length > 0 && (
          <button
            onClick={() => setShowCreate(true)}
            className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center gap-1 bg-[#003083] text-white hover:bg-[#002266] transition-colors"
          >
            <Plus className="w-3 h-3" />
            Novo playbook
          </button>
        )}
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Fluxos visuais de atendimento — desenhe gatilhos, ações e o agente IA segue quando faz sentido.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
        </div>
      ) : playbooks.length === 0 ? (
        <EmptyState
          hasAgents={agents.length > 0}
          onCreate={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {playbooks.map((pb) => (
            <PlaybookCard key={pb.id} pb={pb} />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <form onSubmit={onCreate} className="space-y-4">
            <h2 className="text-[16px] font-semibold text-[#1a2c44]">Novo playbook</h2>
            <div>
              <label className="block text-[12px] font-medium text-[#697386] mb-1">Agente</label>
              <select
                value={createForm.agent_id}
                onChange={(e) => setCreateForm({ ...createForm, agent_id: Number(e.target.value) })}
                className="w-full h-7 px-3 text-[14px] rounded-md bg-white text-slate-700 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#697386] mb-1">Nome</label>
              <input
                type="text"
                value={createForm.nome}
                onChange={(e) => setCreateForm({ ...createForm, nome: e.target.value })}
                placeholder="Ex: Recuperar carrinho abandonado"
                required
                className="w-full h-7 px-3 text-[14px] rounded-md bg-white text-slate-700 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#697386] mb-1">Descrição (opcional)</label>
              <input
                type="text"
                value={createForm.descricao}
                onChange={(e) => setCreateForm({ ...createForm, descricao: e.target.value })}
                placeholder="Quando rodar? Qual o objetivo?"
                className="w-full h-7 px-3 text-[14px] rounded-md bg-white text-slate-700 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
              >
                {creating && <Loader2 className="w-3 h-3 animate-spin" />}
                Criar e abrir
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function PlaybookCard({ pb }: { pb: PlaybookListItem }) {
  const StatusBadge = () => {
    if (pb.status === "published")
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-600">
          <CheckCircle2 className="w-3 h-3" />
          Publicado
        </span>
      );
    if (pb.status === "archived")
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-500/15 text-slate-500">
          <Archive className="w-3 h-3" />
          Arquivado
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-600">
        <FileText className="w-3 h-3" />
        Rascunho
      </span>
    );
  };

  return (
    <Link
      to={`/admin/playbooks/${pb.id}`}
      className="block bg-white rounded-md p-5 shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] flex items-center justify-center">
          <Workflow className="w-[18px] h-[18px] text-[#003083]" />
        </div>
        <StatusBadge />
      </div>
      <div className="text-[14px] font-semibold text-[#1a2c44] mb-1 truncate">{pb.nome}</div>
      {pb.descricao && (
        <p className="text-[12px] text-[#697386] leading-relaxed mb-3 line-clamp-2">{pb.descricao}</p>
      )}
      <div className="flex items-center justify-between text-[11px] text-[#697386]">
        <span>{pb.nodes_count} {pb.nodes_count === 1 ? "nó" : "nós"}</span>
        <span>Atualizado {new Date(pb.updated_at).toLocaleDateString("pt-BR")}</span>
      </div>
    </Link>
  );
}

function EmptyState({ hasAgents, onCreate }: { hasAgents: boolean; onCreate: () => void }) {
  return (
    <div className="bg-[#f4f7fa] rounded-lg p-12 text-center">
      <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
        <Workflow className="w-6 h-6 text-[#003083]" />
      </div>
      <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">
        {hasAgents ? "Nenhum playbook ainda" : "Crie um agente primeiro"}
      </h3>
      <p className="text-[13px] text-[#697386] mb-5 max-w-md mx-auto">
        {hasAgents
          ? "Playbooks são fluxos visuais de atendimento. Quando uma mensagem matchar o trigger, o playbook executa em vez do agente IA livre."
          : "Você precisa de pelo menos um agente antes de criar playbooks. Vá em Agentes e crie o primeiro."}
      </p>
      {hasAgents ? (
        <button
          onClick={onCreate}
          className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266]"
        >
          <Plus className="w-3 h-3" />
          Criar playbook
        </button>
      ) : (
        <Link
          to="/admin/agentes"
          className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266]"
        >
          Ir para Agentes
        </Link>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Inbox, Phone, MessageCircle, Check, Archive, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";

interface Notification {
  id: number;
  agent_id: number | null;
  conversation_id: number | null;
  category: string;
  title: string;
  body: string | null;
  queue: string | null;
  payload_json: Record<string, any> | null;
  status: string;
  created_at: string;
  contato: string | null;
  telefone: string | null;
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  handoff: { label: "Atendimento humano", color: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  error: { label: "Erro", color: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  info: { label: "Info", color: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "lead", label: "Leads" },
  { key: "handoff", label: "Atendimento humano" },
] as const;

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function LeadsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Notification[]>("/notifications", {
        params: { status: "all", limit: 200 },
      });
      setItems(data);
    } catch {
      toast.error("Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id: number) {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, status: "read" } : n)));
    } catch {
      toast.error("Erro ao marcar como lida");
    }
  }

  async function archive(id: number) {
    try {
      await api.patch(`/notifications/${id}/archive`);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch {
      toast.error("Erro ao arquivar");
    }
  }

  const visible = items.filter((n) => {
    if (n.status === "archived") return false;
    if (filter === "all") return true;
    return n.category === filter;
  });

  const leadCount = items.filter((n) => n.category === "lead" && n.status !== "archived").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Leads &amp; Notificações</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Oportunidades capturadas no atendimento e pedidos de transferência para humano.
          </p>
        </div>
        <button
          onClick={load}
          className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-2 text-[14px] border-b-2 -mb-px transition-colors ${
              filter === f.key
                ? "border-[#003083] text-[#1a2c44] font-medium"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {f.label}
            {f.key === "lead" && leadCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 h-4 text-[11px] rounded-full bg-emerald-100 text-emerald-700">
                {leadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="text-[13px] text-slate-400 py-8 text-center">Carregando...</div>}

      {!loading && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">Nenhum item por aqui ainda.</p>
          <p className="text-[12px] text-slate-400 mt-1">
            Leads aparecem automaticamente quando um cliente demonstra interesse no atendimento.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {visible.map((n) => {
          const meta = CATEGORY_META[n.category] || CATEGORY_META.info;
          const tel = n.telefone || n.payload_json?.telefone || n.payload_json?.whatsapp;
          const contato = n.contato || n.payload_json?.contato;
          const unread = n.status === "unread";
          return (
            <div
              key={n.id}
              className={`bg-white rounded-xl border p-4 ${
                unread ? "border-slate-300 shadow-[0_0_0_1px_rgba(0,48,131,0.06)]" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${meta.color}`}>
                      {meta.label}
                    </span>
                    {unread && <span className="w-2 h-2 rounded-full bg-[#003083]" title="Não lido" />}
                    <span className="text-[12px] text-slate-400">{fmtDate(n.created_at)}</span>
                  </div>
                  <h3 className="text-[14px] font-semibold text-slate-900 truncate">{n.title}</h3>
                  {n.body && <p className="text-[13px] text-slate-600 mt-1 line-clamp-2">{n.body}</p>}
                  <div className="flex flex-wrap items-center gap-4 mt-2">
                    {tel && (
                      <a
                        href={`https://wa.me/${String(tel).replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[13px] text-emerald-700 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5" /> {tel}
                      </a>
                    )}
                    {contato && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-slate-500">
                        <MessageCircle className="w-3.5 h-3.5" /> {contato}
                      </span>
                    )}
                    {n.conversation_id && (
                      <a href="/admin/conversas" className="inline-flex items-center gap-1 text-[13px] text-[#003083] hover:underline">
                        <MessageCircle className="w-3.5 h-3.5" /> Ver conversa
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {unread && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Marcar como lida"
                      className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => archive(n.id)}
                    title="Arquivar"
                    className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquare, RefreshCw, X, User, Hand, Bot, CheckCircle2 } from "lucide-react";

import { api } from "@/lib/api";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "IA ativa", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  handed_off: { label: "Humano no controle", cls: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  closed: { label: "Resolvida", cls: "bg-slate-100 text-slate-500 ring-slate-400/20" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ${m.cls}`}>{m.label}</span>
  );
}

interface Conversation {
  id: number;
  agent_id: number;
  connector_kind: string | null;
  external_id: string;
  contact_name: string | null;
  status: string;
  msg_count: number;
  last_message_at: string | null;
  last_preview: string | null;
}

interface Message {
  id: number;
  role: string;
  content: string | null;
  model_used: string | null;
  created_at: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function fmtPhone(ext: string): string {
  const d = (ext || "").replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4)}`;
  return ext;
}

export default function ConversasPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [openConv, setOpenConv] = useState<Conversation | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Conversation[]>("/conversations", { params: { limit: 200 } });
      setConvs(data);
    } catch {
      toast.error("Falha ao carregar conversas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConversation(c: Conversation) {
    setOpenId(c.id);
    setOpenConv(c);
    setLoadingMsgs(true);
    setMsgs([]);
    try {
      const { data } = await api.get<{ messages: Message[] }>(`/conversations/${c.id}`);
      setMsgs(data.messages || []);
    } catch {
      toast.error("Falha ao abrir conversa");
    } finally {
      setLoadingMsgs(false);
    }
  }

  async function changeStatus(id: number, action: "handoff" | "resume" | "resolve") {
    try {
      const { data } = await api.post<{ status: string }>(`/conversations/${id}/${action}`);
      const newStatus = data.status;
      setOpenConv((prev) => (prev && prev.id === id ? { ...prev, status: newStatus } : prev));
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c)));
      const labels: Record<string, string> = {
        handoff: "Você assumiu — a IA está pausada",
        resume: "Devolvido para a IA",
        resolve: "Conversa resolvida",
      };
      toast.success(labels[action]);
    } catch {
      toast.error("Não foi possível atualizar");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Conversas</h1>
          <p className="text-[13px] text-slate-500 mt-1">Acompanhe as conversas do seu agente e o histórico de mensagens.</p>
        </div>
        <button onClick={load} className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>

      {loading && <div className="text-[13px] text-slate-400 py-8 text-center">Carregando...</div>}

      {!loading && convs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">Nenhuma conversa ainda.</p>
          <p className="text-[12px] text-slate-400 mt-1">As conversas aparecem aqui assim que clientes falarem com o agente.</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {convs.map((c) => (
          <button
            key={c.id}
            onClick={() => openConversation(c)}
            className="w-full text-left px-4 py-3 hover:bg-slate-50/70 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-[#003083]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-slate-900 truncate flex items-center gap-2">
                  {c.contact_name || fmtPhone(c.external_id)}
                  {c.status !== "active" && <StatusBadge status={c.status} />}
                </span>
                <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(c.last_message_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[12px] text-slate-500 truncate flex-1">{c.last_preview || "—"}</p>
                <span className="text-[11px] text-slate-400 shrink-0">{c.msg_count} msg</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Drawer detalhe */}
      {openId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-[480px] h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-slate-900 truncate">
                  {openConv?.contact_name || fmtPhone(openConv?.external_id || "")}
                </h2>
                <p className="text-[12px] text-slate-400 flex items-center gap-2">
                  {openConv?.connector_kind || "whatsapp"}
                  {openConv && <StatusBadge status={openConv.status} />}
                </p>
              </div>
              <button onClick={() => setOpenId(null)} className="p-1.5 rounded text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Ações: assumir / devolver / resolver */}
            {openConv && openConv.status !== "closed" && (
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                {openConv.status === "handed_off" ? (
                  <button
                    onClick={() => changeStatus(openConv.id, "resume")}
                    className="h-7 px-3 text-[12px] rounded-md bg-[#003083] text-white inline-flex items-center gap-1.5 hover:bg-[#002266]"
                  >
                    <Bot className="w-3.5 h-3.5" /> Devolver para a IA
                  </button>
                ) : (
                  <button
                    onClick={() => changeStatus(openConv.id, "handoff")}
                    className="h-7 px-3 text-[12px] rounded-md bg-blue-600 text-white inline-flex items-center gap-1.5 hover:bg-blue-700"
                  >
                    <Hand className="w-3.5 h-3.5" /> Assumir (pausar IA)
                  </button>
                )}
                <button
                  onClick={() => changeStatus(openConv.id, "resolve")}
                  className="h-7 px-3 text-[12px] rounded-md border border-slate-200 text-slate-600 inline-flex items-center gap-1.5 hover:bg-white"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                </button>
                {openConv.status === "handed_off" && (
                  <span className="text-[11px] text-blue-600 ml-auto">IA pausada — você está no controle</span>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-slate-50">
              {loadingMsgs && <div className="text-[13px] text-slate-400 text-center py-6">Carregando...</div>}
              {!loadingMsgs && msgs.length === 0 && (
                <div className="text-[12px] text-slate-400 text-center py-6">
                  Sem histórico de texto (mensagens antigas não foram gravadas; novas aparecem aqui).
                </div>
              )}
              {msgs.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] ${
                        isUser ? "bg-white border border-slate-200 text-slate-700" : "bg-[#003083] text-white"
                      }`}
                    >
                      {m.content || <span className="opacity-60 italic">[sem texto]</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

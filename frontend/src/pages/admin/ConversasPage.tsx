import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquare, RefreshCw, X, User, Hand, Bot, CheckCircle2, Send } from "lucide-react";

import { api } from "@/lib/api";
import CannedPicker from "@/components/CannedPicker";

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
  tags: string[];
  assigned_to: string | null;
  assigned_member_id: number | null;
  csat_state: string;
  csat_score: number | null;
}

interface Member {
  id: number;
  nome: string;
  role: string;
  online: boolean;
  status: string;
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
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<{ role: string; member_id: number | null } | null>(null);
  const [scope, setScope] = useState<"todas" | "mine" | "unassigned">("todas");
  const [mentions, setMentions] = useState<number[]>([]);

  async function load(sc = scope) {
    setLoading(true);
    try {
      const params: Record<string, any> = { limit: 200 };
      if (sc !== "todas") params.scope = sc;
      const { data } = await api.get<Conversation[]>("/conversations", { params });
      setConvs(data);
    } catch {
      toast.error("Falha ao carregar conversas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.get<Member[]>("/team/members").then(({ data }) => setMembers(data)).catch(() => {});
    api.get<{ role: string; member_id: number | null }>("/team/me").then(({ data }) => setMe(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link ?open=<id> (vindo de Leads → "Ver conversa")
  useEffect(() => {
    const openParam = new URLSearchParams(window.location.search).get("open");
    if (!openParam || convs.length === 0 || openId) return;
    const target = convs.find((c) => c.id === Number(openParam));
    if (target) openConversation(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs]);

  async function openConversation(c: Conversation) {
    setOpenId(c.id);
    setOpenConv(c);
    setNoteMode(false);
    setMentions([]);
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

  async function saveTags(convId: number, tags: string[]) {
    // normaliza local (igual backend)
    const norm: string[] = [];
    for (const t of tags) {
      const tt = t.trim().toLowerCase().slice(0, 24);
      if (tt && !norm.includes(tt)) norm.push(tt);
    }
    const next = norm.slice(0, 8);
    setOpenConv((prev) => (prev && prev.id === convId ? { ...prev, tags: next } : prev));
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, tags: next } : c)));
    try {
      await api.put(`/conversations/${convId}/tags`, { tags: next });
    } catch {
      toast.error("Erro ao salvar etiquetas");
    }
  }

  async function sendReply() {
    const text = replyText.trim();
    if (!text || !openConv || sending) return;
    setSending(true);
    try {
      if (noteMode) {
        const { data } = await api.post<Message>(`/conversations/${openConv.id}/note`, { content: text, mentions });
        setMsgs((prev) => [...prev, data]);
        setReplyText("");
        setMentions([]);
      } else {
        const { data } = await api.post<Message>(`/conversations/${openConv.id}/reply`, { content: text });
        setMsgs((prev) => [...prev, data]);
        setReplyText("");
        // responder assume a conversa (IA pausada)
        setOpenConv((prev) => (prev ? { ...prev, status: "handed_off" } : prev));
        setConvs((prev) => prev.map((c) => (c.id === openConv.id ? { ...c, status: "handed_off" } : c)));
      }
    } catch {
      toast.error("Não foi possível enviar");
    } finally {
      setSending(false);
    }
  }

  async function saveAssign(convId: number, memberId: number | null) {
    const m = members.find((x) => x.id === memberId);
    const nome = m?.nome || null;
    setOpenConv((prev) => (prev && prev.id === convId ? { ...prev, assigned_member_id: memberId, assigned_to: nome } : prev));
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, assigned_member_id: memberId, assigned_to: nome } : c)));
    try {
      await api.put(`/conversations/${convId}/assign`, { member_id: memberId });
    } catch {
      toast.error("Erro ao atribuir");
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

  const allTags = Array.from(new Set(convs.flatMap((c) => c.tags || []))).sort();
  const shownConvs = tagFilter ? convs.filter((c) => (c.tags || []).includes(tagFilter)) : convs;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[28px] font-bold text-[#30313d]">Conversas</h1>
          <p className="text-[13px] text-slate-500 mt-1">Acompanhe as conversas do seu agente e o histórico de mensagens.</p>
        </div>
        <button onClick={() => load()} className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Atualizar
        </button>
      </div>

      {/* Abas de escopo (fila) */}
      <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
        {([
          { k: "todas", label: "Todas" },
          { k: "unassigned", label: "Não atribuídas" },
          ...(me?.member_id ? [{ k: "mine", label: "Minhas" }] : []),
        ] as { k: "todas" | "mine" | "unassigned"; label: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => {
              setScope(t.k);
              load(t.k);
            }}
            className={`px-3 py-2 text-[14px] border-b-2 -mb-px transition-colors ${
              scope === t.k
                ? "border-[#003083] text-[#1a2c44] font-medium"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtro por etiqueta */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button
            onClick={() => setTagFilter(null)}
            className={`text-[12px] px-2.5 py-1 rounded-full border ${
              !tagFilter ? "bg-[#003083] text-white border-[#003083]" : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            Todas
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              className={`text-[12px] px-2.5 py-1 rounded-full border ${
                tagFilter === t
                  ? "bg-[#003083] text-white border-[#003083]"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="text-[13px] text-slate-400 py-8 text-center">Carregando...</div>}

      {!loading && convs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">Nenhuma conversa ainda.</p>
          <p className="text-[12px] text-slate-400 mt-1">As conversas aparecem aqui assim que clientes falarem com o agente.</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {shownConvs.map((c) => (
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
              {c.tags && c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[#003083]/[0.06] text-[#003083]">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
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

            {/* Atribuição + CSAT */}
            {openConv && (
              <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2">
                <span className="text-[12px] text-slate-500 shrink-0">Atendente:</span>
                <select
                  value={openConv.assigned_member_id ?? ""}
                  onChange={(e) => saveAssign(openConv.id, e.target.value ? Number(e.target.value) : null)}
                  className="text-[13px] px-2 py-1 rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083] w-48"
                >
                  <option value="">— ninguém —</option>
                  {members
                    .filter((m) => m.status === "active")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome} {m.online ? "🟢" : ""}
                      </option>
                    ))}
                </select>
                {openConv.csat_state === "done" && openConv.csat_score != null && (
                  <span className="ml-auto text-[12px] text-amber-600 font-medium">
                    ⭐ CSAT {openConv.csat_score}/5
                  </span>
                )}
                {openConv.csat_state === "pending" && (
                  <span className="ml-auto text-[11px] text-slate-400">aguardando avaliação…</span>
                )}
              </div>
            )}

            {/* Etiquetas */}
            {openConv && (
              <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-1.5">
                {(openConv.tags || []).map((t) => (
                  <span
                    key={t}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#003083]/[0.08] text-[#003083] inline-flex items-center gap-1"
                  >
                    #{t}
                    <button
                      onClick={() => saveTags(openConv.id, (openConv.tags || []).filter((x) => x !== t))}
                      className="hover:text-rose-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagInput.trim()) {
                      e.preventDefault();
                      saveTags(openConv.id, [...(openConv.tags || []), tagInput]);
                      setTagInput("");
                    }
                  }}
                  placeholder="+ etiqueta"
                  className="text-[12px] px-2 py-0.5 w-24 rounded-full border border-dashed border-slate-300 outline-none focus:border-[#003083]"
                />
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
                const isAgent = m.role === "agent";
                const isNote = m.role === "note";
                if (isNote) {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="max-w-[88%] rounded-lg px-3 py-1.5 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">
                        📝 <span className="font-medium">Nota interna:</span> {m.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] ${
                        isUser
                          ? "bg-white border border-slate-200 text-slate-700"
                          : isAgent
                            ? "bg-emerald-600 text-white"
                            : "bg-[#003083] text-white"
                      }`}
                    >
                      {m.content || <span className="opacity-60 italic">[sem texto]</span>}
                    </div>
                    {isAgent && <span className="text-[10px] text-emerald-600 mt-0.5 mr-1">Você (atendente)</span>}
                    {!isUser && !isAgent && <span className="text-[10px] text-slate-400 mt-0.5 mr-1">IA</span>}
                  </div>
                );
              })}
            </div>

            {/* Caixa de resposta — atendente responde pelo painel ou adiciona nota */}
            {openConv && openConv.status !== "closed" && (
              <div className="border-t border-slate-200 p-3 bg-white">
                <div className="flex items-center gap-1 mb-2">
                  <button
                    onClick={() => setNoteMode(false)}
                    className={`text-[12px] px-2.5 py-1 rounded-md ${
                      !noteMode ? "bg-emerald-50 text-emerald-700 font-medium" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    Responder
                  </button>
                  <button
                    onClick={() => setNoteMode(true)}
                    className={`text-[12px] px-2.5 py-1 rounded-md ${
                      noteMode ? "bg-amber-50 text-amber-700 font-medium" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    📝 Nota interna
                  </button>
                </div>
                {noteMode && members.filter((m) => m.status === "active").length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mb-2">
                    <span className="text-[11px] text-slate-400">Marcar:</span>
                    {members
                      .filter((m) => m.status === "active")
                      .map((m) => {
                        const on = mentions.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() =>
                              setMentions((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                            }
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${
                              on ? "bg-amber-100 text-amber-800 border-amber-300" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            @{m.nome}
                          </button>
                        );
                      })}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  {!noteMode && (
                    <CannedPicker
                      onInsert={(c) => setReplyText((prev) => (prev ? prev + "\n" + c : c))}
                    />
                  )}
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    rows={1}
                    placeholder={
                      noteMode
                        ? "Nota visível só pra equipe (não vai pro cliente)…"
                        : "Responder ao cliente… (Enter envia, Shift+Enter quebra linha)"
                    }
                    className={`flex-1 resize-none max-h-28 px-3 py-2 text-[13px] rounded-lg border outline-none ${
                      noteMode
                        ? "border-amber-200 bg-amber-50/40 focus:shadow-[0_0_0_2px_#f59e0b]"
                        : "border-slate-200 focus:shadow-[0_0_0_2px_#003083]"
                    }`}
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-white disabled:opacity-40 ${
                      noteMode ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
                    }`}
                    title="Enviar"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  {noteMode
                    ? "A nota fica registrada na conversa, visível só pra equipe."
                    : "Ao responder, você assume a conversa e a IA fica pausada."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

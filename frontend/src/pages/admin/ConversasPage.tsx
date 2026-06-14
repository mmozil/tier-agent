import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquare, RefreshCw, X, User, Hand, Bot, CheckCircle2, Send, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import CannedPicker from "@/components/CannedPicker";
import { btnPrimary, EmptyHint, SkeletonBar } from "@/components/ds/fc";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "IA ativa", cls: "bg-[#0a8f5a]/[0.12] text-[#0a8f5a]" },
  handed_off: { label: "Humano no controle", cls: "bg-[#003083]/[0.10] text-[#003083]" },
  closed: { label: "Resolvida", cls: "bg-[#262626]/[0.06] text-[#262626]/[0.56]" },
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
  snoozed_until: string | null;
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
    // Backend manda UTC, às vezes SEM 'Z' (datetime naive). Sem isso o new Date
    // interpreta como horário local → fica ~3h adiantado. Força UTC + renderiza SP.
    const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    return new Date(norm).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
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
  const [macros, setMacros] = useState<{ id: number; name: string }[]>([]);
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
  const [scope, setScope] = useState<"todas" | "mine" | "unassigned" | "snoozed">("todas");
  const [mentions, setMentions] = useState<number[]>([]);
  const [cleanMenu, setCleanMenu] = useState(false);

  async function deleteConv(id: number) {
    if (!confirm("Excluir esta conversa e todo o histórico? Não dá pra desfazer.")) return;
    try {
      await api.delete(`/conversations/${id}`);
      setConvs((prev) => prev.filter((c) => c.id !== id));
      setOpenId(null);
      setOpenConv(null);
      toast.success("Conversa excluída");
    } catch {
      toast.error("Erro ao excluir");
    }
  }

  async function bulkDelete(kind: "closed" | "all") {
    setCleanMenu(false);
    const msg =
      kind === "all"
        ? "Excluir TODAS as conversas e seus históricos? Não dá pra desfazer."
        : "Excluir todas as conversas RESOLVIDAS? Não dá pra desfazer.";
    if (!confirm(msg)) return;
    try {
      const body = kind === "all" ? { all: true } : { status: "closed" };
      const { data } = await api.post<{ count: number }>("/conversations/bulk-delete", body);
      toast.success(`${data.count} conversa(s) excluída(s)`);
      setOpenId(null);
      setOpenConv(null);
      load();
    } catch {
      toast.error("Não foi possível limpar");
    }
  }

  async function snoozeConv(id: number, minutes: number) {
    try {
      await api.post(`/conversations/${id}/snooze`, { minutes });
      toast.success(minutes >= 1440 ? "Adiada pra amanhã" : `Adiada por ${minutes >= 60 ? minutes / 60 + "h" : minutes + "min"}`);
      setConvs((prev) => prev.filter((c) => c.id !== id));
      setOpenId(null);
    } catch {
      toast.error("Erro ao adiar");
    }
  }

  async function unsnoozeConv(id: number) {
    try {
      await api.post(`/conversations/${id}/unsnooze`);
      setOpenConv((prev) => (prev && prev.id === id ? { ...prev, snoozed_until: null } : prev));
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, snoozed_until: null } : c)));
      toast.success("Reativada");
    } catch {
      toast.error("Erro ao reativar");
    }
  }

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

  const msgsEndRef = useRef<HTMLDivElement | null>(null);

  // Ao abrir/atualizar a conversa, rola pro final (mensagem mais recente visível) —
  // senão a conversa abre no topo e o usuário precisa descer manualmente.
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  useEffect(() => {
    load();
    api.get<Member[]>("/team/members").then(({ data }) => setMembers(data)).catch(() => {});
    api.get<{ role: string; member_id: number | null }>("/team/me").then(({ data }) => setMe(data)).catch(() => {});
    api.get<{ id: number; name: string }[]>("/macros").then(({ data }) => setMacros(data)).catch(() => {});
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

  async function applyMacro(macroId: number) {
    if (!openId) return;
    try {
      const { data } = await api.post<{ executed: string[] }>(`/macros/${macroId}/apply?conversation_id=${openId}`);
      toast.success(`Macro aplicada: ${(data.executed || []).join(", ") || "ok"}`);
      if (openConv) openConversation(openConv);
      load();
    } catch {
      toast.error("Erro ao aplicar macro");
    }
  }

  const allTags = Array.from(new Set(convs.flatMap((c) => c.tags || []))).sort();
  const shownConvs = tagFilter ? convs.filter((c) => (c.tags || []).includes(tagFilter)) : convs;

  return (
    <div className="max-w-[1232px] mx-auto pt-1">
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h1 className="text-[20px] font-[450] tracking-[-0.1px] text-[#262626] dark:text-[#e6e8eb]">Conversas</h1>
          <p className="text-[13px] text-[#262626]/[0.56] dark:text-[#8b93a0] mt-1">Acompanhe as conversas do seu agente e o histórico de mensagens.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setCleanMenu((v) => !v)}
              className="h-8 px-3 text-[13px] font-medium text-[#262626]/[0.72] dark:text-[#9aa1ab] border border-[#EDEDED] dark:border-[#23272e] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-lg inline-flex items-center gap-1.5 transition-colors active:scale-[0.98]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar
            </button>
            {cleanMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCleanMenu(false)} />
                <div className="absolute right-0 mt-1 z-20 w-60 bg-white dark:bg-[#16191f] border border-[#EDEDED] dark:border-[#23272e] rounded-lg shadow-lg py-1 overflow-hidden">
                  <button
                    onClick={() => bulkDelete("closed")}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#262626] dark:text-[#e6e8eb] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  >
                    Excluir resolvidas
                    <span className="block text-[11px] text-[#262626]/[0.5] dark:text-[#8b93a0]">
                      Remove as conversas já encerradas
                    </span>
                  </button>
                  <button
                    onClick={() => bulkDelete("all")}
                    className="w-full text-left px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  >
                    Excluir todas
                    <span className="block text-[11px] text-rose-400">
                      Apaga todas as conversas do agente
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={() => load()} className="h-8 px-3 text-[13px] font-medium text-[#262626]/[0.72] dark:text-[#9aa1ab] border border-[#EDEDED] dark:border-[#23272e] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-lg inline-flex items-center gap-1.5 transition-colors active:scale-[0.98]">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      </div>

      {/* Abas de escopo (fila) */}
      <div className="flex items-center gap-1 mb-3 border-b border-[#EDEDED]">
        {([
          { k: "todas", label: "Todas" },
          { k: "unassigned", label: "Não atribuídas" },
          ...(me?.member_id ? [{ k: "mine", label: "Minhas" }] : []),
          { k: "snoozed", label: "Adiadas" },
        ] as { k: "todas" | "mine" | "unassigned" | "snoozed"; label: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => {
              setScope(t.k);
              load(t.k);
            }}
            className={`px-3 py-2 text-[14px] border-b-2 -mb-px transition-colors ${
              scope === t.k
                ? "border-[#003083] text-[#262626] font-medium"
                : "border-transparent text-[#262626]/[0.56] hover:text-[#262626]"
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
              !tagFilter ? "bg-[#003083] text-white border-[#003083]" : "border-[#EDEDED] text-[#262626]/[0.56] hover:bg-black/[0.03]"
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
                  : "border-[#EDEDED] text-[#262626]/[0.72] hover:bg-black/[0.03]"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {/* Loading: skeleton ecoa a forma das linhas da lista (não spinner no vazio) */}
      {loading && (
        <div className="overflow-hidden rounded-xl border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#16191f] divide-y divide-[#EDEDED] dark:divide-[#23272e]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <SkeletonBar className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <SkeletonBar className="h-3.5 w-40" />
                  <SkeletonBar className="h-3 w-12 ml-auto" />
                </div>
                <SkeletonBar className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && shownConvs.length === 0 && (
        <div className="rounded-xl border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#16191f] py-12">
          {tagFilter ? (
            <EmptyHint icon={MessageSquare} text={`Nenhuma conversa com #${tagFilter}.`} />
          ) : (
            <EmptyHint
              icon={MessageSquare}
              text="Nenhuma conversa ainda — elas aparecem assim que clientes falarem com o agente."
              ctaLabel="Conectar canal"
              ctaTo="/admin/canais"
            />
          )}
        </div>
      )}

      {!loading && shownConvs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#16191f] divide-y divide-[#EDEDED] dark:divide-[#23272e]">
          {shownConvs.map((c) => {
            const assignedM = members.find((x) => x.id === c.assigned_member_id);
            const name = c.contact_name || fmtPhone(c.external_id);
            const dot =
              c.status === "active" ? "bg-[#0a8f5a]" : c.status === "handed_off" ? "bg-[#003083]" : "bg-[#262626]/30";
            return (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className="group w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
              >
                {/* avatar com inicial + dot de status */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[14px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                    {(name || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#16191f] ${dot}`}
                    title={STATUS_META[c.status]?.label || ""}
                  />
                </div>
                {/* corpo */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{name}</span>
                    {c.status !== "active" && <StatusBadge status={c.status} />}
                    {/* data/contagem (11px) em sub: texto pequeno precisa de contraste legível */}
                    <span className="ml-auto shrink-0 text-[11px] text-[#262626]/[0.56] dark:text-[#8b93a0] tabular-nums">{fmtDate(c.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="flex-1 truncate text-[12.5px] text-[#262626]/[0.56] dark:text-[#8b93a0]">
                      {c.last_preview || <span className="italic text-[#262626]/30">Sem prévia</span>}
                    </p>
                    <span className="shrink-0 text-[11px] text-[#262626]/[0.56] dark:text-[#8b93a0] tabular-nums">{c.msg_count} msg</span>
                  </div>
                  {((c.tags && c.tags.length > 0) || assignedM) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {assignedM && (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#262626]/[0.05] text-[#262626]/[0.72] dark:bg-white/[0.06] dark:text-[#9aa1ab]">
                          <User className="w-2.5 h-2.5" /> {assignedM.nome}
                        </span>
                      )}
                      {(c.tags || []).map((t) => (
                        <span key={t} className="rounded px-1.5 py-0.5 text-[10px] bg-[#003083]/[0.06] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Drawer detalhe */}
      {openId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-[760px] h-full bg-white dark:bg-[#0c0e12] shadow-2xl flex flex-col border-l border-[#EDEDED] dark:border-[#23272e]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#EDEDED] dark:border-[#23272e]">
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
                  {(openConv?.contact_name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate leading-tight">
                    {openConv?.contact_name || fmtPhone(openConv?.external_id || "")}
                  </h2>
                  <p className="text-[12px] text-[#262626]/40 dark:text-[#6b7280] flex items-center gap-2">
                    {openConv?.connector_kind || "whatsapp"}
                    {openConv && <StatusBadge status={openConv.status} />}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openConv && deleteConv(openConv.id)}
                  title="Excluir conversa"
                  className="p-1.5 rounded-md text-[#262626]/40 dark:text-[#6b7280] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={() => setOpenId(null)} className="p-1.5 rounded-md text-[#262626]/40 dark:text-[#6b7280] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Ações: assumir / devolver / resolver */}
            {openConv && openConv.status !== "closed" && (
              <div className="flex items-center gap-2 px-6 py-3 border-b border-[#EDEDED] dark:border-[#23272e] bg-[#F9F9F9]/60 dark:bg-white/[0.02]">
                {openConv.status === "handed_off" ? (
                  <button
                    onClick={() => changeStatus(openConv.id, "resume")}
                    className={btnPrimary}
                  >
                    <Bot className="w-3.5 h-3.5" /> Devolver para a IA
                  </button>
                ) : (
                  <button
                    onClick={() => changeStatus(openConv.id, "handoff")}
                    className={btnPrimary}
                  >
                    <Hand className="w-3.5 h-3.5" /> Assumir (pausar IA)
                  </button>
                )}
                <button
                  onClick={() => changeStatus(openConv.id, "resolve")}
                  className="h-7 px-3 text-[12px] rounded-md border border-[#EDEDED] text-[#262626]/[0.72] inline-flex items-center gap-1.5 hover:bg-white"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                </button>
                {openConv.snoozed_until ? (
                  <button
                    onClick={() => unsnoozeConv(openConv.id)}
                    className="h-7 px-3 text-[12px] rounded-md border border-amber-200 bg-amber-50 text-amber-700 inline-flex items-center gap-1.5"
                  >
                    💤 Reativar
                  </button>
                ) : (
                  <select
                    value=""
                    onChange={(e) => e.target.value && snoozeConv(openConv.id, Number(e.target.value))}
                    className="h-7 px-2 text-[12px] rounded-md border border-[#EDEDED] text-[#262626]/[0.72] outline-none"
                  >
                    <option value="">💤 Adiar…</option>
                    <option value="60">1 hora</option>
                    <option value="240">4 horas</option>
                    <option value="1440">Amanhã (24h)</option>
                  </select>
                )}
                {macros.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && applyMacro(Number(e.target.value))}
                    className="h-7 px-2 text-[12px] rounded-md border border-[#EDEDED] dark:border-[#23272e] dark:bg-[#14171c] text-[#262626]/[0.72] dark:text-[#9aa1ab] outline-none"
                    title="Aplicar macro"
                  >
                    <option value="">⚡ Macro…</option>
                    {macros.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
                {openConv.status === "handed_off" && (
                  <span className="text-[11px] text-[#003083] ml-auto">IA pausada — você está no controle</span>
                )}
              </div>
            )}

            {/* Atribuição + CSAT */}
            {openConv && (
              <div className="px-6 py-2.5 border-b border-[#EDEDED] dark:border-[#23272e] flex items-center gap-2">
                <span className="text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0] shrink-0">Atendente:</span>
                <select
                  value={openConv.assigned_member_id ?? ""}
                  onChange={(e) => saveAssign(openConv.id, e.target.value ? Number(e.target.value) : null)}
                  className="text-[13px] px-2 py-1 rounded-md border border-[#EDEDED] outline-none focus:shadow-[0_0_0_2px_#003083] w-48"
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
                  <span className="ml-auto text-[11px] text-[#262626]/40">aguardando avaliação…</span>
                )}
              </div>
            )}

            {/* Etiquetas */}
            {openConv && (
              <div className="px-6 py-2.5 border-b border-[#EDEDED] dark:border-[#23272e] flex flex-wrap items-center gap-1.5">
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
                  className="text-[12px] px-2 py-0.5 w-24 rounded-full border border-dashed border-[#EDEDED] outline-none focus:border-[#003083]"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2.5 bg-[#F9F9F9] dark:bg-[#0f1115]">
              {loadingMsgs && <div className="text-[13px] text-[#262626]/40 text-center py-6">Carregando...</div>}
              {!loadingMsgs && msgs.length === 0 && (
                <div className="text-[12px] text-[#262626]/40 text-center py-6">
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
                          ? "bg-white border border-[#EDEDED] text-[#262626]"
                          : isAgent
                            ? "bg-[#003083] text-white"
                            : "bg-[#003083] text-white"
                      }`}
                    >
                      {m.content || <span className="opacity-60 italic">[sem texto]</span>}
                    </div>
                    {isAgent && <span className="text-[10px] text-[#003083] mt-0.5 mr-1">Você (atendente)</span>}
                    {!isUser && !isAgent && <span className="text-[10px] text-[#262626]/40 mt-0.5 mr-1">IA</span>}
                  </div>
                );
              })}
              <div ref={msgsEndRef} />
            </div>

            {/* Caixa de resposta — atendente responde pelo painel ou adiciona nota */}
            {openConv && openConv.status !== "closed" && (
              <div className="border-t border-[#EDEDED] dark:border-[#23272e] px-6 py-3 bg-white dark:bg-[#0c0e12]">
                <div className="flex items-center gap-1 mb-2">
                  <button
                    onClick={() => setNoteMode(false)}
                    className={`text-[12px] px-2.5 py-1 rounded-md ${
                      !noteMode ? "bg-[#003083]/[0.08] text-[#003083] font-medium" : "text-[#262626]/[0.56] hover:bg-black/[0.04]"
                    }`}
                  >
                    Responder
                  </button>
                  <button
                    onClick={() => setNoteMode(true)}
                    className={`text-[12px] px-2.5 py-1 rounded-md ${
                      noteMode ? "bg-amber-50 text-amber-700 font-medium" : "text-[#262626]/[0.56] hover:bg-black/[0.04]"
                    }`}
                  >
                    📝 Nota interna
                  </button>
                </div>
                {noteMode && members.filter((m) => m.status === "active").length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mb-2">
                    <span className="text-[11px] text-[#262626]/40">Marcar:</span>
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
                              on ? "bg-amber-100 text-amber-800 border-amber-300" : "border-[#EDEDED] text-[#262626]/[0.56] hover:bg-black/[0.03]"
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
                    className={`flex-1 resize-none max-h-28 px-3 py-2 text-[13px] rounded-lg border outline-none dark:bg-[#14171c] dark:text-[#e6e8eb] ${
                      noteMode
                        ? "border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10 focus:shadow-[0_0_0_2px_#f59e0b]"
                        : "border-[#EDEDED] dark:border-[#23272e] focus:shadow-[0_0_0_2px_#003083]"
                    }`}
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-white disabled:opacity-40 ${
                      noteMode ? "bg-amber-500 hover:bg-amber-600" : "bg-[#003083] hover:bg-[#002266]"
                    }`}
                    title="Enviar"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-[#262626]/40 mt-1.5">
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

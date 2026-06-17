import { useEffect, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { MessageSquare, RefreshCw, X, User, Hand, Bot, CheckCircle2, Trash2, Inbox, ArrowUp } from "lucide-react";

import { api } from "@/lib/api";
import CannedPicker from "@/components/CannedPicker";
import { Button, btnPrimary, iconBtn, EmptyHint, SkeletonBar, FC } from "@/components/ds/fc";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "IA ativa", cls: "bg-[#0a8f5a]/[0.12] text-[#0a8f5a]" },
  handed_off: { label: "Humano no controle", cls: "bg-[#003083]/[0.10] text-[#003083] dark:bg-[#5b9bff]/[0.16] dark:text-[#8ab4ff]" },
  closed: { label: "Resolvida", cls: "bg-[#262626]/[0.06] text-[#262626]/[0.56] dark:bg-white/[0.06] dark:text-[#8b93a0]" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
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

// Hora curta (HH:MM) — pros carimbos das bolhas de mensagem.
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    return new Date(norm).toLocaleString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "";
  }
}

function fmtPhone(ext: string): string {
  const d = (ext || "").replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4)}`;
  return ext;
}

// Ajusta a altura do textarea ao conteúdo: cresce conforme digita/pula linha, até um
// teto (180px) — depois disso rola interno. Sem isso o campo ficava fixo em 1 linha.
function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 180)}px`;
}

// Renderiza o markdown do WhatsApp (*negrito* _itálico_ ~tachado~ `mono`) que a IA
// usa nas mensagens — sem isso os asteriscos apareciam crus. As quebras de linha são
// preservadas via `whitespace-pre-wrap` na bolha.
function renderRich(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    if (tok[0] === "*") nodes.push(<strong key={k++} className="font-semibold">{inner}</strong>);
    else if (tok[0] === "_") nodes.push(<em key={k++}>{inner}</em>);
    else if (tok[0] === "~") nodes.push(<del key={k++} className="opacity-70">{inner}</del>);
    else nodes.push(<code key={k++} className="font-mono text-[12px] px-1 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.10]">{inner}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
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

  async function load(sc = scope, silent = false) {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, any> = { limit: 200 };
      if (sc !== "todas") params.scope = sc;
      const { data } = await api.get<Conversation[]>("/conversations", { params });
      setConvs(data);
    } catch {
      if (!silent) toast.error("Falha ao carregar conversas");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const msgsEndRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Ao abrir/atualizar a conversa, rola pro final (mensagem mais recente visível) —
  // senão a conversa abre no topo e o usuário precisa descer manualmente.
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  // compositor cresce conforme digita (e reseta ao trocar de conversa / após enviar)
  useEffect(() => {
    if (taRef.current) autoGrowTextarea(taRef.current);
  }, [replyText, openId, noteMode]);

  useEffect(() => {
    load();
    api.get<Member[]>("/team/members").then(({ data }) => setMembers(data)).catch(() => {});
    api.get<{ role: string; member_id: number | null }>("/team/me").then(({ data }) => setMe(data)).catch(() => {});
    api.get<{ id: number; name: string }[]>("/macros").then(({ data }) => setMacros(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh (inbox ao vivo): a cada 10s atualiza a lista e a conversa aberta
  // SILENCIOSAMENTE (sem spinner/flicker/toast). Sem isso, mensagens novas do canal
  // só apareciam ao recarregar a página — parecia que "não chegava conversa".
  useEffect(() => {
    const id = setInterval(() => {
      load(scope, true);
      if (openId) {
        api
          .get<{ messages: Message[] }>(`/conversations/${openId}`)
          .then(({ data }) => {
            const next = data.messages || [];
            // só troca se chegou msg nova — evita pular o scroll enquanto o atendente lê
            setMsgs((prev) => (next.length > prev.length ? next : prev));
          })
          .catch(() => {});
      }
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, openId]);

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

  const scopeTabs = [
    { k: "todas", label: "Todas" },
    { k: "unassigned", label: "Não atribuídas" },
    ...(me?.member_id ? [{ k: "mine", label: "Minhas" }] : []),
    { k: "snoozed", label: "Adiadas" },
  ] as { k: "todas" | "mine" | "unassigned" | "snoozed"; label: string }[];

  return (
    <div className="h-[calc(100vh-92px)] flex flex-col max-w-[1500px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 mb-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-[20px] font-[500] fc-crisp tracking-[-0.1px] text-[#262626] dark:text-[#e6e8eb]">Conversas</h1>
          <p className={`text-[13px] ${FC.sub} mt-0.5`}>Atenda as conversas do seu agente — assuma, responda e resolva sem sair daqui.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Button variant="secondary" onClick={() => setCleanMenu((v) => !v)}>
              <Trash2 className="w-3.5 h-3.5" /> Limpar
            </Button>
            {cleanMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCleanMenu(false)} />
                <div className={`absolute right-0 mt-1 z-20 w-60 bg-white dark:bg-[#16191f] border ${FC.hair} rounded-xl shadow-lg py-1 overflow-hidden`}>
                  <button
                    onClick={() => bulkDelete("closed")}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#262626] dark:text-[#e6e8eb] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  >
                    Excluir resolvidas
                    <span className="block text-[11px] text-[#262626]/[0.5] dark:text-[#8b93a0]">Remove as conversas já encerradas</span>
                  </button>
                  <button
                    onClick={() => bulkDelete("all")}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#c0362c] dark:text-[#ff6b5e] hover:bg-[#c0362c]/[0.06] dark:hover:bg-[#ff6b5e]/[0.10]"
                  >
                    Excluir todas
                    <span className="block text-[11px] text-[#c0362c]/60 dark:text-[#ff6b5e]/60">Apaga todas as conversas do agente</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <Button variant="secondary" onClick={() => load()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {/* Inbox: 2 painéis (lista | conversa) */}
      <div className={`flex-1 min-h-0 flex rounded-2xl border ${FC.hair} bg-white dark:bg-[#0c0e12] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.03)]`}>
        {/* ─────────────── PAINEL ESQUERDO: lista ─────────────── */}
        <div className={`w-[372px] shrink-0 border-r ${FC.hair} flex flex-col min-h-0`}>
          {/* abas de escopo */}
          <div className={`flex items-center gap-0.5 px-2 pt-2 border-b ${FC.hair} shrink-0`}>
            {scopeTabs.map((t) => (
              <button
                key={t.k}
                onClick={() => { setScope(t.k); load(t.k); }}
                className={`px-2.5 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
                  scope === t.k
                    ? "border-[#003083] dark:border-[#5b9bff] text-[#262626] dark:text-[#e6e8eb] font-medium"
                    : `border-transparent ${FC.sub} hover:text-[#262626] dark:hover:text-white`
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* filtro por etiqueta */}
          {allTags.length > 0 && (
            <div className={`flex flex-wrap items-center gap-1.5 px-3 py-2.5 border-b ${FC.hair} shrink-0`}>
              <button
                onClick={() => setTagFilter(null)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  !tagFilter ? "bg-[#003083] text-white border-[#003083] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:border-[#5b9bff]" : `${FC.hair} ${FC.sub} ${FC.hover}`
                }`}
              >
                Todas
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(t)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                    tagFilter === t ? "bg-[#003083] text-white border-[#003083] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:border-[#5b9bff]" : `${FC.hair} ${FC.dim} ${FC.hover}`
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {/* lista (scroll) */}
          <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
            {loading && (
              <div className={`divide-y ${FC.hair}`}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="px-3 py-3 flex items-center gap-3">
                    <SkeletonBar className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <SkeletonBar className="h-3 w-28" />
                        <SkeletonBar className="h-2.5 w-10 ml-auto" />
                      </div>
                      <SkeletonBar className="h-2.5 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && shownConvs.length === 0 && (
              <div className="py-12 px-4">
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
              <div className={`divide-y ${FC.hair}`}>
                {shownConvs.map((c) => {
                  const assignedM = members.find((x) => x.id === c.assigned_member_id);
                  const name = c.contact_name || fmtPhone(c.external_id);
                  const dot = c.status === "active" ? "bg-[#0a8f5a]" : c.status === "handed_off" ? "bg-[#003083] dark:bg-[#5b9bff]" : "bg-[#262626]/30 dark:bg-white/30";
                  const selected = c.id === openId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => openConversation(c)}
                      className={`group w-full text-left px-3 py-3 flex items-start gap-3 transition-colors ${
                        selected ? "bg-[#003083]/[0.06] dark:bg-[#5b9bff]/[0.10]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      {/* avatar + dot */}
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                          {(name || "?").trim().charAt(0).toUpperCase()}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#0c0e12] ${dot}`}
                          title={STATUS_META[c.status]?.label || ""}
                        />
                      </div>
                      {/* corpo */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{name}</span>
                          <span className={`ml-auto shrink-0 text-[11px] ${FC.sub} tabular-nums`}>{fmtDate(c.last_message_at)}</span>
                        </div>
                        <p className={`mt-0.5 truncate text-[12.5px] ${FC.sub}`}>
                          {c.last_preview || <span className="italic text-[#262626]/30 dark:text-white/30">Sem prévia</span>}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.status !== "active" && <StatusBadge status={c.status} />}
                          {assignedM && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#262626]/[0.05] text-[#262626]/[0.72] dark:bg-white/[0.06] dark:text-[#9aa1ab]">
                              <User className="w-2.5 h-2.5" /> {assignedM.nome}
                            </span>
                          )}
                          {(c.tags || []).slice(0, 2).map((t) => (
                            <span key={t} className="rounded px-1.5 py-0.5 text-[10px] bg-[#003083]/[0.06] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]">
                              #{t}
                            </span>
                          ))}
                          {(c.tags || []).length > 2 && <span className={`text-[10px] ${FC.mut}`}>+{(c.tags || []).length - 2}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ─────────────── PAINEL DIREITO: conversa ─────────────── */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 ${FC.base}`}>
          {!openConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-[#003083]/[0.06] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center mb-3">
                <Inbox className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
              </div>
              <p className={`text-[14px] font-medium ${FC.ink}`}>Selecione uma conversa</p>
              <p className={`text-[13px] ${FC.sub} mt-1 max-w-[280px]`}>
                Escolha um contato na lista à esquerda pra ver as mensagens e responder.
              </p>
            </div>
          ) : (
            <>
              {/* cabeçalho da conversa */}
              <div className={`flex items-center justify-between px-5 py-3.5 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] shrink-0`}>
                <div className="min-w-0 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
                    {(openConv.contact_name || openConv.external_id || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate leading-tight">
                      {openConv.contact_name || fmtPhone(openConv.external_id || "")}
                    </h2>
                    <p className={`text-[12px] ${FC.mut} flex items-center gap-2`}>
                      <span className="capitalize">{openConv.connector_kind || "whatsapp"}</span>
                      <StatusBadge status={openConv.status} />
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => deleteConv(openConv.id)} title="Excluir conversa" className={`${iconBtn} hover:text-[#c0362c] hover:bg-[#c0362c]/[0.06] dark:hover:text-[#ff6b5e] dark:hover:bg-[#ff6b5e]/[0.10]`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setOpenId(null); setOpenConv(null); }} className={iconBtn} title="Fechar">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* barra de ações */}
              {openConv.status !== "closed" && (
                <div className={`flex flex-wrap items-center gap-2 px-5 py-2.5 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] shrink-0`}>
                  {openConv.status === "handed_off" ? (
                    <button onClick={() => changeStatus(openConv.id, "resume")} className={btnPrimary}>
                      <Bot className="w-3.5 h-3.5" /> Devolver para a IA
                    </button>
                  ) : (
                    <button onClick={() => changeStatus(openConv.id, "handoff")} className={btnPrimary}>
                      <Hand className="w-3.5 h-3.5" /> Assumir (pausar IA)
                    </button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => changeStatus(openConv.id, "resolve")}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                  </Button>
                  {openConv.snoozed_until ? (
                    <Button variant="secondary" size="sm" onClick={() => unsnoozeConv(openConv.id)}>
                      💤 Reativar
                    </Button>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => e.target.value && snoozeConv(openConv.id, Number(e.target.value))}
                      className={`h-9 px-2.5 text-[13px] rounded-[10px] border ${FC.hair} ${FC.dim} dark:bg-[#14171c] outline-none`}
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
                      className={`h-9 px-2.5 text-[13px] rounded-[10px] border ${FC.hair} ${FC.dim} dark:bg-[#14171c] outline-none`}
                      title="Aplicar macro"
                    >
                      <option value="">⚡ Macro…</option>
                      {macros.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                  {/* atribuição */}
                  <div className="ml-auto flex items-center gap-2">
                    <span className={`text-[12px] ${FC.sub} shrink-0`}>Atendente</span>
                    <select
                      value={openConv.assigned_member_id ?? ""}
                      onChange={(e) => saveAssign(openConv.id, e.target.value ? Number(e.target.value) : null)}
                      className={`h-9 text-[13px] px-2.5 rounded-[10px] border ${FC.hair} ${FC.ink} dark:bg-[#14171c] outline-none focus:shadow-[0_0_0_2px_#003083] w-44`}
                    >
                      <option value="">— ninguém —</option>
                      {members.filter((m) => m.status === "active").map((m) => (
                        <option key={m.id} value={m.id}>{m.nome} {m.online ? "🟢" : ""}</option>
                      ))}
                    </select>
                    {openConv.csat_state === "done" && openConv.csat_score != null && (
                      <span className="text-[12px] text-amber-600 dark:text-amber-400 font-medium shrink-0">⭐ {openConv.csat_score}/5</span>
                    )}
                  </div>
                </div>
              )}

              {/* etiquetas */}
              <div className={`px-5 py-2.5 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] flex flex-wrap items-center gap-1.5 shrink-0`}>
                {(openConv.tags || []).map((t) => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff] inline-flex items-center gap-1">
                    #{t}
                    <button onClick={() => saveTags(openConv.id, (openConv.tags || []).filter((x) => x !== t))} className="hover:text-[#c0362c] dark:hover:text-[#ff6b5e]">
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
                  className={`text-[12px] px-2 py-0.5 w-24 rounded-full border border-dashed ${FC.hair} bg-transparent ${FC.dim} outline-none focus:border-[#003083] dark:focus:border-[#5b9bff]`}
                />
              </div>

              {/* mensagens (scroll) */}
              <div className="flex-1 overflow-y-auto sidebar-scroll px-5 py-5 space-y-3 min-h-0">
                {loadingMsgs && (
                  <div className="space-y-3">
                    <div className="flex justify-start"><SkeletonBar className="h-9 w-2/5 rounded-2xl" /></div>
                    <div className="flex justify-end"><SkeletonBar className="h-9 w-1/3 rounded-2xl" /></div>
                    <div className="flex justify-start"><SkeletonBar className="h-9 w-1/2 rounded-2xl" /></div>
                  </div>
                )}
                {!loadingMsgs && msgs.length === 0 && (
                  <div className={`text-[12px] ${FC.mut} text-center py-8`}>
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
                        <div className="max-w-[88%] rounded-xl px-3 py-1.5 text-[12px] bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20">
                          📝 <span className="font-medium">Nota interna:</span> {m.content}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}>
                      <div
                        className={`max-w-[78%] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words shadow-[0_1px_1px_rgba(0,0,0,0.04)] ${
                          isUser
                            ? `rounded-2xl rounded-tl-md bg-white dark:bg-[#16191f] border ${FC.hair} ${FC.ink}`
                            : isAgent
                              ? "rounded-2xl rounded-tr-md bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12]"
                              : `rounded-2xl rounded-tr-md bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12] border border-[#003083]/[0.08] dark:border-[#5b9bff]/[0.16] ${FC.ink}`
                        }`}
                      >
                        {m.content ? renderRich(m.content) : <span className="opacity-60 italic">[sem texto]</span>}
                      </div>
                      <span className={`text-[10px] mt-1 px-1 flex items-center gap-1 ${FC.mut}`}>
                        {isAgent ? (
                          <><User className="w-2.5 h-2.5" /> Você</>
                        ) : isUser ? null : (
                          <><Bot className="w-2.5 h-2.5" /> IA</>
                        )}
                        {fmtTime(m.created_at) && <span>{isUser ? "" : "· "}{fmtTime(m.created_at)}</span>}
                      </span>
                    </div>
                  );
                })}
                <div ref={msgsEndRef} />
              </div>

              {/* composer */}
              {openConv.status !== "closed" && (
                <div className={`border-t ${FC.hair} px-5 py-3 bg-white dark:bg-[#0c0e12] shrink-0`}>
                  <div className="flex items-center gap-1 mb-2">
                    <button
                      onClick={() => setNoteMode(false)}
                      className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${
                        !noteMode ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff] font-medium" : `${FC.sub} hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`
                      }`}
                    >
                      Responder
                    </button>
                    <button
                      onClick={() => setNoteMode(true)}
                      className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${
                        noteMode ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 font-medium" : `${FC.sub} hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`
                      }`}
                    >
                      📝 Nota interna
                    </button>
                  </div>
                  {noteMode && members.filter((m) => m.status === "active").length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <span className={`text-[11px] ${FC.mut}`}>Marcar:</span>
                      {members.filter((m) => m.status === "active").map((m) => {
                        const on = mentions.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => setMentions((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                              on ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/30" : `${FC.hair} ${FC.sub} ${FC.hover}`
                            }`}
                          >
                            @{m.nome}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* compositor unificado — campo em cima, ferramentas + enviar embutidos
                      embaixo, tudo numa caixa só (estilo ChatGPT/Linear) */}
                  <div
                    className={`rounded-2xl border transition-shadow ${
                      noteMode
                        ? "border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10 focus-within:shadow-[0_0_0_2px_#f59e0b]"
                        : `${FC.hair} bg-white dark:bg-[#14171c] focus-within:shadow-[0_0_0_2px_#003083] dark:focus-within:shadow-[0_0_0_2px_#5b9bff]`
                    }`}
                  >
                    <textarea
                      ref={taRef}
                      value={replyText}
                      onChange={(e) => { setReplyText(e.target.value); autoGrowTextarea(e.target); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      rows={1}
                      placeholder={noteMode ? "Nota visível só pra equipe (não vai pro cliente)…" : "Responder ao cliente… (Enter envia, Shift+Enter quebra linha)"}
                      className="block w-full resize-none overflow-y-auto px-4 pt-3.5 pb-1 text-[13px] leading-relaxed bg-transparent outline-none text-[#262626] dark:text-[#e6e8eb] placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]"
                    />
                    <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
                      <div className="flex items-center gap-0.5">
                        {!noteMode && <CannedPicker onInsert={(c) => setReplyText((prev) => (prev ? prev + "\n" + c : c))} />}
                      </div>
                      <button
                        onClick={sendReply}
                        disabled={sending || !replyText.trim()}
                        className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full text-white transition-all active:scale-[0.92] disabled:opacity-40 disabled:pointer-events-none ${
                          noteMode ? "bg-amber-500 hover:bg-amber-600" : "bg-[#003083] hover:bg-[#002266] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff]"
                        }`}
                        title="Enviar"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className={`text-[11px] ${FC.mut} mt-1.5`}>
                    {noteMode ? "A nota fica registrada na conversa, visível só pra equipe." : "Ao responder, você assume a conversa e a IA fica pausada."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

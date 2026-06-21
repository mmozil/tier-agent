import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  MessageSquare, RefreshCw, X, User, Hand, Bot, CheckCircle2, Trash2, Inbox, ArrowUp,
  AtSign, Users, Clock, Tag, ChevronDown, PanelRightClose, PanelRightOpen, Search, Zap,
  Paperclip, ExternalLink, ArrowUpRight,
} from "lucide-react";

import { api } from "@/lib/api";
import CannedPicker from "@/components/CannedPicker";
import { Button, btnPrimary, iconBtn, EmptyHint, SkeletonBar, FC, Select } from "@/components/ds/fc";

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: "IA ativa", cls: "bg-[#0a8f5a]/[0.12] text-[#0a8f5a]", dot: "bg-[#0a8f5a]" },
  handed_off: { label: "Humano no controle", cls: "bg-[#003083]/[0.10] text-[#003083] dark:bg-[#5b9bff]/[0.16] dark:text-[#8ab4ff]", dot: "bg-[#003083] dark:bg-[#5b9bff]" },
  closed: { label: "Resolvida", cls: "bg-[#262626]/[0.06] text-[#262626]/[0.56] dark:bg-white/[0.06] dark:text-[#8b93a0]", dot: "bg-[#262626]/30 dark:bg-white/30" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

const PRIORITY_META: Record<string, { label: string; tint: string }> = {
  none: { label: "Nenhuma", tint: "#697386" },
  low: { label: "Baixa", tint: "#0a8f5a" },
  medium: { label: "Média", tint: "#003083" },
  high: { label: "Alta", tint: "#9a6700" },
  urgent: { label: "Urgente", tint: "#E5484D" },
};
const PRIORITY_OPTS = (["none", "low", "medium", "high", "urgent"] as const).map((v) => ({ value: v, label: PRIORITY_META[v].label }));

function PriorityBadge({ priority }: { priority: string }) {
  if (!priority || priority === "none") return null;
  const m = PRIORITY_META[priority] || PRIORITY_META.none;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: m.tint + "1F", color: m.tint }}>
      {m.label}
    </span>
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
  priority: string;
  team_id: number | null;
}

interface Team {
  id: number;
  name: string;
}

interface Member {
  id: number;
  nome: string;
  role: string;
  online: boolean;
  status: string;
}

interface Attachment {
  kind: string;
  url: string;
  mime?: string | null;
}

interface Message {
  id: number;
  role: string;
  content: string | null;
  model_used: string | null;
  created_at: string;
  attachments_json?: Attachment[] | null;
}

type NavFilter =
  | { type: "all" }
  | { type: "unattended" }
  | { type: "mentions" }
  | { type: "participants" }
  | { type: "channel"; value: string }
  | { type: "tag"; value: string }
  | { type: "team"; value: number };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    return new Date(norm).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    return new Date(norm).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  } catch {
    return "";
  }
}

function fmtPhone(ext: string): string {
  const d = (ext || "").replace(/\D/g, "");
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4)}`;
  return ext;
}

// Ajusta a altura do textarea ao conteúdo (cresce conforme digita, até 180px).
function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 180)}px`;
}

// Renderiza o markdown do WhatsApp (*negrito* _itálico_ ~tachado~ `mono`).
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

// Cor determinística pra cada etiqueta (igual em todas as sessões, sem backend de cor).
const TAG_DOTS = ["#3b82f6", "#ef4444", "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#6366f1"];
function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_DOTS[h % TAG_DOTS.length];
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", telegram: "Telegram",
  webchat: "Chat online", chat: "Chat online", widget: "Chat online", messenger: "Messenger",
};
function channelLabel(k: string | null): string {
  if (!k) return "Outro";
  return CHANNEL_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1);
}

// ─── Componentes presentacionais (módulo) ───

// Seção colapsável da sub-nav do inbox (Canais / Etiquetas / Times) — estilo Chatwoot:
// header com ícone + chevron, itens aninhados com linha de árvore (border-l 1px).
function SubNavGroup({
  title, icon: Icon, children, defaultOpen = true,
}: { title: string; icon?: ComponentType<{ className?: string }>; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group w-full flex items-center gap-2 h-7 px-2.5 rounded-[8px] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#262626]/45 dark:text-[#565d68] hover:text-[#262626]/70 dark:hover:text-[#9aa1ab] transition-colors"
      >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" />}
        <span className="flex-1 text-left tracking-[0.06em]">{title}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
      </button>
      {/* Spring (framer-motion) — spring canônico do Animate UI (350/35). */}
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 350, damping: 35 }}
        style={{ overflow: "hidden" }}
      >
        <div className="mt-0.5 ml-[15px] pl-1.5 border-l border-[#EDEDED] dark:border-[#23272e] space-y-0.5">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function SubNavItem({
  icon: Icon, label, count, active, onClick, dotColor, soon,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  dotColor?: string;
  soon?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[8px] text-[13px] transition-colors ${
        active
          ? "text-[#003083] dark:text-[#8ab4ff] font-medium"
          : "text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-[#262626] dark:hover:text-white font-[450]"
      }`}
    >
      {/* Bolha deslizante (layoutId compartilhado) — viaja entre os itens da sub-nav. */}
      {active && (
        <motion.span
          layoutId="ta-subnav-active"
          className="absolute inset-0 z-0 rounded-[8px] bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12]"
          transition={{ type: "spring", stiffness: 350, damping: 35 }}
        />
      )}
      {dotColor ? (
        <span className="relative z-10 w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
      ) : Icon ? (
        <Icon className="relative z-10 w-4 h-4 shrink-0 opacity-70 group-hover:opacity-100" />
      ) : null}
      <span className="relative z-10 truncate flex-1 text-left">{label}</span>
      {soon ? (
        <span className="relative z-10 text-[9.5px] uppercase tracking-wide text-[#262626]/35 dark:text-[#6b7280] shrink-0">em breve</span>
      ) : count != null && count > 0 ? (
        <span className="relative z-10 text-[11px] tabular-nums text-[#262626]/[0.5] dark:text-[#8b93a0] shrink-0">{count}</span>
      ) : null}
    </button>
  );
}

function AccordionSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border-b ${FC.hair}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left group">
        <span className="text-[13px] font-medium text-[#262626] dark:text-[#e6e8eb]">{title}</span>
        <ChevronDown className={`w-4 h-4 text-[#262626]/40 dark:text-[#6b7280] transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="px-4 pb-3.5 -mt-0.5">{children}</div>}
    </div>
  );
}

function SoonHint({ text = "Disponível em breve." }: { text?: string }) {
  return <p className="text-[12px] text-[#262626]/40 dark:text-[#6b7280] italic">{text}</p>;
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
  const [tagInput, setTagInput] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [me, setMe] = useState<{ role: string; member_id: number | null } | null>(null);
  const [scope, setScope] = useState<"todas" | "mine" | "unassigned" | "snoozed">("todas");
  const [mentions, setMentions] = useState<number[]>([]);
  const [cleanMenu, setCleanMenu] = useState(false);
  const [navFilter, setNavFilter] = useState<NavFilter>({ type: "all" });
  const [search, setSearch] = useState("");
  const [showContact, setShowContact] = useState(true);

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
    const msg = kind === "all"
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

  async function load(sc = scope, silent = false, view: "mentions" | "participating" | null = viewRef.current) {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, any> = { limit: 200 };
      if (sc !== "todas") params.scope = sc;
      if (view) params.view = view;
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
  const viewRef = useRef<"mentions" | "participating" | null>(null);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  useEffect(() => {
    if (taRef.current) autoGrowTextarea(taRef.current);
  }, [replyText, openId, noteMode]);

  useEffect(() => {
    load();
    api.get<Member[]>("/team/members").then(({ data }) => setMembers(data)).catch(() => {});
    api.get<Team[]>("/team/teams").then(({ data }) => setTeams(data)).catch(() => {});
    api.get<{ role: string; member_id: number | null }>("/team/me").then(({ data }) => setMe(data)).catch(() => {});
    api.get<{ id: number; name: string }[]>("/macros").then(({ data }) => setMacros(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      load(scope, true);
      if (openId) {
        api.get<{ messages: Message[] }>(`/conversations/${openId}`)
          .then(({ data }) => {
            const next = data.messages || [];
            setMsgs((prev) => (next.length > prev.length ? next : prev));
          })
          .catch(() => {});
      }
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, openId]);

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

  async function savePriority(convId: number, priority: string) {
    setOpenConv((prev) => (prev && prev.id === convId ? { ...prev, priority } : prev));
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, priority } : c)));
    try {
      await api.put(`/conversations/${convId}/priority`, { priority });
    } catch {
      toast.error("Erro ao salvar prioridade");
    }
  }

  async function saveTeam(convId: number, teamId: number | null) {
    setOpenConv((prev) => (prev && prev.id === convId ? { ...prev, team_id: teamId } : prev));
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, team_id: teamId } : c)));
    try {
      await api.put(`/conversations/${convId}/team`, { team_id: teamId });
    } catch {
      toast.error("Erro ao atribuir time");
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

  // Troca de folder na sub-nav: define o filtro + o view do backend (menções/participação)
  // e recarrega. Os demais (all/unattended/canal/etiqueta) filtram client-side.
  function selectNav(nav: NavFilter) {
    setNavFilter(nav);
    const v = nav.type === "mentions" ? "mentions" : nav.type === "participants" ? "participating" : null;
    viewRef.current = v;
    load(scope, false, v);
  }

  // ─── Derivados ───
  const allTags = Array.from(new Set(convs.flatMap((c) => c.tags || []))).sort();
  const channels = Array.from(new Set(convs.map((c) => c.connector_kind || "outro")));

  const filteredConvs = convs.filter((c) => {
    if (navFilter.type === "channel" && (c.connector_kind || "outro") !== navFilter.value) return false;
    if (navFilter.type === "tag" && !(c.tags || []).includes(navFilter.value)) return false;
    if (navFilter.type === "team" && c.team_id !== navFilter.value) return false;
    if (navFilter.type === "unattended" && (c.status === "closed" || c.assigned_member_id)) return false;
    // menções/participantes já vêm filtradas do backend (view=…); aqui só a busca
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (c.contact_name || c.external_id || "").toLowerCase();
      const prev = (c.last_preview || "").toLowerCase();
      if (!name.includes(q) && !prev.includes(q)) return false;
    }
    return true;
  });

  const unattendedCount = convs.filter((c) => c.status !== "closed" && !c.assigned_member_id).length;
  const navTitle =
    navFilter.type === "all" ? "Todas as conversas"
    : navFilter.type === "unattended" ? "Não atendidas"
    : navFilter.type === "mentions" ? "Menções"
    : navFilter.type === "participants" ? "Participantes"
    : navFilter.type === "channel" ? channelLabel(navFilter.value === "outro" ? null : navFilter.value)
    : navFilter.type === "team" ? (teams.find((t) => t.id === navFilter.value)?.name || "Time")
    : `#${navFilter.value}`;

  const priorConvs = openConv
    ? convs.filter((c) => c.external_id === openConv.external_id && c.id !== openConv.id).slice(0, 6)
    : [];

  const activeMembers = members.filter((m) => m.status === "active");
  const assignedMember = openConv ? members.find((m) => m.id === openConv.assigned_member_id) : undefined;
  const assignedTeam = openConv?.team_id ? teams.find((t) => t.id === openConv.team_id) : undefined;
  // Anexos: mídia real das mensagens (foto/áudio/doc do WhatsApp, persistida em R2) +
  // links/arquivos compartilhados no corpo das mensagens.
  const label40 = (s: string) => (s.length > 38 ? s.slice(0, 38) + "…" : s);
  const attachments: { url: string; label: string; kind: string }[] = [];
  if (openConv) {
    const seen = new Set<string>();
    for (const m of msgs) {
      for (const a of m.attachments_json || []) {
        if (!a.url || seen.has(a.url)) continue;
        seen.add(a.url);
        const tail = a.url.split("?")[0].split("/").filter(Boolean).pop() || a.kind || "arquivo";
        attachments.push({ url: a.url, kind: a.kind || "file", label: label40(tail) });
      }
      for (const u of (m.content || "").match(/https?:\/\/[^\s)<>"']+/g) || []) {
        if (seen.has(u)) continue;
        seen.add(u);
        const tail = u.split("?")[0].split("/").filter(Boolean).pop() || u.replace(/^https?:\/\//, "");
        attachments.push({ url: u, kind: "link", label: label40(tail) });
      }
    }
  }

  const scopeTabs = [
    { k: "todas", label: "Todos" },
    { k: "unassigned", label: "Não atribuídas" },
    ...(me?.member_id ? [{ k: "mine", label: "Minhas" }] : []),
    { k: "snoozed", label: "Adiadas" },
  ] as { k: "todas" | "mine" | "unassigned" | "snoozed"; label: string }[];

  // Sub-nav (filas/canais/etiquetas/times). Em modo STANDALONE vai pro sidebar
  // principal (via portal pro slot #ta-conversas-subnav) — libera espaço no inbox.
  // Em modo EMBED (?embed=1, ex: inbox dentro do Tier Empresas), o sidebar do Agent
  // é escondido → renderizamos a sub-nav como COLUNA aqui dentro (senão ela some).
  const embed = new URLSearchParams(window.location.search).get("embed") === "1";
  const [subNavSlot, setSubNavSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!embed) setSubNavSlot(document.getElementById("ta-conversas-subnav"));
  }, [embed]);
  const subNav = (
    <div className="space-y-0.5">
      <SubNavItem icon={Inbox} label="Todas as conversas" count={convs.length} active={navFilter.type === "all"} onClick={() => selectNav({ type: "all" })} />
      <SubNavItem icon={Clock} label="Não atendidas" count={unattendedCount} active={navFilter.type === "unattended"} onClick={() => selectNav({ type: "unattended" })} />
      <SubNavItem icon={AtSign} label="Menções" active={navFilter.type === "mentions"} onClick={() => selectNav({ type: "mentions" })} />
      <SubNavItem icon={Users} label="Participantes" active={navFilter.type === "participants"} onClick={() => selectNav({ type: "participants" })} />
      {channels.length > 0 && (
        <SubNavGroup title="Canais" icon={MessageSquare}>
          {channels.map((ch) => (
            <SubNavItem
              key={ch}
              icon={MessageSquare}
              label={channelLabel(ch === "outro" ? null : ch)}
              count={convs.filter((c) => (c.connector_kind || "outro") === ch).length}
              active={navFilter.type === "channel" && navFilter.value === ch}
              onClick={() => selectNav({ type: "channel", value: ch })}
            />
          ))}
        </SubNavGroup>
      )}
      {allTags.length > 0 && (
        <SubNavGroup title="Etiquetas" icon={Tag}>
          {allTags.map((t) => (
            <SubNavItem
              key={t}
              label={t}
              dotColor={tagColor(t)}
              count={convs.filter((c) => (c.tags || []).includes(t)).length}
              active={navFilter.type === "tag" && navFilter.value === t}
              onClick={() => selectNav({ type: "tag", value: t })}
            />
          ))}
        </SubNavGroup>
      )}
      {teams.length > 0 && (
        <SubNavGroup title="Times" icon={Users}>
          {teams.map((tm) => (
            <SubNavItem
              key={tm.id}
              icon={Users}
              label={tm.name}
              count={convs.filter((c) => c.team_id === tm.id).length}
              active={navFilter.type === "team" && navFilter.value === tm.id}
              onClick={() => selectNav({ type: "team", value: tm.id })}
            />
          ))}
        </SubNavGroup>
      )}
    </div>
  );

  return (
    <>
      {!embed && subNavSlot && createPortal(subNav, subNavSlot)}
      <div className="-mx-8 -mb-8 h-[calc(100vh-60px)] flex bg-white dark:bg-[#0c0e12] border-t border-[#EDEDED] dark:border-[#23272e]">
      {/* ═══════════ ZONA 1 — sub-nav (só no modo embed; standalone usa o sidebar) ═══════════ */}
      {embed && (
        <aside className={`w-[208px] shrink-0 border-r ${FC.hair} flex flex-col min-h-0 ${FC.base}`}>
          <div className={`h-14 shrink-0 flex items-center px-4 border-b ${FC.hair}`}>
            <h1 className="text-[15px] font-[550] text-[#262626] dark:text-[#e6e8eb]">Conversas</h1>
          </div>
          <nav className="flex-1 overflow-y-auto sidebar-scroll px-2 py-3 min-h-0">{subNav}</nav>
        </aside>
      )}
      {/* ═══════════ ZONA 2 — lista ═══════════ */}
      <section className={`w-[340px] shrink-0 border-r ${FC.hair} flex flex-col min-h-0 bg-white dark:bg-[#0c0e12]`}>
        <div className={`shrink-0 px-4 pt-3.5 pb-2.5 border-b ${FC.hair}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{navTitle}</h2>
            <div className="flex items-center gap-0.5 shrink-0">
              <div className="relative">
                <button onClick={() => setCleanMenu((v) => !v)} className={iconBtn} title="Limpar">
                  <Trash2 className="w-4 h-4" />
                </button>
                {cleanMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setCleanMenu(false)} />
                    <div className={`absolute right-0 mt-1 z-20 w-60 bg-white dark:bg-[#16191f] border ${FC.hair} rounded-xl shadow-lg py-1 overflow-hidden`}>
                      <button onClick={() => bulkDelete("closed")} className="w-full text-left px-3 py-2 text-[13px] text-[#262626] dark:text-[#e6e8eb] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]">
                        Excluir resolvidas
                        <span className="block text-[11px] text-[#262626]/[0.5] dark:text-[#8b93a0]">Remove as conversas já encerradas</span>
                      </button>
                      <button onClick={() => bulkDelete("all")} className="w-full text-left px-3 py-2 text-[13px] text-[#c0362c] dark:text-[#ff6b5e] hover:bg-[#c0362c]/[0.06] dark:hover:bg-[#ff6b5e]/[0.10]">
                        Excluir todas
                        <span className="block text-[11px] text-[#c0362c]/60 dark:text-[#ff6b5e]/60">Apaga todas as conversas do agente</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => load()} className={iconBtn} title="Atualizar">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* busca */}
          <div className="relative mt-2.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#262626]/40 dark:text-[#6b7280] pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar conversas…"
              className={`w-full h-8 pl-8 pr-3 text-[13px] rounded-[8px] bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626] dark:text-slate-200 placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] outline-none focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] transition-shadow`}
            />
          </div>
          {/* abas de fila */}
          <div className="flex items-center gap-0.5 mt-2 overflow-x-auto sidebar-scroll">
            {scopeTabs.map((t) => (
              <button
                key={t.k}
                onClick={() => { setScope(t.k); load(t.k); }}
                className={`shrink-0 px-2 py-1 text-[12.5px] rounded-[7px] transition-colors ${
                  scope === t.k
                    ? "bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] text-[#003083] dark:text-[#8ab4ff] font-medium"
                    : "text-[#262626]/[0.56] dark:text-[#8b93a0] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
          {loading && (
            <div className={`divide-y ${FC.hair}`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-3 py-3 flex items-center gap-3">
                  <SkeletonBar className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2"><SkeletonBar className="h-3 w-28" /><SkeletonBar className="h-2.5 w-10 ml-auto" /></div>
                    <SkeletonBar className="h-2.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && filteredConvs.length === 0 && (
            <div className="py-14 px-5">
              {search.trim() ? (
                <EmptyHint icon={Search} text={`Nenhuma conversa encontrada para "${search}".`} />
              ) : navFilter.type === "mentions" ? (
                <EmptyHint icon={AtSign} text="Nenhuma menção — quando alguém te marcar numa nota interna (@você), a conversa aparece aqui." />
              ) : navFilter.type === "participants" ? (
                <EmptyHint icon={Users} text="Você ainda não participa de nenhuma conversa (atribuída a você ou onde foi marcado)." />
              ) : navFilter.type === "tag" ? (
                <EmptyHint icon={Tag} text={`Nenhuma conversa com #${navFilter.value}.`} />
              ) : (
                <EmptyHint icon={MessageSquare} text="Nenhuma conversa aqui — elas aparecem quando clientes falarem com o agente." ctaLabel="Conectar canal" ctaTo="/admin/canais" />
              )}
            </div>
          )}

          {!loading && filteredConvs.length > 0 && (
            <div className={`divide-y ${FC.hair}`}>
              {filteredConvs.map((c) => {
                const name = c.contact_name || fmtPhone(c.external_id);
                const selected = c.id === openId;
                const dot = STATUS_META[c.status]?.dot || STATUS_META.active.dot;
                return (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c)}
                    className={`group w-full text-left px-3 py-3 flex items-start gap-3 transition-colors ${
                      selected ? "bg-[#003083]/[0.06] dark:bg-[#5b9bff]/[0.10]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                        {(name || "?").trim().charAt(0).toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#0c0e12] ${dot}`} title={STATUS_META[c.status]?.label || ""} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{name}</span>
                        <span className={`ml-auto shrink-0 text-[11px] ${FC.sub} tabular-nums`}>{fmtDate(c.last_message_at)}</span>
                      </div>
                      <p className={`mt-0.5 truncate text-[12.5px] ${FC.sub}`}>
                        {c.last_preview || <span className="italic text-[#262626]/30 dark:text-white/30">Sem prévia</span>}
                      </p>
                      {((c.tags || []).length > 0 || c.assigned_member_id) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.assigned_member_id && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#262626]/[0.05] text-[#262626]/[0.72] dark:bg-white/[0.06] dark:text-[#9aa1ab]">
                              <User className="w-2.5 h-2.5" /> {members.find((m) => m.id === c.assigned_member_id)?.nome || "Atribuída"}
                            </span>
                          )}
                          {(c.tags || []).slice(0, 2).map((t) => (
                            <span key={t} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-black/[0.04] dark:bg-white/[0.06] text-[#262626]/[0.72] dark:text-[#9aa1ab]">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tagColor(t) }} />{t}
                            </span>
                          ))}
                          {(c.tags || []).length > 2 && <span className={`text-[10px] ${FC.mut}`}>+{(c.tags || []).length - 2}</span>}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════ ZONA 3 — chat ═══════════ */}
      <section className={`flex-1 flex flex-col min-w-0 min-h-0 ${FC.base}`}>
        {!openConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-[#003083]/[0.06] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center mb-3">
              <Inbox className="w-6 h-6 text-[#003083] dark:text-[#5b9bff]" />
            </div>
            <p className={`text-[14px] font-medium ${FC.ink}`}>Selecione uma conversa</p>
            <p className={`text-[13px] ${FC.sub} mt-1 max-w-[280px]`}>Escolha um contato na lista pra ver as mensagens e responder.</p>
          </div>
        ) : (
          <>
            <div className={`flex items-center justify-between px-5 py-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] shrink-0`}>
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
                  {(openConv.contact_name || openConv.external_id || "?").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate leading-tight">
                    {openConv.contact_name || fmtPhone(openConv.external_id || "")}
                  </h2>
                  <p className={`text-[12px] ${FC.mut} flex items-center gap-2`}>
                    <span>{channelLabel(openConv.connector_kind)}</span>
                    <StatusBadge status={openConv.status} />
                    <PriorityBadge priority={openConv.priority} />
                    {assignedTeam && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.07] text-[#262626]/[0.7] dark:text-[#cdd2da]">
                        <Users className="w-2.5 h-2.5" /> {assignedTeam.name}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {openConv.status !== "closed" && (
                  <Button variant="secondary" size="sm" onClick={() => changeStatus(openConv.id, "resolve")}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                  </Button>
                )}
                <button onClick={() => deleteConv(openConv.id)} title="Excluir conversa" className={`${iconBtn} hover:text-[#c0362c] hover:bg-[#c0362c]/[0.06] dark:hover:text-[#ff6b5e] dark:hover:bg-[#ff6b5e]/[0.10]`}>
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={() => setShowContact((v) => !v)} title={showContact ? "Ocultar contato" : "Mostrar contato"} className={iconBtn}>
                  {showContact ? <PanelRightClose className="w-[18px] h-[18px]" /> : <PanelRightOpen className="w-[18px] h-[18px]" />}
                </button>
              </div>
            </div>

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
                {openConv.snoozed_until ? (
                  <Button variant="secondary" size="sm" onClick={() => unsnoozeConv(openConv.id)}>💤 Reativar</Button>
                ) : (
                  <select value="" onChange={(e) => e.target.value && snoozeConv(openConv.id, Number(e.target.value))} className={`h-9 px-2.5 text-[13px] rounded-[10px] border ${FC.hair} ${FC.dim} dark:bg-[#14171c] outline-none`}>
                    <option value="">💤 Adiar…</option>
                    <option value="60">1 hora</option>
                    <option value="240">4 horas</option>
                    <option value="1440">Amanhã (24h)</option>
                  </select>
                )}
                {macros.length > 0 && (
                  <select value="" onChange={(e) => e.target.value && applyMacro(Number(e.target.value))} className={`h-9 px-2.5 text-[13px] rounded-[10px] border ${FC.hair} ${FC.dim} dark:bg-[#14171c] outline-none`} title="Aplicar macro">
                    <option value="">⚡ Macro…</option>
                    {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                {openConv.status === "handed_off" && <span className="text-[11px] text-[#003083] dark:text-[#8ab4ff] ml-auto">IA pausada — você está no controle</span>}
              </div>
            )}

            <div className="flex-1 overflow-y-auto sidebar-scroll px-5 py-5 space-y-3 min-h-0">
              {loadingMsgs && (
                <div className="space-y-3">
                  <div className="flex justify-start"><SkeletonBar className="h-9 w-2/5 rounded-2xl" /></div>
                  <div className="flex justify-end"><SkeletonBar className="h-9 w-1/3 rounded-2xl" /></div>
                  <div className="flex justify-start"><SkeletonBar className="h-9 w-1/2 rounded-2xl" /></div>
                </div>
              )}
              {!loadingMsgs && msgs.length === 0 && (
                <div className={`text-[12px] ${FC.mut} text-center py-8`}>Sem histórico de texto (mensagens antigas não foram gravadas; novas aparecem aqui).</div>
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
                      {(() => {
                        const media = m.attachments_json || [];
                        const placeholder = !!m.content && /^\[(image|audio|video|document|sticker|file)\]$/i.test(m.content.trim());
                        const showText = m.content && !(placeholder && media.length > 0);
                        return (
                          <>
                            {media.map((a, i) =>
                              a.kind === "image" ? (
                                <img key={i} src={a.url} alt="" loading="lazy" onClick={() => window.open(a.url, "_blank")} className="rounded-lg max-w-full max-h-60 object-cover mb-1 cursor-pointer" />
                              ) : a.kind === "audio" ? (
                                <audio key={i} controls src={a.url} className="max-w-full mb-1" />
                              ) : (
                                <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline text-[12.5px] mb-1">
                                  <Paperclip className="w-3.5 h-3.5 shrink-0" /> {a.kind === "video" ? "Vídeo" : "Documento"}
                                </a>
                              ),
                            )}
                            {showText ? renderRich(m.content!) : !m.content && media.length === 0 ? <span className="opacity-60 italic">[sem texto]</span> : null}
                          </>
                        );
                      })()}
                    </div>
                    <span className={`text-[10px] mt-1 px-1 flex items-center gap-1 ${FC.mut}`}>
                      {isAgent ? <><User className="w-2.5 h-2.5" /> Você</> : isUser ? null : <><Bot className="w-2.5 h-2.5" /> IA</>}
                      {fmtTime(m.created_at) && <span>{isUser ? "" : "· "}{fmtTime(m.created_at)}</span>}
                    </span>
                  </div>
                );
              })}
              <div ref={msgsEndRef} />
            </div>

            {openConv.status !== "closed" && (
              <div className={`border-t ${FC.hair} px-5 py-3 bg-white dark:bg-[#0c0e12] shrink-0`}>
                <div className="flex items-center gap-1 mb-2">
                  <button onClick={() => setNoteMode(false)} className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${!noteMode ? "bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff] font-medium" : `${FC.sub} hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`}`}>Responder</button>
                  <button onClick={() => setNoteMode(true)} className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${noteMode ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 font-medium" : `${FC.sub} hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`}`}>📝 Nota interna</button>
                </div>
                {noteMode && members.filter((m) => m.status === "active").length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mb-2">
                    <span className={`text-[11px] ${FC.mut}`}>Marcar:</span>
                    {members.filter((m) => m.status === "active").map((m) => {
                      const on = mentions.includes(m.id);
                      return (
                        <button key={m.id} onClick={() => setMentions((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))} className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${on ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/30" : `${FC.hair} ${FC.sub} ${FC.hover}`}`}>@{m.nome}</button>
                      );
                    })}
                  </div>
                )}
                <div className={`rounded-2xl border transition-shadow ${noteMode ? "border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10 focus-within:shadow-[0_0_0_2px_#f59e0b]" : `${FC.hair} bg-white dark:bg-[#14171c] focus-within:shadow-[0_0_0_2px_#003083] dark:focus-within:shadow-[0_0_0_2px_#5b9bff]`}`}>
                  <textarea
                    ref={taRef}
                    value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); autoGrowTextarea(e.target); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                    rows={1}
                    placeholder={noteMode ? "Nota visível só pra equipe (não vai pro cliente)…" : "Responder ao cliente… (Enter envia, Shift+Enter quebra linha)"}
                    className="block w-full resize-none overflow-y-auto px-4 pt-3.5 pb-1 text-[13px] leading-relaxed bg-transparent outline-none text-[#262626] dark:text-[#e6e8eb] placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]"
                  />
                  <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
                    <div className="flex items-center gap-0.5">{!noteMode && <CannedPicker onInsert={(c) => setReplyText((prev) => (prev ? prev + "\n" + c : c))} />}</div>
                    <button onClick={sendReply} disabled={sending || !replyText.trim()} className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full text-white transition-all active:scale-[0.92] disabled:opacity-40 disabled:pointer-events-none ${noteMode ? "bg-amber-500 hover:bg-amber-600" : "bg-[#003083] hover:bg-[#002266] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff]"}`} title="Enviar">
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className={`text-[11px] ${FC.mut} mt-1.5`}>{noteMode ? "A nota fica registrada na conversa, visível só pra equipe." : "Ao responder, você assume a conversa e a IA fica pausada."}</p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ═══════════ ZONA 4 — contato / ações ═══════════ */}
      {openConv && showContact && (
        <aside className={`w-[384px] shrink-0 border-l ${FC.hair} flex flex-col min-h-0 bg-white dark:bg-[#0c0e12]`}>
          <div className={`h-14 shrink-0 flex items-center justify-between px-4 border-b ${FC.hair}`}>
            <h3 className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb]">Contato</h3>
            <button onClick={() => setShowContact(false)} className={iconBtn} title="Fechar"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
            {/* cartão do contato */}
            <div className={`px-4 py-5 flex flex-col items-center text-center border-b ${FC.hair}`}>
              <div className="w-14 h-14 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[20px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                {(openConv.contact_name || openConv.external_id || "?").trim().charAt(0).toUpperCase()}
              </div>
              <p className="mt-2.5 text-[15px] font-medium text-[#262626] dark:text-[#e6e8eb]">{openConv.contact_name || fmtPhone(openConv.external_id || "")}</p>
              <p className={`text-[12.5px] ${FC.sub} mt-0.5`}>{fmtPhone(openConv.external_id || "")}</p>
              <div className="mt-2"><StatusBadge status={openConv.status} /></div>
            </div>

            <AccordionSection title="Ações da conversa">
              <div className="space-y-3">
                <div>
                  <label className={`block text-[12px] ${FC.sub} mb-1`}>Agente atribuído</label>
                  {activeMembers.length > 0 ? (
                    <Select
                      value={openConv.assigned_member_id ?? 0}
                      onChange={(v) => saveAssign(openConv.id, v === 0 ? null : (v as number))}
                      placeholder="— ninguém —"
                      options={[
                        { value: 0, label: "— ninguém —" },
                        ...activeMembers.map((m) => ({ value: m.id, label: `${m.nome}${m.online ? " 🟢" : ""}` })),
                      ]}
                    />
                  ) : (
                    <a
                      href="/admin/equipe"
                      className={`flex items-center justify-between gap-2 h-8 px-2.5 rounded-[8px] border border-dashed ${FC.hair} text-[12px] ${FC.sub} hover:border-[#003083] dark:hover:border-[#5b9bff] hover:text-[#003083] dark:hover:text-[#5b9bff] transition-colors`}
                    >
                      Adicione atendentes em Equipe <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  )}
                </div>
                <div>
                  <label className={`block text-[12px] ${FC.sub} mb-1`}>Time atribuído</label>
                  {teams.length > 0 ? (
                    <Select
                      value={openConv.team_id ?? 0}
                      onChange={(v) => saveTeam(openConv.id, v === 0 ? null : (v as number))}
                      placeholder="— nenhum —"
                      options={[{ value: 0, label: "— nenhum —" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                    />
                  ) : (
                    <a
                      href="/admin/equipe"
                      className={`flex items-center justify-between gap-2 h-8 px-2.5 rounded-[8px] border border-dashed ${FC.hair} text-[12px] ${FC.sub} hover:border-[#003083] dark:hover:border-[#5b9bff] hover:text-[#003083] dark:hover:text-[#5b9bff] transition-colors`}
                    >
                      Crie times em Equipe <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  )}
                </div>
                <div>
                  <label className={`block text-[12px] ${FC.sub} mb-1`}>Prioridade</label>
                  <Select
                    value={openConv.priority || "none"}
                    onChange={(v) => savePriority(openConv.id, v as string)}
                    options={PRIORITY_OPTS}
                  />
                </div>
              </div>
            </AccordionSection>

            <AccordionSection title="Etiquetas da conversa">
              <div className="flex flex-wrap items-center gap-1.5">
                {(openConv.tags || []).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-[11px] pl-1.5 pr-1 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[#262626]/[0.78] dark:text-[#cdd2da]">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: tagColor(t) }} />{t}
                    <button onClick={() => saveTags(openConv.id, (openConv.tags || []).filter((x) => x !== t))} className="hover:text-[#c0362c] dark:hover:text-[#ff6b5e]"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { e.preventDefault(); saveTags(openConv.id, [...(openConv.tags || []), tagInput]); setTagInput(""); } }}
                  placeholder="+ etiqueta"
                  className={`text-[12px] px-2 py-0.5 w-20 rounded-full border border-dashed ${FC.hair} bg-transparent ${FC.dim} outline-none focus:border-[#003083] dark:focus:border-[#5b9bff]`}
                />
              </div>
            </AccordionSection>

            <AccordionSection title="Macros" defaultOpen={false}>
              {macros.length > 0 ? (
                <div className="space-y-1">
                  {macros.map((m) => (
                    <button key={m.id} onClick={() => applyMacro(m.id)} className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-[8px] text-[13px] ${FC.dim} hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-[#262626] dark:hover:text-white transition-colors`}>
                      <Zap className="w-3.5 h-3.5 shrink-0 opacity-70" /> <span className="truncate">{m.name}</span>
                    </button>
                  ))}
                </div>
              ) : <SoonHint text="Nenhuma macro criada ainda." />}
            </AccordionSection>

            <AccordionSection title="Informação da conversa" defaultOpen={false}>
              <dl className="space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between"><dt className={FC.sub}>Status</dt><dd><StatusBadge status={openConv.status} /></dd></div>
                <div className="flex items-center justify-between"><dt className={FC.sub}>Mensagens</dt><dd className="tabular-nums text-[#262626] dark:text-[#e6e8eb] font-medium">{openConv.msg_count}</dd></div>
                <div className="flex items-center justify-between"><dt className={FC.sub}>Última mensagem</dt><dd className="tabular-nums text-[#262626] dark:text-[#e6e8eb]">{fmtDate(openConv.last_message_at)}</dd></div>
                <div className="flex items-center justify-between"><dt className={FC.sub}>Canal</dt><dd className="text-[#262626] dark:text-[#e6e8eb]">{channelLabel(openConv.connector_kind)}</dd></div>
                {openConv.csat_state === "done" && openConv.csat_score != null && (
                  <div className="flex items-center justify-between"><dt className={FC.sub}>CSAT</dt><dd className="text-amber-600 dark:text-amber-400 font-medium">⭐ {openConv.csat_score}/5</dd></div>
                )}
              </dl>
            </AccordionSection>

            <AccordionSection title={`Conversas anteriores${priorConvs.length ? ` (${priorConvs.length})` : ""}`} defaultOpen={false}>
              {priorConvs.length > 0 ? (
                <div className="space-y-0.5">
                  {priorConvs.map((c) => (
                    <button key={c.id} onClick={() => openConversation(c)} className="w-full text-left px-2 py-1.5 rounded-[8px] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] text-[#262626] dark:text-[#e6e8eb] truncate">{c.last_preview || "Conversa"}</span>
                        <span className={`text-[10.5px] ${FC.mut} tabular-nums shrink-0`}>{fmtDate(c.last_message_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : <SoonHint text="Nenhuma conversa anterior deste contato." />}
            </AccordionSection>

            <AccordionSection title="Atributos do contato" defaultOpen={false}>
              <dl className="space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-3"><dt className={FC.sub}>Nome</dt><dd className="text-[#262626] dark:text-[#e6e8eb] truncate">{openConv.contact_name || "—"}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className={FC.sub}>Telefone</dt><dd className="tabular-nums text-[#262626] dark:text-[#e6e8eb]">{fmtPhone(openConv.external_id || "")}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className={FC.sub}>Canal</dt><dd className="text-[#262626] dark:text-[#e6e8eb]">{channelLabel(openConv.connector_kind)}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className={FC.sub}>ID externo</dt><dd className="font-mono text-[11px] text-[#262626]/70 dark:text-[#9aa1ab] truncate max-w-[150px]" title={openConv.external_id || ""}>{openConv.external_id || "—"}</dd></div>
              </dl>
            </AccordionSection>
            <AccordionSection title="Notas do contato" defaultOpen={false}><SoonHint text="Notas internas aparecem no histórico do chat (modo Nota interna)." /></AccordionSection>
            <AccordionSection title={`Anexos${attachments.length ? ` (${attachments.length})` : ""}`} defaultOpen={false}>
              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.some((a) => a.kind === "image") && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {attachments.filter((a) => a.kind === "image").map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.label} className={`block aspect-square rounded-[8px] overflow-hidden border ${FC.hair} bg-black/[0.03] dark:bg-white/[0.05]`}>
                          <img src={a.url} alt={a.label} loading="lazy" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {attachments.filter((a) => a.kind !== "image").map((a, i) => (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      title={a.url}
                      className={`flex items-center gap-2 px-2 h-8 rounded-[8px] text-[12.5px] ${FC.dim} hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-[#262626] dark:hover:text-white transition-colors`}
                    >
                      <Paperclip className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="truncate flex-1">{a.label}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                    </a>
                  ))}
                </div>
              ) : (
                <SoonHint text="Sem anexos nesta conversa. Fotos, documentos e links compartilhados no chat aparecem aqui." />
              )}
            </AccordionSection>
            <AccordionSection title="Participantes da conversa" defaultOpen={false}>
              {assignedMember && (
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[11px] font-semibold text-[#003083] dark:text-[#5b9bff]">
                    {assignedMember.nome.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] text-[#262626] dark:text-[#e6e8eb] truncate">{assignedMember.nome}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] ${FC.sub} shrink-0`}>Atribuído</span>
                </div>
              )}
              <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
                Mencione um colega com <b className={FC.ink}>@nome</b> numa <b className={FC.ink}>Nota interna</b> pra adicioná-lo: ele recebe a notificação e a conversa aparece em <b className={FC.ink}>Menções</b>.
              </p>
            </AccordionSection>
          </div>
        </aside>
      )}
      </div>
    </>
  );
}

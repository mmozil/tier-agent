import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  type LucideIcon,
  Inbox,
  MessageCircle,
  Check,
  CheckCheck,
  Archive,
  RefreshCw,
  Bell,
  Save,
  UserRound,
  Sparkles,
  Hand,
  Clock,
  AtSign,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { WhatsAppIcon } from "@/components/icons/channelIcons";
import { FC, PageFrame, PageHero, Row, Button, EmptyHint, SkeletonBar, iconBtn } from "@/components/ds/fc";

const REASON_LABEL: Record<string, string> = {
  explicit_request: "Pediu humano",
  frustration: "Insatisfeito",
  repeated_loop: "Conversa travada",
  manual: "Assumido",
};

interface AlertCfg {
  alert_whatsapp: string | null;
  alert_email: string | null;
  alert_enabled: boolean;
  sla_minutes: number;
  bh_enabled: boolean;
  bh_days: string;
  bh_start: string;
  bh_end: string;
  bh_message: string;
}

const DAYS = [
  { n: "1", l: "Seg" }, { n: "2", l: "Ter" }, { n: "3", l: "Qua" }, { n: "4", l: "Qui" },
  { n: "5", l: "Sex" }, { n: "6", l: "Sáb" }, { n: "7", l: "Dom" },
];

const inputCls = `w-full h-8 px-3 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;

function AlertConfigCard() {
  const [cfg, setCfg] = useState<AlertCfg>({
    alert_whatsapp: "", alert_email: "", alert_enabled: true, sla_minutes: 0,
    bh_enabled: false, bh_days: "1,2,3,4,5", bh_start: "09:00", bh_end: "18:00", bh_message: "",
  });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get<AlertCfg>("/notifications/alert-config")
      .then(({ data }) => setCfg({
        alert_whatsapp: data.alert_whatsapp || "", alert_email: data.alert_email || "", alert_enabled: data.alert_enabled,
        sla_minutes: data.sla_minutes || 0, bh_enabled: data.bh_enabled || false, bh_days: data.bh_days || "1,2,3,4,5",
        bh_start: data.bh_start || "09:00", bh_end: data.bh_end || "18:00", bh_message: data.bh_message || "",
      }))
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put("/notifications/alert-config", cfg);
      toast.success("Alertas salvos");
      setOpen(false);
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const canal = cfg.alert_whatsapp || cfg.alert_email;
  return (
    <div className="p-6">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#003083]/[0.07] text-[#003083] dark:bg-[#5b9bff]/[0.12] dark:text-[#5b9bff]">
          <Bell className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className={`block text-[14px] font-medium ${FC.ink}`}>Onde te avisamos</span>
          <span className={`block text-[12px] truncate ${FC.sub}`}>
            {canal ? `Avisos extras em ${canal}` : "Nenhum canal extra configurado — só o sininho do painel"}
          </span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-[#003083] dark:text-[#5b9bff] shrink-0">
          {open ? "Fechar" : "Configurar"}
        </span>
      </button>
      {open && (
        <div className={`border-t ${FC.hair} pt-4 mt-4 space-y-3`}>
          <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
            Quando um cliente pede um humano, demonstra insatisfação ou é um lead quente, te avisamos também por estes canais (além do sininho aqui no painel).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-[12px] block mb-1 ${FC.sub}`}>WhatsApp da equipe (com DDI)</label>
              <input value={cfg.alert_whatsapp || ""} onChange={(e) => setCfg({ ...cfg, alert_whatsapp: e.target.value })} placeholder="5511999999999" className={inputCls} />
            </div>
            <div>
              <label className={`text-[12px] block mb-1 ${FC.sub}`}>E-mail da equipe</label>
              <input value={cfg.alert_email || ""} onChange={(e) => setCfg({ ...cfg, alert_email: e.target.value })} placeholder="equipe@empresa.com" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={`text-[12px] block mb-1 ${FC.sub}`}>Alerta de SLA — avisar se cliente espera resposta humana por (minutos)</label>
            <input type="number" min={0} value={cfg.sla_minutes} onChange={(e) => setCfg({ ...cfg, sla_minutes: Math.max(0, parseInt(e.target.value || "0", 10)) })} placeholder="0 = desligado" className={`${inputCls} w-40`} />
            <span className={`text-[12px] ml-2 ${FC.sub}`}>0 = desligado</span>
          </div>
          <label className={`flex items-center gap-2 text-[13px] ${FC.ink}`}>
            <input type="checkbox" checked={cfg.alert_enabled} onChange={(e) => setCfg({ ...cfg, alert_enabled: e.target.checked })} />
            Alertas externos ativados
          </label>

          <div className={`border-t ${FC.hair} pt-3`}>
            <label className={`flex items-center gap-2 text-[13px] mb-2 ${FC.ink}`}>
              <input type="checkbox" checked={cfg.bh_enabled} onChange={(e) => setCfg({ ...cfg, bh_enabled: e.target.checked })} />
              Horário de atendimento humano (fuso BR)
            </label>
            {cfg.bh_enabled && (
              <div className="pl-6 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((d) => {
                    const set = new Set(cfg.bh_days.split(",").filter(Boolean));
                    const on = set.has(d.n);
                    return (
                      <button
                        key={d.n}
                        onClick={() => {
                          on ? set.delete(d.n) : set.add(d.n);
                          const ordered = DAYS.map((x) => x.n).filter((n) => set.has(n));
                          setCfg({ ...cfg, bh_days: ordered.join(",") });
                        }}
                        className={`text-[12px] px-2 py-0.5 rounded-md border ${on ? "bg-[#003083] text-white border-[#003083]" : `${FC.hair} ${FC.sub}`}`}
                      >
                        {d.l}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 text-[13px]">
                  <span className={FC.sub}>das</span>
                  <input type="time" value={cfg.bh_start} onChange={(e) => setCfg({ ...cfg, bh_start: e.target.value })} className={`h-8 px-2 rounded-lg border ${FC.hair} outline-none bg-white dark:bg-[#14171c]`} />
                  <span className={FC.sub}>às</span>
                  <input type="time" value={cfg.bh_end} onChange={(e) => setCfg({ ...cfg, bh_end: e.target.value })} className={`h-8 px-2 rounded-lg border ${FC.hair} outline-none bg-white dark:bg-[#14171c]`} />
                </div>
                <textarea value={cfg.bh_message} onChange={(e) => setCfg({ ...cfg, bh_message: e.target.value })} rows={2} placeholder="Mensagem enviada quando o cliente pede atendente fora do horário (opcional)" className={`w-full px-3 py-2 text-[13px] rounded-lg border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083] resize-none bg-white dark:bg-[#14171c]`} />
              </div>
            )}
          </div>
          <Button variant="primary" onClick={save} disabled={saving}><Save className="w-3.5 h-3.5" /> {saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      )}
    </div>
  );
}

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

const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; tint: string }> = {
  lead: { label: "Lead", icon: Sparkles, tint: "#0a8f5a" },
  handoff: { label: "Atendimento humano", icon: Hand, tint: "#003083" },
  sla: { label: "SLA — cliente esperando", icon: Clock, tint: "#9a6700" },
  mention: { label: "Você foi marcado", icon: AtSign, tint: "#8B5CF6" },
  error: { label: "Erro", icon: AlertTriangle, tint: "#E5484D" },
  info: { label: "Info", icon: Bell, tint: "#697386" },
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "lead", label: "Leads" },
  { key: "handoff", label: "Atendimento humano" },
  { key: "sla", label: "SLA" },
] as const;

function fmtDate(iso: string): string {
  try {
    // Backend manda UTC (às vezes naive) — força UTC + horário de Brasília.
    const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    return new Date(norm).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
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
      const { data } = await api.get<Notification[]>("/notifications", { params: { status: "all", limit: 200 } });
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

  // Avisa o sininho (NotificationBell) pra atualizar o badge NA HORA, sem esperar o poll.
  function notifyBell() {
    window.dispatchEvent(new CustomEvent("notifications:changed"));
  }

  async function markRead(id: number) {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, status: "read" } : n)));
      notifyBell();
    } catch {
      toast.error("Erro ao marcar como lida");
    }
  }

  async function archive(id: number) {
    try {
      await api.patch(`/notifications/${id}/archive`);
      setItems((prev) => prev.filter((n) => n.id !== id));
      notifyBell();
    } catch {
      toast.error("Erro ao arquivar");
    }
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    try {
      await api.post("/notifications/mark-all-read");
      setItems((prev) => prev.map((n) => (n.status === "unread" ? { ...n, status: "read" } : n)));
      notifyBell();
      toast.success("Todas marcadas como lidas");
    } catch {
      toast.error("Erro ao marcar todas como lidas");
    }
  }

  const unreadCount = items.filter((n) => n.status === "unread").length;

  const visible = items.filter((n) => {
    if (n.status === "archived") return false;
    if (filter === "all") return true;
    return n.category === filter;
  });

  const leadCount = items.filter((n) => n.category === "lead" && n.status !== "archived").length;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Leads & Notificações"
          subtitle="Oportunidades capturadas no atendimento e pedidos de transferência para humano — com o contato pronto pra você responder no WhatsApp."
          right={
            <div className="flex items-center gap-2 shrink-0">
              {unreadCount > 0 && (
                <Button variant="ghost" onClick={markAllRead}>
                  <CheckCheck className="w-3.5 h-3.5" /> Marcar todas lidas ({unreadCount})
                </Button>
              )}
              <Button variant="secondary" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
            </div>
          }
        />

        <Row><AlertConfigCard /></Row>

        <Row last>
          {/* Tabs de filtro */}
          <div className={`flex items-center gap-1 px-6 pt-3 border-b ${FC.hair}`}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-2 text-[14px] border-b-2 -mb-px transition-colors ${
                  filter === f.key ? "border-[#003083] dark:border-[#5b9bff] font-medium " + FC.ink : `border-transparent ${FC.sub} hover:text-[#262626] dark:hover:text-white`
                }`}
              >
                {f.label}
                {f.key === "lead" && leadCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center px-1.5 h-4 text-[11px] rounded-full bg-[#0a8f5a]/[0.12] text-[#0a8f5a]">{leadCount}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <LeadsSkeleton />
          ) : visible.length === 0 ? (
            <EmptyHint
              icon={Inbox}
              text="Nenhum item por aqui ainda. Leads aparecem automaticamente quando um cliente demonstra interesse no atendimento."
              ctaLabel="Conectar canal"
              ctaTo="/admin/canais"
              className="py-16"
            />
          ) : (
            <div className={`divide-y ${FC.hair}`}>
              {visible.map((n) => {
                const meta = CATEGORY_META[n.category] || CATEGORY_META.info;
                const tel = n.telefone || n.payload_json?.telefone || n.payload_json?.whatsapp;
                const digits = tel ? String(tel).replace(/\D/g, "") : "";
                const contato = n.contato || n.payload_json?.contato;
                const unread = n.status === "unread";
                const reason = n.payload_json?.reason as string | undefined;
                const resumo = n.payload_json?.resumo as string | undefined;
                const AvatarIcon = contato ? UserRound : meta.icon;
                const headline = contato || n.title;
                return (
                  <div key={n.id} className={`flex items-start gap-3.5 px-6 py-4 transition-colors ${unread ? "bg-[#003083]/[0.02]" : ""} ${FC.hover}`}>
                    {/* Avatar — ícone people quando há contato, senão ícone da categoria */}
                    <span
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: meta.tint + "16", color: meta.tint }}
                    >
                      <AvatarIcon className="w-[18px] h-[18px]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Header: nome/título + badges + data */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[14px] font-medium ${FC.ink}`}>{headline}</span>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: meta.tint + "1F", color: meta.tint }}>
                          {meta.label}
                        </span>
                        {reason && REASON_LABEL[reason] && (
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#262626]/[0.06] dark:bg-white/[0.08] ${FC.sub}`}>{REASON_LABEL[reason]}</span>
                        )}
                        {unread && <span className="w-2 h-2 rounded-full bg-[#003083] dark:bg-[#5b9bff]" title="Não lido" />}
                        <span className={`ml-auto text-[12px] tabular-nums shrink-0 ${FC.sub}`}>{fmtDate(n.created_at)}</span>
                      </div>

                      {/* Subtítulo: o título quando o headline já é o contato */}
                      {contato && n.title && n.title !== contato && (
                        <p className={`text-[13px] mt-0.5 ${FC.sub}`}>{n.title}</p>
                      )}

                      {/* Resumo / corpo */}
                      {resumo ? (
                        <pre className={`text-[12px] mt-2 whitespace-pre-wrap font-sans rounded-lg p-2.5 border ${FC.hair} bg-[#F9F9F9] dark:bg-[#16191f] ${FC.sub}`}>{resumo}</pre>
                      ) : (
                        n.body && <p className={`text-[13px] mt-1 line-clamp-2 ${FC.sub}`}>{n.body}</p>
                      )}

                      {/* Contato: chip WhatsApp (+55 (99) 99999-9999) + ver conversa */}
                      <div className="flex flex-wrap items-center gap-2.5 mt-2.5">
                        {tel && (
                          <a
                            href={`https://wa.me/${digits}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir conversa no WhatsApp"
                            className={`inline-flex items-center gap-1.5 text-[13px] font-medium tabular-nums hover:underline ${FC.ink}`}
                          >
                            <WhatsAppIcon className="w-[18px] h-[18px] shrink-0" /> {formatPhone(tel)}
                          </a>
                        )}
                        {n.conversation_id && (
                          <a href={`/admin/conversas?open=${n.conversation_id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#003083] dark:text-[#5b9bff] hover:underline">
                            <MessageCircle className="w-3.5 h-3.5" /> Ver conversa <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1 shrink-0">
                      {unread && (
                        <button onClick={() => markRead(n.id)} title="Marcar como lida" className={`${iconBtn} hover:!text-[#0a8f5a] hover:!bg-[#0a8f5a]/[0.08]`}>
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => archive(n.id)} title="Arquivar" className={iconBtn}>
                        <Archive className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Row>
      </PageFrame>
    </div>
  );
}

// Carregando, a lista mostra a própria forma (não um spinner no vazio).
function LeadsSkeleton() {
  return (
    <div className={`divide-y ${FC.hair}`}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3.5 px-6 py-4">
          <SkeletonBar className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <SkeletonBar className="h-3.5 w-28" />
              <SkeletonBar className="h-4 w-16 rounded-full" />
              <SkeletonBar className="h-3 w-16 ml-auto" />
            </div>
            <SkeletonBar className="h-3 w-3/4 mb-2" />
            <SkeletonBar className="h-4 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}

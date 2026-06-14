import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, Hand, UserX, RefreshCw, MessageSquare } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, EmptyHint, SkeletonBar } from "@/components/ds/fc";

interface ConvItem {
  conversation_id: number;
  contato: string | null;
  telefone: string | null;
  preview: string | null;
  last_message_at: string | null;
  tags: string[];
}
interface NotifItem {
  notification_id: number;
  category: string;
  conversation_id: number | null;
  contato: string | null;
  telefone: string | null;
  title: string;
  body: string | null;
  created_at: string | null;
}
interface AttentionData {
  counts: { aguardando: number; nao_atribuidas: number; alertas: number; total: number };
  aguardando: ConvItem[];
  nao_atribuidas: ConvItem[];
  alertas: NotifItem[];
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const CAT_LABEL: Record<string, string> = {
  lead: "Lead novo",
  handoff: "Pediu humano",
  sla: "SLA",
  mention: "Menção",
  error: "Erro",
};
const CAT_COLOR: Record<string, string> = {
  lead: "text-[#0a8f5a] bg-[#0a8f5a]/[0.12]",
  handoff: "text-[#003083] bg-[#003083]/[0.10] dark:text-[#5b9bff] dark:bg-[#5b9bff]/[0.14]",
  sla: "text-[#dc6803] bg-[#dc6803]/[0.12]",
  mention: "text-[#8b5cf6] bg-[#8b5cf6]/[0.12]",
  error: "text-[#E5484D] bg-[#E5484D]/[0.10]",
};

export default function AtencaoPage() {
  const [data, setData] = useState<AttentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  async function load() {
    try {
      const { data } = await api.get<AttentionData>("/attention");
      setData(data);
    } catch {
      /* silencioso — refresh tenta de novo */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const c = data?.counts || { aguardando: 0, nao_atribuidas: 0, alertas: 0, total: 0 };
  const open = (id: number | null) => id && nav(`/admin/conversas?open=${id}`);

  const Avatar = ({ name }: { name: string | null }) => (
    <div className="w-8 h-8 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[12px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );

  const SectionHead = ({ icon: Icon, title, count, tone }: { icon: any; title: string; count: number; tone: string }) => (
    <div className={`flex items-center gap-2 px-6 py-3 border-b ${FC.hair}`}>
      <Icon className={`w-4 h-4 ${tone}`} />
      <span className={`text-[13px] font-medium ${FC.ink}`}>{title}</span>
      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${count > 0 ? "bg-[#E5484D]/[0.12] text-[#E5484D]" : "bg-black/[0.04] dark:bg-white/[0.06] " + FC.mut}`}>
        {count}
      </span>
    </div>
  );

  // skeleton: durante o carregamento inicial, ecoa as linhas (avatar + 2 textos), não vazio mudo
  const ListSkeleton = () => (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-3">
          <SkeletonBar className="h-8 w-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <SkeletonBar className="h-3.5 w-40" />
            <SkeletonBar className="h-3 w-56" />
          </div>
          <SkeletonBar className="h-3 w-8" />
        </div>
      ))}
    </>
  );

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Precisa de você</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
                Tudo que demanda um humano agora, em um lugar só — conversas aguardando, não atribuídas e leads/alertas.
              </p>
            </div>
            <button onClick={load} className={`p-2 rounded-md ${FC.mut} ${FC.hover}`} title="Atualizar">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </Row>

        {/* Aguardando humano */}
        <Row>
          <SectionHead icon={Hand} title="Aguardando humano" count={c.aguardando} tone="text-[#003083] dark:text-[#5b9bff]" />
          <div className={`divide-y ${FC.hair}`}>
            {loading && !data && <ListSkeleton />}
            {!loading && (data?.aguardando.length ?? 0) === 0 && (
              <EmptyHint icon={Hand} text="Ninguém aguardando — a fila está limpa." />
            )}
            {data?.aguardando.map((it) => (
              <button key={it.conversation_id} onClick={() => open(it.conversation_id)} className={`w-full text-left flex items-center gap-3 px-6 py-3 ${FC.hover}`}>
                <Avatar name={it.contato} />
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] font-medium truncate ${FC.ink}`}>{it.contato || it.telefone}</div>
                  <div className={`text-[12px] truncate ${FC.sub}`}>{it.preview || "—"}</div>
                </div>
                <span className={`text-[11px] tabular-nums ${FC.sub} shrink-0`}>{relTime(it.last_message_at)}</span>
              </button>
            ))}
          </div>
        </Row>

        {/* Não atribuídas */}
        <Row>
          <SectionHead icon={UserX} title="Não atribuídas" count={c.nao_atribuidas} tone="text-[#dc6803]" />
          <div className={`divide-y ${FC.hair}`}>
            {loading && !data && <ListSkeleton />}
            {!loading && (data?.nao_atribuidas.length ?? 0) === 0 && (
              <EmptyHint icon={UserX} text="Todas as conversas já têm um responsável." />
            )}
            {data?.nao_atribuidas.map((it) => (
              <button key={it.conversation_id} onClick={() => open(it.conversation_id)} className={`w-full text-left flex items-center gap-3 px-6 py-3 ${FC.hover}`}>
                <Avatar name={it.contato} />
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] font-medium truncate ${FC.ink}`}>{it.contato || it.telefone}</div>
                  <div className={`text-[12px] truncate ${FC.sub}`}>{it.preview || "—"}</div>
                </div>
                <span className={`text-[11px] tabular-nums ${FC.sub} shrink-0`}>{relTime(it.last_message_at)}</span>
              </button>
            ))}
          </div>
        </Row>

        {/* Leads / alertas */}
        <Row last>
          <SectionHead icon={BellRing} title="Leads e alertas" count={c.alertas} tone="text-[#0a8f5a]" />
          <div className={`divide-y ${FC.hair}`}>
            {loading && !data && <ListSkeleton />}
            {!loading && (data?.alertas.length ?? 0) === 0 && (
              <EmptyHint icon={BellRing} text="Sem leads ou alertas novos." />
            )}
            {data?.alertas.map((it) => (
              <button
                key={it.notification_id}
                onClick={() => open(it.conversation_id)}
                disabled={!it.conversation_id}
                className={`w-full text-left flex items-center gap-3 px-6 py-3 ${it.conversation_id ? FC.hover : "cursor-default"}`}
              >
                <Avatar name={it.contato} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${CAT_COLOR[it.category] || "bg-black/5 " + FC.mut}`}>
                      {CAT_LABEL[it.category] || it.category}
                    </span>
                    <span className={`text-[14px] font-medium truncate ${FC.ink}`}>{it.contato || it.telefone || it.title}</span>
                  </div>
                  <div className={`text-[12px] truncate ${FC.sub}`}>{it.body || it.title}</div>
                </div>
                {it.conversation_id && <MessageSquare className={`w-3.5 h-3.5 ${FC.mut} shrink-0`} />}
                <span className={`text-[11px] tabular-nums ${FC.sub} shrink-0`}>{relTime(it.created_at)}</span>
              </button>
            ))}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  UserCheck,
  TrendingUp,
  ShoppingBag,
  Sparkles,
  Globe,
  MapPin,
  Tag,
  Wallet,
  Clock,
  BadgeCheck,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Tier Agent — "O agente já chega sabendo do cliente".
   Versão Tier da seção Attio "Already there when you arrive":
   gatilho → perguntas com resposta da IA (revela em sequência)
   + card de perfil do cliente. Flow State + reuso do kit.
   ──────────────────────────────────────────────────────────── */

type Query = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  q: string;
  a: [string, string, string]; // [antes, destaque, depois]
};

const QUERIES: Query[] = [
  { icon: UserCheck, title: "Reconhece o cliente", q: "Já comprou com a gente antes?", a: ["", "Cliente recorrente", " desde 2024"] },
  { icon: TrendingUp, title: "Avalia a oportunidade", q: "Qual o ticket médio dele?", a: ["", "R$ 1.240/mês", " · 8 pedidos"] },
  { icon: ShoppingBag, title: "Sabe o que oferecer", q: "O que combina com o histórico?", a: ["", "Plano Pro + recarga", " mensal"] },
];

const PROFILE = [
  { icon: Globe, label: "Empresa", value: "souzastore.com", pill: true },
  { icon: BadgeCheck, label: "Plano", value: "Pro", chip: "ok" as const },
  { icon: MapPin, label: "Local", value: "Curitiba, PR" },
  { icon: Tag, label: "Categorias", value: "Varejo · Recorrente", chips: ["Varejo", "Recorrente"] },
  { icon: Wallet, label: "Ticket médio", value: "R$ 1.240" },
  { icon: Clock, label: "Último pedido", value: "há 3 dias" },
];

function QueryCard({ q, active, answered }: { q: Query; active: boolean; answered: boolean }) {
  return (
    <div className="relative">
      <div
        className={`rounded-[14px] bg-white border overflow-hidden transition-all duration-300 ${
          active ? "border-[1.5px] border-accent/45 shadow-[0_6px_18px_-10px_rgba(0,48,131,.35)]" : "border-line shadow-[0_1px_2px_rgba(13,15,17,.04)]"
        }`}
      >
        <div className="h-[42px] px-4 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[4px] flex items-center justify-center shrink-0 bg-accent/[0.08]">
            <q.icon className="w-3.5 h-3.5 text-accent" />
          </div>
          <span className="flex-1 text-[14px] font-semibold text-ink truncate">{q.title}</span>
          <span className="shrink-0 inline-flex items-center gap-1 h-[21px] px-2 rounded-md bg-accent/[0.07] text-[10.5px] font-semibold text-accent">
            <Sparkles className="w-2.5 h-2.5" /> IA
          </span>
        </div>
        <div className="px-4 py-2.5 border-t border-hairline text-[12.5px] text-[#7A828E]">{q.q}</div>
      </div>
      {/* resposta da IA (revela quando respondida) */}
      <div
        className={`ml-4 mt-2 flex items-center gap-1.5 text-[12.5px] text-[#4a5159] transition-all duration-500 ${
          answered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <span>
          {q.a[0]}
          <span className="font-semibold text-accent">{q.a[1]}</span>
          {q.a[2]}
        </span>
      </div>
    </div>
  );
}

export default function AgentResearchDemo() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (visible.current) setStep((s) => (s + 1) % (QUERIES.length + 1));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div ref={ref} className="flex flex-col lg:flex-row gap-8 items-start">
      {/* fluxo de pesquisa */}
      <div className="flex-1 min-w-0 w-full">
        {/* gatilho */}
        <div className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-[12px] bg-white border border-line shadow-[0_1px_2px_rgba(13,15,17,.04)]">
          <span className="w-6 h-6 rounded-[4px] bg-node-trigger/[0.1] flex items-center justify-center">
            <MessageCircle className="w-3.5 h-3.5 text-node-trigger" />
          </span>
          <span className="text-[13.5px] font-semibold text-ink">Novo cliente no WhatsApp</span>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          {QUERIES.map((q, i) => (
            <QueryCard key={q.title} q={q} active={step === i} answered={step > i || step >= QUERIES.length} />
          ))}
        </div>
      </div>

      {/* card de perfil do cliente */}
      <div className="w-full lg:w-[280px] shrink-0 rounded-[16px] bg-white border border-line shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-hairline">
          <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-[13px] font-semibold text-accent">
            MS
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink leading-tight">Marina Souza</div>
            <div className="text-[11.5px] text-[#9AA4B2] leading-tight mt-0.5">Cliente desde 2024</div>
          </div>
        </div>
        <div className="px-4 py-2">
          {PROFILE.map((f) => (
            <div key={f.label} className="flex items-center gap-2.5 h-9">
              <f.icon className="w-3.5 h-3.5 text-[#9AA4B2] shrink-0" />
              <span className="text-[12px] text-[#6A7385] w-[78px] shrink-0">{f.label}</span>
              {f.chips ? (
                <span className="flex items-center gap-1">
                  {f.chips.map((c) => (
                    <span key={c} className="h-[19px] px-1.5 inline-flex items-center rounded-md bg-surface-muted text-[10.5px] font-medium text-[#6A7385]">
                      {c}
                    </span>
                  ))}
                </span>
              ) : f.chip === "ok" ? (
                <span className="h-[19px] px-1.5 inline-flex items-center rounded-md bg-flow-okbg text-[10.5px] font-semibold text-flow-okfg">
                  {f.value}
                </span>
              ) : f.pill ? (
                <span className="text-[12.5px] font-medium text-accent">{f.value}</span>
              ) : (
                <span className="text-[12.5px] font-medium text-ink">{f.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

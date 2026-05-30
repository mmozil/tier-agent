import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  MessagesSquare,
  BrainCircuit,
  GitBranch,
  ShieldCheck,
  ChevronDown,
  Instagram,
  Linkedin,
  Twitter,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Tier Agent — Chrome de marketing compartilhado (Attio-grade)
   Nav com links reais + mega-menu Recursos + Footer denso + motifs.
   Usado por Landing, Plataforma, Recursos e Preços.
   NÃO altera nenhuma rota de auth (/login, /signup) — só navega.
   ──────────────────────────────────────────────────────────── */

// Cubo isométrico line-art (motif de canto Attio)
export function IsoCube({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 130" fill="none" className={className} aria-hidden>
      <g stroke="#D1D3D6" strokeWidth="1" strokeLinejoin="round">
        <path d="M60 8 L108 34 L108 86 L60 112 L12 86 L12 34 Z" />
        <path d="M60 8 L60 60 M60 60 L108 34 M60 60 L12 34" />
        <path d="M60 60 L60 112" opacity=".6" />
        <path d="M84 70 L104 81 L104 103 L84 114 L64 103 L64 81 Z" fill="#FFFFFF" />
        <path d="M84 70 L84 92 M84 92 L104 81 M84 92 L64 81" />
      </g>
    </svg>
  );
}

/* ─── Canvas de playbook: nó + conector (linguagem do builder) ─── */

// Conector: porta (○) na borda do card de cima + seta (▼) no de baixo.
// active = caminho percorrido (verde) · inativo = cinza claro.
export function FlowEdge({ active = true, height = 44 }: { active?: boolean; height?: number }) {
  const color = active ? "#00D17E" : "#D6DAE0";
  return (
    <svg width="16" height={height} viewBox={`0 0 16 ${height}`} className="block shrink-0 -mt-[6px] relative z-10" aria-hidden>
      <line x1="8" y1="8" x2="8" y2={height - 8} stroke={color} strokeWidth={active ? 2 : 1.5} />
      <circle cx="8" cy="5" r="3.5" fill="#FFFFFF" stroke={color} strokeWidth="1.5" />
      <path d={`M8 ${height} L3 ${height - 8} L13 ${height - 8} Z`} fill={color} />
    </svg>
  );
}

export function FlowNode({
  icon: Icon,
  title,
  subtitle,
  tag,
  color,
  status,
  trigger,
  dim = false,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  subtitle: string;
  tag?: string;
  color: string;
  status?: "completed" | "running";
  trigger?: boolean;
  dim?: boolean;
}) {
  // borda fina e elegante (igual PlaybookDemo)
  const borderCls =
    status === "running"
      ? "border-[1.5px] border-warning/55 shadow-[0_4px_14px_-8px_rgba(245,163,0,.4)]"
      : status === "completed"
        ? "border-[1.5px] border-success/45 shadow-[0_4px_14px_-8px_rgba(0,209,126,.32)]"
        : "border border-line shadow-[0_1px_2px_rgba(13,15,17,.04)]";

  return (
    <div className={`relative w-[284px] ${dim ? "opacity-55" : ""}`}>
      {trigger && (
        <div className="absolute -top-[27px] left-0 inline-flex items-center gap-1.5 h-[21px] px-2 rounded-full bg-white/80 border border-hairline text-[10px] font-medium text-[#9AA4B2]">
          <span className="w-1.5 h-1.5 rounded-full bg-node-trigger" /> Trigger
        </div>
      )}
      {status && (
        <div
          className={`absolute -top-[13px] right-3 z-20 inline-flex items-center gap-1 h-[20px] pl-1.5 pr-2.5 rounded-full text-[10.5px] font-semibold ring-[3px] ring-white ${
            status === "running" ? "bg-flow-runbg text-flow-runfg" : "bg-flow-okbg text-flow-okfg"
          }`}
        >
          {status === "running" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-flow-runfg animate-pulsedot" />
          ) : (
            <span className="text-[11px] leading-none">✓</span>
          )}
          {status === "running" ? "Executando" : "Concluído"}
        </div>
      )}
      <div className={`relative rounded-[14px] bg-white border ${borderCls} overflow-hidden`}>
        {/* header */}
        <div className="h-[42px] px-4 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[4px] flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}12` }}>
            <Icon className="w-3.5 h-3.5" style={{ color }} />
          </div>
          <span className="flex-1 text-[14px] font-semibold text-ink truncate">{title}</span>
          {tag && (
            <span className="shrink-0 h-[21px] px-2 inline-flex items-center rounded-md bg-surface-muted text-[10.5px] font-medium text-[#8A93A1]">
              {tag}
            </span>
          )}
        </div>
        {/* body */}
        <div className="px-4 py-2.5 border-t border-hairline text-[12.5px] text-[#7A828E] leading-relaxed">{subtitle}</div>
      </div>
    </div>
  );
}

// Grupos do mega-menu "Recursos" (apontam pras âncoras da página /recursos)
const RECURSOS_MENU = [
  { icon: MessagesSquare, label: "Atendimento", desc: "Multicanal, lead, hand-off, inbox", href: "/recursos#atendimento" },
  { icon: BrainCircuit, label: "Inteligência", desc: "Visão, voz, RAG, memória", href: "/recursos#inteligencia" },
  { icon: GitBranch, label: "Automação", desc: "Playbooks, specialists, cron", href: "/recursos#automacao" },
  { icon: ShieldCheck, label: "Governança", desc: "Guardrails, PII, custos, auditoria", href: "/recursos#governanca" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-hairline">
      <div className="max-w-[1180px] mx-auto px-6 h-[64px] flex items-center justify-between">
        <Link to="/" className="shrink-0">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-7 w-auto" />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <Link to="/plataforma" className="text-[14px] font-medium text-[#3f4651] hover:text-ink hover:bg-surface-muted h-9 px-3 inline-flex items-center rounded-[8px] transition-colors">
            Plataforma
          </Link>

          {/* Recursos — mega-menu */}
          <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            <Link
              to="/recursos"
              className="text-[14px] font-medium text-[#3f4651] hover:text-ink hover:bg-surface-muted h-9 px-3 inline-flex items-center gap-1 rounded-[8px] transition-colors"
            >
              Recursos <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </Link>
            {open && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-[440px]">
                <div className="rounded-xl bg-white border border-line shadow-pop p-2 grid grid-cols-2 gap-1">
                  {RECURSOS_MENU.map((m) => (
                    <Link
                      key={m.label}
                      to={m.href}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-subtle transition-colors"
                    >
                      <div
                        className="w-8 h-8 rounded-md bg-accent/[0.06] flex items-center justify-center shrink-0"
                        style={{ boxShadow: "0 0 0 1px rgba(0,48,131,.12)" }}
                      >
                        <m.icon className="w-4 h-4 text-accent" />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-ink leading-tight">{m.label}</div>
                        <div className="text-[11px] text-[#6A7385] leading-tight mt-0.5">{m.desc}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link to="/#prova" className="text-[14px] font-medium text-[#3f4651] hover:text-ink hover:bg-surface-muted h-9 px-3 inline-flex items-center rounded-[8px] transition-colors">
            Clientes
          </Link>
          <Link to="/precos" className="text-[14px] font-medium text-[#3f4651] hover:text-ink hover:bg-surface-muted h-9 px-3 inline-flex items-center rounded-[8px] transition-colors">
            Preços
          </Link>
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            to="/login"
            className="hidden sm:inline-flex text-[14px] font-medium text-[#3f4651] hover:text-ink h-9 px-3 items-center rounded-[8px] hover:bg-surface-muted transition-colors"
          >
            Entrar
          </Link>
          <Link
            to="/signup"
            className="text-[14px] font-semibold text-white bg-cta hover:bg-cta-hover h-9 px-4 inline-flex items-center rounded-[10px] shadow-[0_1px_2px_rgba(13,15,17,.18)] transition-colors"
          >
            Começar grátis
          </Link>
          <button
            className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-[8px] border border-line text-[#3a3f47]"
            onClick={() => setMobile((v) => !v)}
            aria-label="Menu"
          >
            <span className="text-[18px] leading-none">≡</span>
          </button>
        </div>
      </div>

      {/* Menu mobile */}
      {mobile && (
        <div className="md:hidden border-t border-hairline bg-white px-6 py-3 flex flex-col gap-1">
          {[
            { l: "Plataforma", to: "/plataforma" },
            { l: "Recursos", to: "/recursos" },
            { l: "Clientes", to: "/#prova" },
            { l: "Preços", to: "/precos" },
          ].map((i) => (
            <Link
              key={i.l}
              to={i.to}
              onClick={() => setMobile(false)}
              className="text-[14px] text-[#3a3f47] hover:text-ink py-2"
            >
              {i.l}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

const FOOTER_COLS = [
  {
    title: "Produto",
    links: [
      { l: "Plataforma", to: "/plataforma" },
      { l: "Recursos", to: "/recursos" },
      { l: "Preços", to: "/precos" },
      { l: "Entrar", to: "/login" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { l: "Atendimento", to: "/recursos#atendimento" },
      { l: "Inteligência", to: "/recursos#inteligencia" },
      { l: "Automação", to: "/recursos#automacao" },
      { l: "Governança", to: "/recursos#governanca" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { l: "tier.finance", to: "https://tier.finance", ext: true },
      { l: "Tier Empresas", to: "https://erp.tier.finance", ext: true },
      { l: "Começar grátis", to: "/signup" },
    ],
  },
  {
    title: "Legal",
    links: [
      { l: "Privacidade", to: "/privacy" },
      { l: "Exclusão de dados", to: "/data-deletion" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-surface-subtle border-t border-hairline overflow-hidden">
      <div className="max-w-[1180px] mx-auto px-6 pt-16 pb-8">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
          <div className="col-span-2 md:col-span-2">
            <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-7 w-auto" />
            <p className="mt-4 text-[13px] text-[#6A7385] leading-relaxed max-w-[260px]">
              Agentes de IA que atendem, qualificam e cobram em qualquer canal.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[Twitter, Linkedin, Instagram].map((Ic, i) => (
                <a
                  key={i}
                  href="https://tier.finance"
                  className="w-8 h-8 rounded-[8px] border border-line bg-white flex items-center justify-center text-[#6A7385] hover:text-ink hover:border-line-strong transition-colors"
                  aria-label="social"
                >
                  <Ic className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA4B2] mb-3.5">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((lk) => (
                  <li key={lk.l}>
                    {"ext" in lk && lk.ext ? (
                      <a href={lk.to} className="text-[13px] text-[#6A7385] hover:text-ink transition-colors">
                        {lk.l}
                      </a>
                    ) : (
                      <Link to={lk.to} className="text-[13px] text-[#6A7385] hover:text-ink transition-colors">
                        {lk.l}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-hairline flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-[12px] text-[#9AA4B2]">© 2026 Tier · agent.tier.finance</span>
          <span className="text-[12px] text-[#9AA4B2]">Feito no Brasil 🇧🇷</span>
        </div>
      </div>
      {/* wordmark gigante (assinatura Attio) */}
      <div className="relative select-none pointer-events-none" aria-hidden>
        <div className="font-display font-bold tracking-display text-[#E7EAEE] leading-[0.78] text-center text-[clamp(70px,17vw,260px)] -mb-[0.1em]">
          tier agent
        </div>
      </div>
    </footer>
  );
}

// Bloco CTA final reutilizável (fundo dark, dotted)
export function FinalCTA({
  title = "Coloque seu primeiro agente no ar hoje.",
  subtitle = "Sem cartão. Conecte o WhatsApp e veja o agente atender em minutos.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="bg-cta relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{ backgroundImage: "radial-gradient(circle, #FFFFFF 1px, transparent 1px)", backgroundSize: "24px 24px" }}
      />
      <div className="relative max-w-[820px] mx-auto px-6 py-20 text-center">
        <h2 className="font-display text-[clamp(32px,5vw,48px)] font-semibold tracking-display text-white leading-tight text-balance">
          {title}
        </h2>
        <p className="mt-4 text-[17px] text-white/70 max-w-[520px] mx-auto">{subtitle}</p>
        <Link
          to="/signup"
          className="mt-8 h-11 px-6 inline-flex items-center gap-2 rounded-md bg-white text-ink text-[15px] font-medium hover:bg-white/90 transition-colors"
        >
          Começar grátis <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

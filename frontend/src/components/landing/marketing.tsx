import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, Instagram, Linkedin, Twitter } from "lucide-react";

import {
  FlyoutAgentIcon,
  FlyoutDeveloperIcon,
  FlyoutHealthIcon,
  FlyoutInboxIcon,
  FlyoutIntegrationsIcon,
  FlyoutRelayIcon,
  FlyoutReportIcon,
  FlyoutSequenceIcon,
  FlyoutWorkflowIcon,
} from "../icons/flyoutIcons";

type FlyoutLink = {
  label: string;
  desc: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type FlyoutSection = {
  title: string;
  columns?: 1 | 2;
  links: FlyoutLink[];
};

type FlyoutMenuModel = {
  railTitle: string;
  railLinks: { label: string; href: string }[];
  sections: FlyoutSection[];
};

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

export function BranchSplit({
  leftLabel,
  rightLabel,
  activeRight = false,
}: {
  leftLabel: string;
  rightLabel: string;
  activeRight?: boolean;
}) {
  const cardW = 316;
  const gap = 32;
  const width = cardW * 2 + gap;
  const leftX = cardW / 2;
  const rightX = width - cardW / 2;
  const center = width / 2;
  const height = 60;
  const green = "#00D17E";
  const grey = "#D6DAE0";
  const rightColor = activeRight ? green : grey;

  return (
    <div className="relative -mt-[6px]" style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block relative z-10" aria-hidden>
        <circle cx={center} cy="5" r="3.5" fill="#FFFFFF" stroke={green} strokeWidth="1.5" />
        <line x1={center} y1="8" x2={center} y2="20" stroke={green} strokeWidth="2" />
        <line x1={leftX} y1="20" x2={center} y2="20" stroke={green} strokeWidth="2" />
        <line x1={center} y1="20" x2={rightX} y2="20" stroke={rightColor} strokeWidth="2" />
        <line x1={leftX} y1="20" x2={leftX} y2={height - 6} stroke={green} strokeWidth="2" />
        <path d={`M${leftX} ${height} L${leftX - 5} ${height - 8} L${leftX + 5} ${height - 8} Z`} fill={green} />
        <line x1={rightX} y1="20" x2={rightX} y2={height - 6} stroke={rightColor} strokeWidth="2" />
        <path d={`M${rightX} ${height} L${rightX - 5} ${height - 8} L${rightX + 5} ${height - 8} Z`} fill={rightColor} />
      </svg>
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: leftX, top: 33 }}>
        <span className="px-2 h-[20px] inline-flex items-center rounded-full bg-white border border-line text-[10.5px] font-medium text-[#6A7385]">
          {leftLabel}
        </span>
      </div>
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: rightX, top: 33 }}>
        <span
          className={`px-2 h-[20px] inline-flex items-center rounded-full bg-white border border-line text-[10.5px] font-medium ${
            activeRight ? "text-[#6A7385]" : "text-[#9AA4B2]"
          }`}
        >
          {rightLabel}
        </span>
      </div>
    </div>
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
  const borderCls =
    status === "running"
      ? "border-[1.5px] border-warning/55 shadow-[0_4px_14px_-8px_rgba(245,163,0,.4)]"
      : status === "completed"
        ? "border-[1.5px] border-success/45 shadow-[0_4px_14px_-8px_rgba(0,209,126,.32)]"
        : "border border-line shadow-[0_1px_2px_rgba(13,15,17,.04)]";

  return (
    <div className={`relative w-[316px] ${dim ? "opacity-55" : ""}`}>
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
        <div className="px-4 py-2.5 border-t border-hairline text-[12.5px] text-[#7A828E] leading-relaxed">{subtitle}</div>
      </div>
    </div>
  );
}

const PLATFORM_MENU: FlyoutMenuModel = {
  railTitle: "COMEÇAR",
  railLinks: [
    { label: "Ver a plataforma", href: "/plataforma" },
    { label: "Falar com especialista", href: "/signup" },
  ],
  sections: [
    {
      title: "PLATAFORMA DE AGENTES",
      columns: 2,
      links: [
        {
          icon: FlyoutInboxIcon,
          label: "Inbox multicanal",
          desc: "WhatsApp oficial, Instagram, Telegram e e-mail no mesmo operador.",
          href: "/plataforma",
        },
        {
          icon: FlyoutAgentIcon,
          label: "IA nativa",
          desc: "Responde, qualifica, cobra e consulta memória dentro da operação.",
          href: "/recursos#inteligencia",
        },
        {
          icon: FlyoutRelayIcon,
          label: "Contexto & handoff",
          desc: "Próxima ação, notas e passagem humana com tudo já preenchido.",
          href: "/recursos#atendimento",
        },
        {
          icon: FlyoutIntegrationsIcon,
          label: "Apps & integrações",
          desc: "ERP, Hovio Pet e qualquer servidor MCP custom plugado no agente.",
          href: "/recursos#governanca",
        },
      ],
    },
    {
      title: "AUTOMAÇÕES",
      columns: 2,
      links: [
        {
          icon: FlyoutWorkflowIcon,
          label: "Playbooks",
          desc: "Gatilhos, decisões, ferramentas e humano no loop no mesmo fluxo.",
          href: "/plataforma",
        },
        {
          icon: FlyoutSequenceIcon,
          label: "Sequências",
          desc: "Cobrança, follow-up, recuperação e retomada com cadência própria.",
          href: "/recursos#automacao",
        },
      ],
    },
    {
      title: "INSIGHTS",
      columns: 2,
      links: [
        {
          icon: FlyoutHealthIcon,
          label: "Saúde da operação",
          desc: "Latência, cobertura, escalonamento e custo lidos em tempo real.",
          href: "/plataforma",
        },
        {
          icon: FlyoutReportIcon,
          label: "Relatórios",
          desc: "Execuções, falhas e performance por agente, canal e playbook.",
          href: "/plataforma",
        },
      ],
    },
    {
      title: "DESENVOLVEDORES",
      columns: 1,
      links: [
        {
          icon: FlyoutDeveloperIcon,
          label: "Developer platform",
          desc: "OAuth, tool providers, runtime e MCP para plugar qualquer stack.",
          href: "/recursos#governanca",
        },
      ],
    },
  ],
};

const RESOURCE_MENU: FlyoutMenuModel = {
  railTitle: "EXPLORAR",
  railLinks: [
    { label: "Casos de uso", href: "/#prova" },
    { label: "Ver preços", href: "/precos" },
  ],
  sections: [
    {
      title: "CAPACIDADES",
      columns: 2,
      links: [
        {
          icon: FlyoutAgentIcon,
          label: "Atendimento autônomo",
          desc: "Qualifica, responde e cobra sem trocar de ferramenta.",
          href: "/recursos#atendimento",
        },
        {
          icon: FlyoutIntegrationsIcon,
          label: "WhatsApp oficial",
          desc: "Cloud API da Meta com embedded signup e operação real.",
          href: "/recursos#atendimento",
        },
        {
          icon: FlyoutRelayIcon,
          label: "Humano no loop",
          desc: "Escala só quando precisa, com contexto completo na fila humana.",
          href: "/recursos#governanca",
        },
        {
          icon: FlyoutWorkflowIcon,
          label: "RAG com citação",
          desc: "Memória, base e resposta contextualizada sem improviso.",
          href: "/recursos#inteligencia",
        },
      ],
    },
    {
      title: "AUTOMAÇÕES",
      columns: 2,
      links: [
        {
          icon: FlyoutSequenceIcon,
          label: "Cobrança por IA",
          desc: "Pix, cobrança recorrente e retomada de carrinho no mesmo fluxo.",
          href: "/recursos#automacao",
        },
        {
          icon: FlyoutHealthIcon,
          label: "Especialistas e rotas",
          desc: "Agentes por etapa, por fila ou por intenção com regras claras.",
          href: "/recursos#automacao",
        },
      ],
    },
    {
      title: "DESENVOLVEDORES",
      columns: 1,
      links: [
        {
          icon: FlyoutDeveloperIcon,
          label: "MCP & tool providers",
          desc: "Conecte sistemas vivos e transforme capabilities em ações da operação.",
          href: "/recursos#governanca",
        },
      ],
    },
  ],
};

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
    title: "Capacidades",
    links: [
      { l: "Inbox multicanal", to: "/recursos#atendimento" },
      { l: "Playbooks", to: "/recursos#automacao" },
      { l: "Fontes de dados", to: "/recursos#governanca" },
      { l: "Métricas e custo", to: "/plataforma" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { l: "Tier Finance", to: "https://tier.finance", ext: true },
      { l: "Tier Empresas", to: "https://erp.tier.finance", ext: true },
      { l: "Começar agora", to: "/signup" },
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

function NavDropdown({ menu }: { menu: FlyoutMenuModel }) {
  return (
    <div className="absolute left-1/2 top-full -translate-x-1/2 pt-2" style={{ width: "min(1160px, calc(100vw - 68px))" }}>
      <div className="overflow-hidden rounded-[30px] border border-[#D8DDE4] bg-white shadow-[0_38px_72px_-48px_rgba(18,24,33,0.28)]">
        <div className="grid grid-cols-[minmax(0,1fr)_324px]">
          <div className="px-[46px] py-[40px]">
            {menu.sections.map((section, index) => (
              <div key={section.title} className={index === 0 ? "" : "mt-10"}>
                <div className="mb-6 text-[11px] font-semibold uppercase tracking-[0.085em] text-[#B0B7C3]">
                  {section.title}
                </div>
                <div className={section.columns === 1 ? "grid gap-y-7" : "grid grid-cols-2 gap-x-16 gap-y-8"}>
                  {section.links.map((item) => (
                    <Link
                      key={item.label}
                      to={item.href}
                      className="group -m-2.5 flex items-start gap-5 rounded-[20px] p-2.5 transition-colors hover:bg-[#FAFAFB]"
                    >
                      <item.icon className="mt-0.5 h-12 w-12 shrink-0 text-[#66707D]" />
                      <div className="max-w-[282px]">
                        <div className="text-[16px] font-medium tracking-[-0.03em] text-[#1B1E23]">{item.label}</div>
                        <div className="mt-1 text-[13px] leading-[1.45] text-[#7B8391]">{item.desc}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-l border-[#E5E8ED] px-10 py-[40px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.085em] text-[#B0B7C3]">{menu.railTitle}</div>
            <div className="mt-9 space-y-8">
              {menu.railLinks.map((item) => (
                <Link
                  key={item.label}
                  to={item.href}
                  className="block text-[17px] font-medium tracking-[-0.03em] text-[#24272D] transition-colors hover:text-black"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState<"platform" | "resources" | null>(null);
  const [mobile, setMobile] = useState(false);
  const buttonClass =
    "inline-flex h-12 items-center gap-2 rounded-[18px] px-[18px] text-[15px] font-medium tracking-[-0.02em] transition-colors";

  return (
    <>
      <div className="border-b border-black bg-black text-white">
        <div className="mx-auto flex h-12 max-w-[1280px] items-center justify-center px-4 text-center text-[12.5px] font-medium">
          <Link to="/plataforma" className="inline-flex items-center gap-1.5 hover:text-white/80 transition-colors">
            Orquestre canais, playbooks e dados ao vivo numa só operação
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-50 border-b border-hairline bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1280px] items-center justify-between px-6">
          <Link to="/" className="shrink-0">
            <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-8 w-auto" />
          </Link>

          <nav className="relative hidden items-center gap-2.5 md:flex" onMouseLeave={() => setOpen(null)}>
            <div onMouseEnter={() => setOpen("platform")}>
              <button
                className={`${buttonClass} ${
                  open === "platform" ? "bg-[#F2F4F7] text-[#1B1E23]" : "text-[#2F3339] hover:bg-[#F7F8FA]"
                }`}
              >
                Plataforma
                <ChevronDown className={`h-4 w-4 transition-transform ${open === "platform" ? "rotate-180" : "opacity-60"}`} />
              </button>
            </div>

            <div onMouseEnter={() => setOpen("resources")}>
              <button
                className={`${buttonClass} ${
                  open === "resources" ? "bg-[#F2F4F7] text-[#1B1E23]" : "text-[#2F3339] hover:bg-[#F7F8FA]"
                }`}
              >
                Recursos
                <ChevronDown className={`h-4 w-4 transition-transform ${open === "resources" ? "rotate-180" : "opacity-60"}`} />
              </button>
            </div>

            <Link to="/#prova" className={`${buttonClass} text-[#2F3339] hover:bg-[#F7F8FA]`}>
              Clientes
            </Link>
            <Link to="/precos" className={`${buttonClass} text-[#2F3339] hover:bg-[#F7F8FA]`}>
              Preços
            </Link>

            {open === "platform" && <NavDropdown menu={PLATFORM_MENU} />}
            {open === "resources" && <NavDropdown menu={RESOURCE_MENU} />}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden h-10 items-center rounded-[12px] border border-line bg-white px-4 text-[14px] font-medium text-ink shadow-sm hover:border-line-strong hover:bg-surface-subtle transition-colors sm:inline-flex"
            >
              Entrar
            </Link>
            <Link
              to="/signup"
              className="inline-flex h-10 items-center rounded-[12px] bg-cta px-4 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(13,15,17,.18)] hover:bg-cta-hover transition-colors"
            >
              Começar agora
            </Link>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-line text-[#3A3F47] md:hidden"
              onClick={() => setMobile((value) => !value)}
              aria-label="Menu"
            >
              <span className="text-[18px] leading-none">≡</span>
            </button>
          </div>
        </div>

        {mobile && (
          <div className="border-t border-hairline bg-white px-6 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              {[
                { label: "Plataforma", to: "/plataforma" },
                { label: "Recursos", to: "/recursos" },
                { label: "Clientes", to: "/#prova" },
                { label: "Preços", to: "/precos" },
                { label: "Entrar", to: "/login" },
              ].map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => setMobile(false)}
                  className="rounded-[12px] px-3 py-2.5 text-[14px] text-[#3A3F47] hover:bg-surface-subtle hover:text-ink transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>
    </>
  );
}

function CTAChain() {
  return (
    <svg viewBox="0 0 180 92" fill="none" aria-hidden className="h-[74px] w-auto text-[#D1D3D6]">
      <g stroke="currentColor" strokeWidth="2">
        <path d="M24 46 L40 18 H72 L88 46 L72 74 H40 Z" />
        <path d="M70 46 L86 18 H118 L134 46 L118 74 H86 Z" />
        <path d="M116 46 L132 18 H164 L180 46 L164 74 H132 Z" />
        <path d="M47 32 L57 46 L47 60" />
        <path d="M93 32 L103 46 L93 60" />
        <path d="M139 32 L149 46 L139 60" />
      </g>
    </svg>
  );
}

export function FinalCTA({
  title = "Comece com 14 dias do Pro, sem travar a operação.",
  subtitle = "Conecte canais, publique o primeiro playbook e veja o Agent responder com contexto em minutos.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="border-y border-hairline bg-[#F4F4F1]">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-6 py-12 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Começar rápido</div>
          <h2 className="mt-3 font-display text-[clamp(28px,4vw,42px)] font-semibold tracking-display text-ink leading-[1.05]">
            {title}
          </h2>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-[#6A7385]">{subtitle}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="inline-flex h-11 items-center rounded-[12px] bg-cta px-5 text-[14px] font-semibold text-white hover:bg-cta-hover transition-colors"
            >
              Começar agora
            </Link>
            <Link
              to="/plataforma"
              className="inline-flex h-11 items-center rounded-[12px] border border-line bg-white px-5 text-[14px] font-medium text-ink hover:bg-surface-subtle transition-colors"
            >
              Ver a plataforma
            </Link>
          </div>
        </div>
        <div className="hidden md:block">
          <CTAChain />
        </div>
      </div>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#050607] text-white">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="grid gap-12 md:grid-cols-[1.2fr_repeat(4,1fr)]">
          <div>
            <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-8 w-auto brightness-[6]" />
            <p className="mt-4 max-w-[260px] text-[13px] leading-relaxed text-white/58">
              Agentes de IA para operar atendimento, dados e playbooks com contexto real em cada canal.
            </p>
            <div className="mt-6 flex items-center gap-2">
              {[Twitter, Linkedin, Instagram].map((Icon, index) => (
                <a
                  key={index}
                  href="https://tier.finance"
                  className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-white/12 bg-white/[0.03] text-white/56 hover:border-white/20 hover:text-white transition-colors"
                  aria-label="social"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/34">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((item) => (
                  <li key={item.l}>
                    {"ext" in item && item.ext ? (
                      <a href={item.to} className="text-[13px] text-white/62 hover:text-white transition-colors">
                        {item.l}
                      </a>
                    ) : (
                      <Link to={item.to} className="text-[13px] text-white/62 hover:text-white transition-colors">
                        {item.l}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-[12px] text-white/34 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Tier Agent</span>
          <span>Feito para operar atendimento com contexto, controle e humano no loop.</span>
        </div>
      </div>
    </footer>
  );
}

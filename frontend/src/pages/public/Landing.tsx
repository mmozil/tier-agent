import { Link } from "react-router-dom";
import {
  Zap,
  GitBranch,
  Sparkles,
  MessagesSquare,
  BrainCircuit,
  ShieldCheck,
  ArrowRight,
  Check,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Tier Agent — Landing "Attio-grade"
   Linguagem visual inspirada em attio.com (blueprint grid, dotted bg,
   near-white + CTA near-black, hairlines, cubos isométricos, fluxos verdes).
   Cor padrão única: azul Tier #003083. Conteúdo 100% original Tier Agent.
   ──────────────────────────────────────────────────────────── */

// Cubo isométrico line-art (motif de canto)
function IsoCube({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 130" fill="none" className={className} aria-hidden>
      <g stroke="#D1D3D6" strokeWidth="1" strokeLinejoin="round">
        <path d="M60 8 L108 34 L108 86 L60 112 L12 86 L12 34 Z" />
        <path d="M60 8 L60 60 M60 60 L108 34 M60 60 L12 34" />
        <path d="M60 60 L60 112" opacity=".6" />
        {/* bloco menor flutuando */}
        <path d="M84 70 L104 81 L104 103 L84 114 L64 103 L64 81 Z" fill="#FFFFFF" />
        <path d="M84 70 L84 92 M84 92 L104 81 M84 92 L64 81" />
      </g>
    </svg>
  );
}

// Nó estático do canvas (mostra a linguagem do builder na landing)
function DemoNode({
  icon: Icon,
  title,
  subtitle,
  tag,
  color,
  status,
  trigger,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  subtitle: string;
  tag?: string;
  color: string;
  status?: "completed" | "running";
  trigger?: boolean;
}) {
  const ring =
    status === "completed"
      ? "shadow-[0_0_0_1.5px_#00D17E,0_0_0_4px_rgba(0,209,126,.14),0_4px_12px_-4px_rgba(13,15,17,.08)]"
      : "shadow-sm";
  return (
    <div className={`relative w-[230px] rounded-lg bg-white ${ring}`}>
      {trigger && (
        <div className="absolute -top-[18px] left-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-node-trigger">
          <span className="w-1.5 h-1.5 rounded-full bg-node-trigger" /> Trigger
        </div>
      )}
      {status && (
        <div
          className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full text-[10px] font-semibold ${
            status === "running" ? "bg-flow-runbg text-flow-runfg" : "bg-flow-okbg text-flow-okfg"
          }`}
        >
          {status === "running" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-flow-runfg animate-pulsedot" />
          ) : (
            "✓"
          )}
          {status === "running" ? "Running" : "Completed"}
        </div>
      )}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg" style={{ backgroundColor: color }} />
      <div className="px-3 py-3 flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}12`, boxShadow: `0 0 0 1px ${color}22` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink leading-tight tracking-snug truncate">{title}</div>
          <div className="text-[11px] text-[#6A7385] leading-tight mt-0.5 truncate">{subtitle}</div>
        </div>
        {tag && (
          <span className="shrink-0 h-[18px] px-1.5 inline-flex items-center rounded-full bg-surface-sunken text-[10px] font-medium text-[#6A7385]">
            {tag}
          </span>
        )}
      </div>
    </div>
  );
}

const NAV = ["Plataforma", "Recursos", "Clientes", "Preços"];

const PILLARS = [
  { icon: MessagesSquare, title: "Atende em qualquer canal", desc: "WhatsApp, Instagram, Telegram, e-mail e widget web — uma persona, todos os canais." },
  { icon: GitBranch, title: "Playbooks visuais", desc: "Desenhe fluxos arrastando blocos. Gatilho, decisão, IA, cobrança, hand-off humano." },
  { icon: BrainCircuit, title: "Memória que cresce", desc: "Lembra de cada contato entre sessões. Quanto mais usa, mais o agente entende." },
  { icon: Sparkles, title: "Responde dos seus dados", desc: "RAG real com citação de fonte. PDFs, planilhas e catálogos viram conhecimento." },
];

const PRICING = [
  { name: "Lite", price: "99", tagline: "Pra começar a automatizar", feats: ["1 agente", "Playbooks até 3 fluxos", "WhatsApp + templates BR", "Memória 7 dias"], cta: "Começar grátis", highlight: false },
  { name: "Pro", price: "199", tagline: "Pro time que escala", feats: ["Multi-agente + specialists", "RAG + memória 30 dias", "Voz (áudio E2E)", "Multicanal completo"], cta: "Assinar Pro", highlight: true },
  { name: "Business", price: "899", tagline: "Operação completa", feats: ["Tudo do Pro, ilimitado", "Guardrails + CodeAct", "Skills auto-evolutivas", "Marketplace + A/B testing"], cta: "Falar com vendas", highlight: false },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 h-[60px] flex items-center justify-between">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-7 w-auto" />
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((n) => (
              <span key={n} className="text-[14px] text-[#3a3f47] hover:text-ink cursor-pointer transition-colors">
                {n}
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <Link to="/login" className="text-[14px] font-medium text-[#3a3f47] hover:text-ink h-9 px-3 inline-flex items-center rounded-md border border-line hover:bg-surface-muted transition-colors">
              Entrar
            </Link>
            <Link to="/signup" className="text-[14px] font-medium text-white bg-cta hover:bg-cta-hover h-9 px-3.5 inline-flex items-center rounded-md transition-colors">
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-hairline">
        <div className="absolute inset-0 bg-dots-lg opacity-50" />
        {/* margens hachuradas */}
        <div className="absolute inset-y-0 left-0 w-8 hatch hidden lg:block" />
        <div className="absolute inset-y-0 right-0 w-8 hatch hidden lg:block" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-20 pb-16 text-center">
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-surface-muted border border-line text-[12px] font-medium text-[#3a3f47]">
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Agentes de IA que agem sozinhos
          </span>
          <h1 className="font-display text-balance mt-6 text-[clamp(40px,6vw,68px)] font-semibold leading-[1.02] tracking-display text-ink">
            O funcionário digital que<br className="hidden sm:block" /> nunca dorme.
          </h1>
          <p className="mt-5 text-[18px] leading-relaxed text-[#4a5159] max-w-[640px] mx-auto text-balance">
            Crie agentes que atendem, qualificam e cobram em qualquer canal. Eles lembram do cliente,
            decidem o próximo passo e escalam pra um humano quando precisa.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/signup" className="h-11 px-5 inline-flex items-center gap-2 rounded-md bg-cta hover:bg-cta-hover text-white text-[15px] font-medium transition-colors">
              Criar meu agente <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" className="h-11 px-5 inline-flex items-center rounded-md border border-line bg-white hover:bg-surface-muted text-ink text-[15px] font-medium transition-colors">
              Ver demonstração
            </Link>
          </div>

          {/* mockup do canvas */}
          <div className="mt-14 relative">
            <div className="mx-auto max-w-[900px] rounded-2xl border border-line bg-surface-sunken shadow-md overflow-hidden">
              <div className="h-9 border-b border-line bg-white flex items-center gap-1.5 px-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
                <span className="ml-3 text-[12px] text-[#6A7385]">Playbook · Recuperação de carrinho</span>
              </div>
              <div className="relative bg-dots p-8 min-h-[300px] flex flex-col items-center gap-6">
                <div className="flex items-start gap-10">
                  <div className="pt-1"><DemoNode icon={Zap} title="Quando carrinho abandona" subtitle="Gatilho · evento" tag="Vendas" color="#8B5CF6" status="completed" trigger /></div>
                </div>
                <svg width="2" height="28" className="-my-2"><line x1="1" y1="0" x2="1" y2="28" stroke="#00D17E" strokeWidth="2" /></svg>
                <DemoNode icon={Sparkles} title="Gera oferta com IA" subtitle="Cupom personalizado" tag="LLM" color="#003083" status="completed" />
                <svg width="2" height="28" className="-my-2"><line x1="1" y1="0" x2="1" y2="28" stroke="#00D17E" strokeWidth="2" /></svg>
                <DemoNode icon={MessagesSquare} title="Envia no WhatsApp" subtitle="Mensagem + cupom" tag="Canal" color="#00D17E" status="running" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Logos ───────────────────────────────────────── */}
      <section className="border-b border-hairline bg-surface-subtle">
        <div className="max-w-[1180px] mx-auto px-6 py-8">
          <p className="text-center text-[12px] font-semibold uppercase tracking-wide text-[#9AA4B2] mb-5">
            Empresas que já automatizam com a Tier
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-60">
            {["Kirvah", "Hovio", "M7", "Out Group", "Esneper", "Petdubem"].map((l) => (
              <span key={l} className="text-[18px] font-semibold text-[#6A7385]">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pilares (bento blueprint) ───────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-20">
          <div className="max-w-[600px]">
            <h2 className="font-display text-[34px] font-semibold tracking-display text-ink leading-tight">
              Um motor técnico forte.<br />Uma tela simples.
            </h2>
            <p className="mt-3 text-[16px] text-[#4a5159] leading-relaxed">
              A profundidade de uma plataforma de automação, com a simplicidade de arrastar blocos.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border border-line rounded-xl overflow-hidden">
            {PILLARS.map((p, i) => (
              <div
                key={p.title}
                className={`p-6 bg-white ${i < PILLARS.length - 1 ? "border-b md:border-b-0 md:border-r border-hairline" : ""} ${
                  i === 1 ? "md:border-r lg:border-r" : ""
                } hover:bg-surface-subtle transition-colors`}
              >
                <div className="w-9 h-9 rounded-md bg-accent/[0.06] flex items-center justify-center" style={{ boxShadow: "0 0 0 1px rgba(0,48,131,.12)" }}>
                  <p.icon className="w-4 h-4 text-accent" />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{p.title}</h3>
                <p className="mt-1.5 text-[13px] text-[#6A7385] leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Dobra Playbooks (blueprint 3 colunas) ───────── */}
      <section className="relative border-b border-hairline overflow-hidden">
        <IsoCube className="absolute bottom-6 right-8 w-32 hidden lg:block opacity-90" />
        <div className="max-w-[1180px] mx-auto grid grid-cols-1 lg:grid-cols-[340px_1fr]">
          <div className="p-10 lg:p-12 lg:rule-x border-b lg:border-b-0 border-hairline">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-accent">Playbooks</span>
            <h2 className="font-display mt-3 text-[28px] font-semibold tracking-display text-ink leading-tight">
              Seu time inteiro, num fluxo.
            </h2>
            <p className="mt-3 text-[15px] text-[#4a5159] leading-relaxed">
              Cada agente trabalha toda conversa, captura cada sinal e move o cliente adiante —
              roteando pra vendas, suporte ou financeiro automaticamente.
            </p>
            <Link to="/signup" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover">
              Explorar playbooks <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {/* canvas demo */}
          <div className="relative bg-dots p-10 lg:p-12 lg:rule-x min-h-[420px]">
            <div className="flex flex-col items-center gap-5">
              <DemoNode icon={Zap} title="Quando mensagem chega" subtitle="Gatilho" tag="Inbox" color="#8B5CF6" status="completed" trigger />
              <svg width="2" height="24"><line x1="1" y1="0" x2="1" y2="24" stroke="#00D17E" strokeWidth="2" /></svg>
              <DemoNode icon={GitBranch} title="Classifica intenção" subtitle="Decisão" tag="Switch" color="#F5A300" status="completed" />
              <div className="flex items-start gap-6">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium text-[#6A7385] bg-white border border-line rounded-full px-2 py-0.5">Vendas</span>
                  <svg width="2" height="20"><line x1="1" y1="0" x2="1" y2="20" stroke="#00D17E" strokeWidth="2" /></svg>
                  <DemoNode icon={Sparkles} title="Qualifica + cobra" subtitle="LLM + Tier Pay" tag="Pix" color="#003083" status="running" />
                </div>
                <div className="flex flex-col items-center gap-1 opacity-45">
                  <span className="text-[10px] font-medium text-[#6A7385] bg-white border border-line rounded-full px-2 py-0.5">Suporte</span>
                  <svg width="2" height="20"><line x1="1" y1="0" x2="1" y2="20" stroke="#C0C6CF" strokeWidth="1.5" /></svg>
                  <DemoNode icon={ShieldCheck} title="Resolve dúvida" subtitle="Base de conhecimento" tag="RAG" color="#003083" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Métrica ─────────────────────────────────────── */}
      <section className="border-b border-hairline bg-surface-subtle">
        <div className="max-w-[1180px] mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          {[
            { n: "−70%", l: "tempo médio de atendimento" },
            { n: "24/7", l: "sem fila, sem horário" },
            { n: "1 min", l: "do cadastro ao 1º agente no ar" },
          ].map((m) => (
            <div key={m.l}>
              <div className="font-display text-[48px] font-semibold tracking-display text-ink leading-none">{m.n}</div>
              <div className="mt-2 text-[14px] text-[#6A7385]">{m.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Depoimento (serif) ──────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[820px] mx-auto px-6 py-20 text-center">
          <p className="font-serif text-[26px] leading-[1.4] text-ink text-balance">
            “Trocamos um time inteiro de triagem por um agente que nunca perde uma mensagem.
            O cliente nem percebe que não é humano — e a gente dorme tranquilo.”
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-[13px] font-semibold text-accent">MT</div>
            <div className="text-left">
              <div className="text-[14px] font-semibold text-ink">Marcelo Tier</div>
              <div className="text-[12px] text-[#6A7385]">Fundador · Tier</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-20">
          <div className="text-center max-w-[560px] mx-auto">
            <h2 className="font-display text-[34px] font-semibold tracking-display text-ink leading-tight">Preço que cresce com você</h2>
            <p className="mt-3 text-[16px] text-[#4a5159]">Comece grátis. Suba de plano quando o agente provar valor.</p>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-[940px] mx-auto">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`rounded-xl bg-white p-6 flex flex-col ${
                  p.highlight ? "shadow-md border-2 border-accent" : "shadow-sm border border-line"
                }`}
              >
                {p.highlight && (
                  <span className="self-start mb-3 text-[11px] font-semibold uppercase tracking-wide text-accent bg-accent/[0.07] px-2 py-0.5 rounded-full">
                    Mais popular
                  </span>
                )}
                <div className="text-[15px] font-semibold text-ink">{p.name}</div>
                <div className="text-[12px] text-[#6A7385] mt-0.5">{p.tagline}</div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-[14px] text-[#6A7385]">R$</span>
                  <span className="font-display text-[40px] font-semibold tracking-display text-ink leading-none">{p.price}</span>
                  <span className="text-[13px] text-[#6A7385]">/mês</span>
                </div>
                <ul className="mt-5 space-y-2.5 flex-1">
                  {p.feats.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-[#3a3f47]">
                      <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={`mt-6 h-10 inline-flex items-center justify-center rounded-md text-[14px] font-medium transition-colors ${
                    p.highlight ? "bg-cta hover:bg-cta-hover text-white" : "border border-line hover:bg-surface-muted text-ink"
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final (dark) ────────────────────────────── */}
      <section className="bg-cta relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle, #FFFFFF 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-[820px] mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-[clamp(32px,5vw,48px)] font-semibold tracking-display text-white leading-tight text-balance">
            Coloque seu primeiro agente no ar hoje.
          </h2>
          <p className="mt-4 text-[17px] text-white/70 max-w-[520px] mx-auto">
            Sem cartão. Conecte o WhatsApp e veja o agente atender em minutos.
          </p>
          <Link to="/signup" className="mt-8 h-11 px-6 inline-flex items-center gap-2 rounded-md bg-white text-ink text-[15px] font-medium hover:bg-white/90 transition-colors">
            Começar grátis <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="bg-surface-subtle border-t border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-6 w-auto" />
          </div>
          <div className="flex items-center gap-6 text-[13px] text-[#6A7385]">
            <a href="https://tier.finance" className="hover:text-ink transition-colors">tier.finance</a>
            <Link to="/login" className="hover:text-ink transition-colors">Entrar</Link>
            <span>© 2026 Tier</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

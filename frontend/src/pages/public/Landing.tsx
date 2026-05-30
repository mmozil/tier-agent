import { lazy, Suspense } from "react";
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

import { MarketingNav, MarketingFooter, FinalCTA, FlowNode, FlowEdge, BranchSplit } from "../../components/landing/marketing";
import PlaybookDemo from "../../components/landing/PlaybookDemo";
import AgentResearchDemo from "../../components/landing/AgentResearchDemo";
import { motion } from "framer-motion";
import { StaggerIn, Item, Reveal } from "../../components/landing/motion";
import { BorderBeam, Spotlight, GridFade } from "../../components/landing/effects";

// Globo WebGL (three.js) — lazy p/ não pesar o bundle inicial
const ScaleGlobe = lazy(() => import("../../components/landing/ScaleGlobe"));

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

const PILLARS = [
  { icon: MessagesSquare, title: "Atende em qualquer canal", desc: "WhatsApp, Instagram, Telegram, e-mail e widget web — uma persona, todos os canais." },
  { icon: GitBranch, title: "Playbooks visuais", desc: "Desenhe fluxos arrastando blocos. Gatilho, decisão, IA, cobrança, hand-off humano." },
  { icon: BrainCircuit, title: "Memória que cresce", desc: "Lembra de cada contato entre sessões. Quanto mais usa, mais o agente entende." },
  { icon: Sparkles, title: "Responde dos seus dados", desc: "RAG real com citação de fonte. PDFs, planilhas e catálogos viram conhecimento." },
];

const PRICING = [
  { name: "Lite", price: "99", tagline: "Pra começar a automatizar", feats: ["1 agente", "Playbooks até 3 fluxos", "WhatsApp + templates BR", "Memória 7 dias"], cta: "Assinar Lite", highlight: false },
  { name: "Pro", price: "199", tagline: "Pro time que escala", feats: ["Multi-agente + specialists", "RAG + memória 30 dias", "Voz (áudio E2E)", "Multicanal completo"], cta: "Assinar Pro", highlight: true },
  { name: "Business", price: "899", tagline: "Operação completa", feats: ["Tudo do Pro, ilimitado", "Guardrails + CodeAct", "Skills auto-evolutivas", "Marketplace + A/B testing"], cta: "Falar com vendas", highlight: false },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      {/* ── Nav (chrome compartilhado) ──────────────────── */}
      <MarketingNav />

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-hairline">
        <GridFade className="opacity-60" />
        <Spotlight className="left-1/2 -translate-x-1/2 top-[4%] w-[860px] h-[500px]" />
        {/* margens hachuradas */}
        <div className="absolute inset-y-0 left-0 w-8 hatch hidden lg:block" />
        <div className="absolute inset-y-0 right-0 w-8 hatch hidden lg:block" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-16 pb-16 text-center">
          <StaggerIn>
            {/* barra de anúncio (estilo Attio) */}
            <Item>
              <Link
                to="/recursos#inteligencia"
                className="group inline-flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-full bg-white border border-line shadow-[0_1px_2px_rgba(13,15,17,.05)] text-[12.5px] text-[#3a3f47] hover:border-line-strong transition-colors"
              >
                <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-accent/[0.08] text-accent text-[11px] font-semibold">Novo</span>
                Voz em PT-BR + WhatsApp oficial
                <ArrowRight className="w-3.5 h-3.5 text-[#9AA4B2] transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Item>
            <Item>
              <h1 className="font-display text-balance mt-7 text-[clamp(42px,6.2vw,72px)] font-semibold leading-[1.0] tracking-display text-ink">
                Seu atendimento no<br className="hidden sm:block" /> piloto automático.
              </h1>
            </Item>
            <Item>
              <p className="mt-6 text-[18px] leading-relaxed text-[#4a5159] max-w-[600px] mx-auto text-balance">
                Agentes de IA que conversam, qualificam e cobram em qualquer canal — lembram de
                cada cliente e chamam um humano só quando precisa.
              </p>
            </Item>
            <Item>
              <div className="mt-8 flex items-center justify-center gap-2.5">
                <Link to="/signup" className="h-11 px-5 inline-flex items-center gap-2 rounded-[10px] bg-cta hover:bg-cta-hover text-white text-[15px] font-semibold shadow-[0_1px_2px_rgba(13,15,17,.18)] transition-colors">
                  Começar agora <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/plataforma" className="h-11 px-5 inline-flex items-center rounded-[10px] border border-line bg-white hover:bg-surface-muted text-ink text-[15px] font-medium transition-colors">
                  Ver demonstração
                </Link>
              </div>
            </Item>
          </StaggerIn>

          {/* tela do builder — sobe com fade ao carregar + border beam */}
          <motion.div
            className="mt-16 relative max-w-[1040px] mx-auto"
            initial={{ opacity: 0, y: 40, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
          >
            <BorderBeam from="#003083" to="#38BDF8" duration={9}>
              <PlaybookDemo />
            </BorderBeam>
          </motion.div>
        </div>
      </section>

      {/* ── Logos ───────────────────────────────────────── */}
      <section id="prova" className="scroll-mt-20 border-b border-hairline bg-surface-subtle">
        <div className="max-w-[1180px] mx-auto px-6 py-8">
          <p className="text-center text-[12px] font-semibold uppercase tracking-wide text-[#9AA4B2] mb-5">
            Empresas que já automatizam com a Tier
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-5">
            {[
              { name: "Kirvah", ini: "K" },
              { name: "Hovio", ini: "H" },
              { name: "M7", ini: "M7" },
              { name: "Out Group", ini: "OG" },
              { name: "Esneper", ini: "E" },
              { name: "Petdubem", ini: "P" },
            ].map((b) => (
              <div key={b.name} className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
                <span className="w-7 h-7 rounded-[7px] bg-[#6A7385]/[0.1] text-[#6A7385] text-[10.5px] font-bold flex items-center justify-center shrink-0">
                  {b.ini}
                </span>
                <span className="text-[16px] font-semibold text-[#6A7385] tracking-[-0.01em]">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pilares (bento blueprint) ───────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-20">
          <Reveal className="max-w-[600px]">
            <h2 className="font-display text-[34px] font-semibold tracking-display text-ink leading-tight">
              Um motor técnico forte.<br />Uma tela simples.
            </h2>
            <p className="mt-3 text-[16px] text-[#4a5159] leading-relaxed">
              A profundidade de uma plataforma de automação, com a simplicidade de arrastar blocos.
            </p>
          </Reveal>
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
            <div className="flex flex-col items-center">
              <FlowNode icon={Zap} title="Mensagem recebida" subtitle="Gatilho · inbox" tag="Inbox" color="#8B5CF6" status="completed" trigger />
              <FlowEdge active />
              <FlowNode icon={GitBranch} title="Classifica intenção" subtitle="Decisão · IA" tag="Switch" color="#F5A300" status="completed" />
              <BranchSplit leftLabel="Vendas" rightLabel="Suporte" activeRight={false} />
              <div className="flex items-start gap-8">
                <FlowNode icon={Sparkles} title="Qualifica + cobra" subtitle="LLM + Tier Pay" tag="Pix" color="#003083" status="running" />
                <FlowNode icon={ShieldCheck} title="Resolve dúvida" subtitle="Base de conhecimento" tag="RAG" color="#003083" dim />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pesquisa IA (o agente já chega sabendo) ─────── */}
      <section className="relative border-b border-hairline overflow-hidden">
        <div className="max-w-[1180px] mx-auto grid grid-cols-1 lg:grid-cols-[340px_1fr]">
          <div className="p-10 lg:p-12 lg:rule-x border-b lg:border-b-0 border-hairline">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-accent">Inteligência</span>
            <h2 className="font-display mt-3 text-[28px] font-semibold tracking-display text-ink leading-tight">
              Já chega sabendo do cliente.
            </h2>
            <p className="mt-3 text-[15px] text-[#4a5159] leading-relaxed">
              Quando a mensagem chega, o agente já levantou quem é o cliente, o histórico e a oportunidade —
              e responde com a fonte, sem inventar.
            </p>
            <Link to="/recursos#inteligencia" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover">
              Explorar inteligência <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="relative bg-dots p-10 lg:p-12 lg:rule-x min-h-[440px]">
            <AgentResearchDemo />
          </div>
        </div>
      </section>

      {/* ── Escala multicanal (globo WebGL) ─────────────── */}
      <section className="relative border-b border-hairline overflow-hidden">
        <div className="absolute inset-0 bg-dots opacity-40" />
        <div className="absolute inset-y-0 left-0 w-8 hatch hidden lg:block" />
        <div className="absolute inset-y-0 right-0 w-8 hatch hidden lg:block" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-16 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <h2 className="font-display text-[clamp(30px,4.4vw,52px)] font-semibold tracking-display text-ink leading-[1.04] max-w-[680px]">
              Escale rápido —<br className="hidden sm:block" /> em qualquer canal.
            </h2>
            <Link
              to="/signup"
              className="group shrink-0 h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md bg-cta hover:bg-cta-hover text-white text-[13px] font-medium uppercase tracking-wide transition-colors"
            >
              Conectar canais
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-[3px]" />
            </Link>
          </div>
          <p className="mt-4 text-[16px] leading-relaxed text-[#4a5159] max-w-[560px]">
            WhatsApp, Instagram, Telegram e e-mail convergem num único agente. Ele atende
            milhares de conversas ao mesmo tempo e roteia pra um humano só quando precisa.
          </p>
        </div>

        {/* globo */}
        <div className="relative h-[440px] sm:h-[500px]">
          <Suspense
            fallback={<div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#9AA4B2]">Carregando visualização…</div>}
          >
            <ScaleGlobe />
          </Suspense>
        </div>

        {/* duas colunas (Tier Cloud / multicanal) */}
        <div className="relative max-w-[1180px] mx-auto grid grid-cols-1 md:grid-cols-2 border-t border-hairline">
          <div className="p-8 lg:p-10 md:border-r border-hairline">
            <h3 className="text-[17px] font-semibold text-ink">Um número, todos os canais</h3>
            <p className="mt-2 text-[14px] text-[#4a5159] leading-relaxed">
              Conecte cada canal uma vez. A persona, a memória e os playbooks são os mesmos —
              o cliente fala onde quiser e o agente nunca perde o contexto.
            </p>
            <Link to="/signup" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover">
              Ver canais <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="p-8 lg:p-10 border-t md:border-t-0 border-hairline">
            <h3 className="text-[17px] font-semibold text-ink">Escala sem fila</h3>
            <p className="mt-2 text-[14px] text-[#4a5159] leading-relaxed">
              Picos de demanda não derrubam o atendimento. O agente responde em paralelo,
              prioriza o que é urgente e escala pra equipe humana com todo o histórico.
            </p>
            <Link to="/signup" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover">
              Como funciona <ArrowRight className="w-3.5 h-3.5" />
            </Link>
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
            <p className="mt-3 text-[16px] text-[#4a5159]">Escolha um plano. Suba quando o agente provar valor.</p>
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
      <FinalCTA />

      {/* ── Footer (chrome compartilhado) ───────────────── */}
      <MarketingFooter />
    </div>
  );
}

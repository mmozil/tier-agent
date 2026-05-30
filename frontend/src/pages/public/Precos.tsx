import { Link } from "react-router-dom";
import { Check, Minus, ArrowRight } from "lucide-react";
import { MarketingNav, MarketingFooter, FinalCTA } from "../../components/landing/marketing";

/* Tier Agent — /precos · planos + comparativo + FAQ (Attio-grade) */

const PLANS = [
  {
    name: "Lite",
    price: "99",
    tagline: "Pra começar a automatizar",
    cta: "Começar grátis",
    highlight: false,
    feats: ["1 agente", "Playbooks até 3 fluxos", "WhatsApp + templates BR", "Memória 7 dias", "Captura de lead + hand-off"],
  },
  {
    name: "Pro",
    price: "199",
    tagline: "Pro time que escala",
    cta: "Assinar Pro",
    highlight: true,
    feats: ["Multi-agente + specialists", "RAG + memória 30 dias", "Voz (áudio E2E)", "Multicanal completo", "Cron + marketplace de templates"],
  },
  {
    name: "Business",
    price: "899",
    tagline: "Operação completa",
    cta: "Falar com vendas",
    highlight: false,
    feats: ["Tudo do Pro, ilimitado", "Guardrails + CodeAct", "Skills auto-evolutivas", "A/B testing de prompts", "Auditoria + SLA"],
  },
];

type Row = { label: string; lite: string | boolean; pro: string | boolean; business: string | boolean };
const MATRIX: { group: string; rows: Row[] }[] = [
  {
    group: "Atendimento",
    rows: [
      { label: "Agentes", lite: "1", pro: "Multi", business: "Ilimitado" },
      { label: "Canais", lite: "WhatsApp", pro: "Todos", business: "Todos" },
      { label: "Captura de lead", lite: true, pro: true, business: true },
      { label: "Hand-off humano", lite: true, pro: true, business: true },
      { label: "Inbox de conversas", lite: true, pro: true, business: true },
    ],
  },
  {
    group: "Inteligência",
    rows: [
      { label: "Memória do contato", lite: "7 dias", pro: "30 dias", business: "Ilimitada" },
      { label: "Visão (fotos)", lite: true, pro: true, business: true },
      { label: "Voz (áudio E2E)", lite: false, pro: true, business: true },
      { label: "RAG com citação", lite: false, pro: true, business: true },
      { label: "MCP client", lite: false, pro: true, business: true },
    ],
  },
  {
    group: "Automação",
    rows: [
      { label: "Playbooks", lite: "3 fluxos", pro: "Ilimitados", business: "Ilimitados" },
      { label: "Specialist routing", lite: false, pro: true, business: true },
      { label: "Agendamento (cron)", lite: false, pro: true, business: true },
      { label: "Marketplace de templates", lite: false, pro: true, business: true },
      { label: "CodeAct + skills auto", lite: false, pro: false, business: true },
    ],
  },
  {
    group: "Governança",
    rows: [
      { label: "Redação de PII", lite: true, pro: true, business: true },
      { label: "Métricas de custo", lite: true, pro: true, business: true },
      { label: "Guardrails", lite: false, pro: true, business: true },
      { label: "A/B testing", lite: false, pro: false, business: true },
      { label: "Trilha de auditoria", lite: false, pro: false, business: true },
    ],
  },
];

const FAQ = [
  { q: "Preciso de cartão pra começar?", a: "Não. Você cria a conta, conecta o WhatsApp e coloca um agente no ar no plano de entrada sem cartão." },
  { q: "Como funciona o WhatsApp?", a: "Usamos a API Cloud oficial da Meta. Você conecta o seu próprio número via login do Facebook — sem risco de ban e sem número compartilhado." },
  { q: "Posso trocar de plano depois?", a: "Sim, a qualquer momento. O upgrade libera os recursos na hora; o downgrade vale no próximo ciclo." },
  { q: "Quem paga as mensagens de marketing?", a: "O atendimento reativo é livre. Disparos de marketing são cobrados pela Meta na sua própria conta WhatsApp — a Tier não entra nesse custo." },
  { q: "Meus dados ficam seguros?", a: "Cada cliente roda num ambiente isolado, dados sensíveis são mascarados antes de ir pro modelo e tudo fica registrado em auditoria." },
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="w-4 h-4 text-success mx-auto" />;
  if (v === false) return <Minus className="w-4 h-4 text-[#C0C6CF] mx-auto" />;
  return <span className="text-[13px] text-[#3a3f47]">{v}</span>;
}

export default function Precos() {
  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      <MarketingNav />

      {/* Hero + cards */}
      <section className="relative overflow-hidden border-b border-hairline">
        <div className="absolute inset-0 bg-dots-lg opacity-40" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-20 pb-16">
          <div className="text-center max-w-[600px] mx-auto">
            <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-surface-muted border border-line text-[12px] font-medium text-[#3a3f47]">
              <span className="w-1.5 h-1.5 rounded-full bg-success" /> Preço transparente
            </span>
            <h1 className="font-display text-balance mt-6 text-[clamp(36px,5.5vw,56px)] font-semibold leading-[1.04] tracking-display text-ink">
              Preço que cresce com você
            </h1>
            <p className="mt-4 text-[17px] text-[#4a5159]">
              Comece grátis. Suba de plano quando o agente provar valor. Sem fidelidade.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-[940px] mx-auto">
            {PLANS.map((p) => (
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

      {/* Tabela comparativa */}
      <section className="border-b border-hairline">
        <div className="max-w-[1000px] mx-auto px-6 py-20">
          <h2 className="font-display text-[30px] font-semibold tracking-display text-ink leading-tight text-center">
            Compare os planos
          </h2>
          <div className="mt-10 border border-line rounded-xl overflow-hidden">
            {/* header sticky */}
            <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] bg-surface-muted border-b border-line">
              <div className="px-5 py-3.5 text-[12px] font-semibold uppercase tracking-wide text-[#6A7385]">Recurso</div>
              {["Lite", "Pro", "Business"].map((h) => (
                <div key={h} className="px-3 py-3.5 text-center text-[13px] font-semibold text-ink">
                  {h}
                </div>
              ))}
            </div>
            {MATRIX.map((sec) => (
              <div key={sec.group}>
                <div className="grid grid-cols-1 bg-surface-subtle border-b border-hairline">
                  <div className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-accent">{sec.group}</div>
                </div>
                {sec.rows.map((r, i) => (
                  <div
                    key={r.label}
                    className={`grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center hover:bg-surface-subtle transition-colors ${
                      i < sec.rows.length - 1 ? "border-b border-hairline" : "border-b border-hairline"
                    }`}
                  >
                    <div className="px-5 py-3 text-[13px] text-[#3a3f47]">{r.label}</div>
                    <div className="px-3 py-3 text-center"><Cell v={r.lite} /></div>
                    <div className="px-3 py-3 text-center"><Cell v={r.pro} /></div>
                    <div className="px-3 py-3 text-center"><Cell v={r.business} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-hairline">
        <div className="max-w-[820px] mx-auto px-6 py-20">
          <h2 className="font-display text-[30px] font-semibold tracking-display text-ink leading-tight text-center">
            Perguntas frequentes
          </h2>
          <div className="mt-10 divide-y divide-hairline border-t border-hairline">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-[15px] font-semibold text-ink pr-6">{f.q}</span>
                  <span className="text-[#9AA4B2] text-[20px] leading-none group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-[14px] text-[#6A7385] leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              to="/recursos"
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover"
            >
              Ver tudo que o agente faz <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <FinalCTA title="Comece no plano grátis." subtitle="Suba pra Pro quando o agente provar valor. Sem fidelidade, sem cartão." />
      <MarketingFooter />
    </div>
  );
}

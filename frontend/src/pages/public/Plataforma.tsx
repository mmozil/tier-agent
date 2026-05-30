import { Link } from "react-router-dom";
import {
  MessageCircle,
  Cpu,
  Send,
  GitBranch,
  MessagesSquare,
  ShieldCheck,
  Database,
  Layers,
  ArrowRight,
} from "lucide-react";
import { MarketingNav, MarketingFooter, FinalCTA, IsoCube } from "../../components/landing/marketing";
import PlaybookDemo from "../../components/landing/PlaybookDemo";

/* Tier Agent — /plataforma · como funciona (Attio-grade blueprint) */

const STEPS = [
  {
    icon: MessageCircle,
    n: "01",
    title: "O cliente fala",
    desc: "A mensagem chega por WhatsApp, Instagram, Telegram, e-mail ou widget — texto, áudio ou foto. O agente reconhece o canal e o contato.",
  },
  {
    icon: Cpu,
    n: "02",
    title: "O agente decide",
    desc: "Sua persona + memória + base de conhecimento alimentam o modelo. Guardrails e redação de PII rodam antes. O playbook escolhe o próximo passo.",
  },
  {
    icon: Send,
    n: "03",
    title: "A ação acontece",
    desc: "Responde, qualifica o lead, gera um Pix, agenda follow-up ou passa pra um humano — com timing natural e tudo registrado.",
  },
];

const DEEP = [
  {
    icon: GitBranch,
    label: "Builder",
    title: "Playbooks num canvas",
    desc: "Arraste blocos de gatilho, decisão, IA, integração e hand-off. Veja o caminho da execução acender em verde ao vivo — sem escrever código.",
    to: "/recursos#automacao",
  },
  {
    icon: MessagesSquare,
    label: "Canais",
    title: "Um agente, todos os canais",
    desc: "Conecte cada canal uma vez. A persona, a memória e os fluxos são os mesmos — o cliente fala onde quiser e o contexto nunca se perde.",
    to: "/recursos#atendimento",
  },
  {
    icon: Database,
    label: "Conhecimento",
    title: "Responde dos seus dados",
    desc: "Suba PDFs, planilhas e catálogos. O RAG recupera o trecho certo e responde com a fonte — nada de inventar.",
    to: "/recursos#inteligencia",
  },
  {
    icon: ShieldCheck,
    label: "Governança",
    title: "Seguro por padrão",
    desc: "Guardrails contra injeção de prompt, PII mascarada antes do modelo, teto de gasto por plano e trilha de auditoria completa.",
    to: "/recursos#governanca",
  },
];

export default function Plataforma() {
  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-hairline">
        <div className="absolute inset-0 bg-dots-lg opacity-50" />
        <div className="absolute inset-y-0 left-0 w-8 hatch hidden lg:block" />
        <div className="absolute inset-y-0 right-0 w-8 hatch hidden lg:block" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-20 pb-16">
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-surface-muted border border-line text-[12px] font-medium text-[#3a3f47]">
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Como funciona
          </span>
          <h1 className="font-display text-balance mt-6 text-[clamp(36px,5.5vw,60px)] font-semibold leading-[1.04] tracking-display text-ink max-w-[820px]">
            Da mensagem à ação,<br className="hidden sm:block" /> em um motor só.
          </h1>
          <p className="mt-5 text-[18px] leading-relaxed text-[#4a5159] max-w-[640px]">
            O Tier Agent ouve o cliente, entende o contexto e executa o próximo passo — atender, vender,
            cobrar ou escalar. Você desenha a lógica; a plataforma roda o resto.
          </p>
        </div>
      </section>

      {/* 3 passos */}
      <section className="border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 border border-line rounded-xl overflow-hidden">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className={`p-8 bg-white ${i < STEPS.length - 1 ? "border-b md:border-b-0 md:border-r border-hairline" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="w-10 h-10 rounded-md bg-accent/[0.06] flex items-center justify-center"
                    style={{ boxShadow: "0 0 0 1px rgba(0,48,131,.12)" }}
                  >
                    <s.icon className="w-5 h-5 text-accent" />
                  </div>
                  <span className="font-display text-[28px] font-semibold tracking-display text-[#E4E7EC] leading-none">
                    {s.n}
                  </span>
                </div>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-[14px] text-[#6A7385] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Canvas em destaque (blueprint 2 colunas) */}
      <section className="relative border-b border-hairline overflow-hidden">
        <IsoCube className="absolute bottom-6 right-8 w-32 hidden lg:block opacity-90" />
        <div className="max-w-[1180px] mx-auto grid grid-cols-1 lg:grid-cols-[360px_1fr]">
          <div className="p-10 lg:p-12 lg:rule-x border-b lg:border-b-0 border-hairline">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-accent">Playbook engine</span>
            <h2 className="font-display mt-3 text-[28px] font-semibold tracking-display text-ink leading-tight">
              A lógica que você desenha, executada ao vivo.
            </h2>
            <p className="mt-3 text-[15px] text-[#4a5159] leading-relaxed">
              Cada bloco é um passo: gatilho, classificação, IA, integração, cobrança ou hand-off. O caminho
              percorrido acende em verde e cada nó mostra seu status em tempo real.
            </p>
            <Link
              to="/recursos#automacao"
              className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover"
            >
              Ver todos os blocos <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="relative bg-dots px-6 py-10 lg:rule-x flex items-center justify-center">
            <PlaybookDemo />
          </div>
        </div>
      </section>

      {/* Deep dives */}
      <section className="border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-6 py-20">
          <div className="max-w-[600px]">
            <h2 className="font-display text-[34px] font-semibold tracking-display text-ink leading-tight">
              Quatro camadas, um sistema.
            </h2>
            <p className="mt-3 text-[16px] text-[#4a5159] leading-relaxed">
              Builder, canais, conhecimento e governança compartilham a mesma base. Você liga uma vez e tudo
              conversa entre si.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 border border-line rounded-xl overflow-hidden">
            {DEEP.map((d, i) => (
              <Link
                key={d.title}
                to={d.to}
                className={`group p-8 bg-white hover:bg-surface-subtle transition-colors ${
                  i % 2 === 0 ? "md:border-r border-hairline" : ""
                } ${i < DEEP.length - 2 ? "border-b border-hairline" : ""}`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-md bg-accent/[0.06] flex items-center justify-center"
                    style={{ boxShadow: "0 0 0 1px rgba(0,48,131,.12)" }}
                  >
                    <d.icon className="w-4 h-4 text-accent" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA4B2]">{d.label}</span>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold text-ink flex items-center gap-1.5">
                  {d.title}
                  <ArrowRight className="w-4 h-4 text-accent opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </h3>
                <p className="mt-2 text-[14px] text-[#6A7385] leading-relaxed">{d.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Faixa stack */}
      <section className="border-b border-hairline bg-surface-subtle">
        <div className="max-w-[1180px] mx-auto px-6 py-14">
          <div className="flex items-center gap-3 mb-6">
            <Layers className="w-4 h-4 text-[#9AA4B2]" />
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[#9AA4B2]">
              Infraestrutura que aguenta produção
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { t: "Multi-tenant isolado", d: "Cada cliente tem seu ambiente dedicado — dados e configuração nunca se misturam." },
              { t: "Modelo configurável", d: "Troque o provedor de IA e os parâmetros sem mexer no código. Tudo no painel." },
              { t: "WhatsApp oficial", d: "API Cloud da Meta — sem risco de ban. O cliente conecta o próprio número." },
            ].map((x) => (
              <div key={x.t}>
                <h3 className="text-[15px] font-semibold text-ink">{x.t}</h3>
                <p className="mt-1.5 text-[13px] text-[#6A7385] leading-relaxed">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FinalCTA title="Veja o motor rodando." subtitle="Conecte o WhatsApp e coloque um agente no ar em minutos." />
      <MarketingFooter />
    </div>
  );
}

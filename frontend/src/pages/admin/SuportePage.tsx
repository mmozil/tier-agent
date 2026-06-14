import { Mail, MessageCircle, BookOpen, ExternalLink } from "lucide-react";

import { FC, PageFrame, Row, HairCells } from "@/components/ds/fc";

interface Channel {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  href: string;
  cta: string;
}

const CHANNELS: Channel[] = [
  {
    icon: Mail,
    title: "E-mail",
    desc: "Resposta em até 1 dia útil. Bom pra dúvidas técnicas e relatos de bug.",
    href: "mailto:help@tier.finance?subject=Suporte%20Tier%20Agent",
    cta: "help@tier.finance",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp",
    desc: "Atendimento Mon-Fri 9h-18h. Pra urgências e onboarding ao vivo.",
    href: "https://wa.me/5511999999999?text=Olá%20Tier%20Agent",
    cta: "Falar no WhatsApp",
  },
  {
    icon: BookOpen,
    title: "Documentação",
    desc: "Guias passo a passo, integrações por canal e melhores práticas de persona.",
    href: "https://tier.finance/agent/docs",
    cta: "Abrir docs",
  },
];

export default function SuportePage() {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Suporte</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Como podemos te ajudar a tirar o máximo do Tier Agent.</p>
          </div>
        </Row>

        <Row>
          <HairCells cols={3}>
            {CHANNELS.map((c) => (
              <a
                key={c.title}
                href={c.href}
                target={c.href.startsWith("http") ? "_blank" : undefined}
                rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className={`block p-6 transition-colors group ${FC.hover}`}
              >
                <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center mb-3">
                  <c.icon className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" />
                </div>
                <div className={`text-[14px] font-medium mb-1 ${FC.ink}`}>{c.title}</div>
                <p className={`text-[13px] leading-relaxed mb-4 ${FC.sub}`}>{c.desc}</p>
                <div className="flex items-center gap-1 text-[13px] font-medium text-[#003083] dark:text-[#5b9bff] group-hover:opacity-80">
                  {c.cta}
                  {c.href.startsWith("http") && <ExternalLink className="w-3 h-3" />}
                </div>
              </a>
            ))}
          </HairCells>
        </Row>

        <Row last>
          <div className="p-6">
            <h3 className={`text-[16px] font-[450] tracking-[-0.1px] mb-1 ${FC.ink}`}>Sobre o Tier Agent</h3>
            <p className={`text-[13px] leading-relaxed ${FC.sub}`}>
              Plataforma de agentes IA configuráveis. Cada agente roda em um container isolado, aprende com as conversas
              e age via WhatsApp, e-mail, web e mais. Suporte 24/7 sem trocar de ferramenta.
            </p>
            {/* caption 12px legível: sub (56%) em vez de mut (40%) */}
            <div className={`mt-3 text-[12px] ${FC.sub}`}>
              Versão · MVP · agent.tier.finance · © {new Date().getFullYear()} Tier Finance
            </div>
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

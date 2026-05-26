import { Mail, MessageCircle, BookOpen, ExternalLink } from "lucide-react";

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
    <div>
      <h1 className="text-[28px] font-bold text-[#30313d] mt-6 mb-2">Suporte</h1>
      <p className="text-[14px] text-[#697386] mb-6">Como podemos te ajudar a tirar o máximo do Tier Agent.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {CHANNELS.map((c) => (
          <a
            key={c.title}
            href={c.href}
            target={c.href.startsWith("http") ? "_blank" : undefined}
            rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="bg-white rounded-md p-5 shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow group"
          >
            <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] flex items-center justify-center mb-3">
              <c.icon className="w-[18px] h-[18px] text-[#003083]" />
            </div>
            <div className="text-[14px] font-semibold text-[#1a2c44] mb-1">{c.title}</div>
            <p className="text-[13px] text-[#697386] leading-relaxed mb-4">{c.desc}</p>
            <div className="flex items-center gap-1 text-[13px] font-medium text-[#003083] group-hover:text-[#002266]">
              {c.cta}
              {c.href.startsWith("http") && <ExternalLink className="w-3 h-3" />}
            </div>
          </a>
        ))}
      </div>

      <div className="mt-8 bg-[#f4f7fa] rounded-lg p-4">
        <div className="bg-white rounded-md px-6 py-5">
          <h3 className="text-[14px] font-medium text-[#1a2c44] mb-1">Sobre o Tier Agent</h3>
          <p className="text-[13px] text-[#697386] leading-relaxed">
            Plataforma de agentes IA configuráveis. Cada agente roda em um container isolado,
            aprende com as conversas e age via WhatsApp, e-mail, web e mais. Suporte 24/7
            sem trocar de ferramenta.
          </p>
          <div className="mt-3 text-[12px] text-[#697386]">
            Versão · MVP · agent.tier.finance · © {new Date().getFullYear()} Tier Finance
          </div>
        </div>
      </div>
    </div>
  );
}

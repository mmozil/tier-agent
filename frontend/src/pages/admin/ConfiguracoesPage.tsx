import { Link } from "react-router-dom";
import {
  Cpu,
  ToggleLeft,
  Sliders,
  Plug,
  BookOpen,
  CreditCard,
  ChevronRight,
} from "lucide-react";

import { FC, PageFrame, Row } from "@/components/ds/fc";

interface CardItem {
  to: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: { label: string; items: CardItem[] }[] = [
  {
    label: "Configuração",
    items: [
      { to: "/admin/llm", title: "LLM Providers", desc: "Cadastre chaves de API (Gemini, Claude, GPT) e modelos default por tenant.", icon: Cpu },
      { to: "/admin/features", title: "Feature Flags", desc: "Liga/desliga capacidades por escopo (global / tenant / agente).", icon: ToggleLeft },
      { to: "/admin/params", title: "Parâmetros", desc: "Tuning runtime de RAG, memória, cron, budget e limites por SKU.", icon: Sliders },
    ],
  },
  {
    label: "Integrações",
    items: [
      { to: "/admin/canais", title: "Canais", desc: "Conectar WhatsApp Tier Engine, Telegram, e-mail, web widget.", icon: Plug },
      { to: "/admin/knowledge", title: "Knowledge", desc: "PDFs, planilhas e URLs que viram skills consultáveis pelo agente.", icon: BookOpen },
    ],
  },
  {
    label: "Conta",
    items: [
      { to: "/admin/cobranca", title: "Cobrança", desc: "Assinatura, faturas Tier Pay e consumo do mês.", icon: CreditCard },
    ],
  },
];

export default function ConfiguracoesPage() {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Configurações</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Tudo que controla o comportamento dos seus agentes.</p>
          </div>
        </Row>

        {SECTIONS.map((section, si) => (
          <Row key={section.label} last={si === SECTIONS.length - 1}>
            <div className="p-6">
              {/* label 11px uppercase legível: sub (56%) em vez de mut (40%) */}
              <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${FC.sub}`}>{section.label}</h3>
              <div className={`divide-y ${FC.hair} border ${FC.hair} rounded-lg overflow-hidden`}>
                {section.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`group flex items-center px-4 py-3.5 transition-colors ${FC.hover}`}
                  >
                    <item.icon className={`w-[18px] h-[18px] shrink-0 ${FC.mut}`} />
                    <div className="flex-1 ml-3">
                      <div className={`text-[14px] font-medium ${FC.ink}`}>{item.title}</div>
                      <div className={`text-[12px] mt-0.5 ${FC.sub}`}>{item.desc}</div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${FC.mut} group-hover:text-[#262626] dark:group-hover:text-white transition-colors`} />
                  </Link>
                ))}
              </div>
            </div>
          </Row>
        ))}
      </PageFrame>
    </div>
  );
}

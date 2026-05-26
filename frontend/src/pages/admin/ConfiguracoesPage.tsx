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
    <div>
      <h1 className="text-[28px] font-bold text-[#30313d] mt-6 mb-2">Configurações</h1>
      <p className="text-[14px] text-[#697386] mb-6">Tudo que controla o comportamento dos seus agentes.</p>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#697386] mb-2">
              {section.label}
            </h2>
            <div className="bg-[#f4f7fa] rounded-lg p-3">
              <div className="bg-white rounded-md divide-y divide-slate-100">
                {section.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="w-full flex items-center px-5 py-4 hover:bg-slate-50 transition-colors group"
                  >
                    <item.icon className="w-[18px] h-[18px] text-[#697386] shrink-0" />
                    <div className="flex-1 ml-3">
                      <div className="text-[14px] font-medium text-[#1a2c44]">{item.title}</div>
                      <div className="text-[12px] text-[#697386] mt-0.5">{item.desc}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { Headphones, ShoppingCart, Wallet, Workflow, Bot, Plug, BookOpen, BarChart3 } from "lucide-react";

import { FC, PageFrame, Row, HairCells } from "@/components/ds/fc";

const FEATURES = [
  { icon: Headphones, title: "Atender", desc: "Responde clientes em qualquer canal, 24/7.", to: "/admin/conversas" },
  { icon: ShoppingCart, title: "Vender", desc: "Qualifica e fecha a venda dentro da conversa.", to: "/admin/playbooks", badge: "NOVO" },
  { icon: Wallet, title: "Cobrar", desc: "Gera Pix e link de pagamento no chat.", to: "/admin/cobranca" },
  { icon: Workflow, title: "Automatizar", desc: "Playbooks visuais que rodam sozinhos.", to: "/admin/playbooks" },
];

const START = [
  { icon: Bot, title: "Criar um agente", desc: "Defina persona, modelo e canais.", to: "/admin/agentes" },
  { icon: Plug, title: "Conectar um canal", desc: "WhatsApp, Telegram, e-mail, web.", to: "/admin/canais" },
  { icon: BookOpen, title: "Subir conhecimento", desc: "PDFs e planilhas viram skills.", to: "/admin/knowledge" },
  { icon: BarChart3, title: "Ver métricas", desc: "Custo, latência e uso por agente.", to: "/admin/metricas" },
];

export default function VisaoGeralPage() {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Visão geral</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>O que dá pra fazer com seus agentes.</p>
          </div>
        </Row>

        <Row>
          <HairCells cols={4} gridLines>
            {FEATURES.map((f) => (
              <Link key={f.title} to={f.to} className={`block h-full p-6 transition-colors ${FC.hover}`}>
                <f.icon className={`w-4 h-4 ${FC.mut}`} />
                <div className="mt-3 flex items-center gap-2">
                  <span className={`text-[16px] font-normal leading-6 ${FC.ink}`}>{f.title}</span>
                  {f.badge && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-white bg-[#003083] dark:bg-[#5b9bff] dark:text-[#0c0e12]">{f.badge}</span>
                  )}
                </div>
                <p className={`mt-1 text-[13px] leading-[21px] ${FC.sub}`}>{f.desc}</p>
              </Link>
            ))}
          </HairCells>
        </Row>

        <Row>
          <div className="px-6 pt-5 pb-1">
            <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Comece por aqui</h3>
          </div>
        </Row>

        <Row last>
          <HairCells cols={4} gridLines>
            {START.map((s) => (
              <Link key={s.title} to={s.to} className={`block h-full p-6 transition-colors ${FC.hover}`}>
                <s.icon className={`w-4 h-4 ${FC.mut}`} />
                <div className={`mt-3 text-[14px] font-medium ${FC.ink}`}>{s.title}</div>
                <p className={`mt-1 text-[12.5px] leading-[19px] ${FC.sub}`}>{s.desc}</p>
              </Link>
            ))}
          </HairCells>
        </Row>
      </PageFrame>
    </div>
  );
}

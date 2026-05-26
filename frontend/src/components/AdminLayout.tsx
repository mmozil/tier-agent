import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Cpu,
  ToggleLeft,
  Users,
  Sliders,
  BarChart3,
  CreditCard,
  Bot,
  MessageSquare,
  Plug,
  BookOpen,
  Workflow,
  Search,
  HelpCircle,
  Bell,
  Settings,
} from "lucide-react";

import UserMenu from "./UserMenu";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { to: "/admin/agentes", label: "Agentes", icon: Bot },
      { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/admin/playbooks", label: "Playbooks", icon: Workflow },
      { to: "/admin/canais", label: "Canais", icon: Plug },
      { to: "/admin/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Configuração",
    items: [
      { to: "/admin/llm", label: "LLM Providers", icon: Cpu },
      { to: "/admin/features", label: "Feature Flags", icon: ToggleLeft },
      { to: "/admin/params", label: "Parâmetros", icon: Sliders },
    ],
  },
  {
    label: "Conta",
    items: [
      { to: "/admin/metricas", label: "Métricas", icon: BarChart3 },
      { to: "/admin/cobranca", label: "Cobrança", icon: CreditCard },
      { to: "/admin/equipe", label: "Equipe", icon: Users },
    ],
  },
];

const SIDEBAR_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

export default function AdminLayout() {
  const location = useLocation();
  const itemClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-md transition-colors h-[30px] text-[14px] px-2 ${
      active
        ? "text-[#1a2c44] font-semibold bg-[#e8ecf0]"
        : "text-[#1a2c44] hover:text-slate-900 hover:bg-slate-50 font-normal"
    }`;

  return (
    <div className="min-h-screen bg-white flex">
      <aside
        className="fixed left-0 top-0 h-screen z-50 flex flex-col bg-[#FAFAFA] border-r border-slate-200"
        style={{
          width: 240,
          fontFamily: SIDEBAR_FONT,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* Logo — padding px-5 py-4, height 28px (igual Tier Empresas) */}
        <div className="px-5 py-4 shrink-0 flex items-center">
          <img
            src="/tier-agent-escuro.png"
            alt="Tier Agent"
            style={{ height: 28, width: "auto", display: "block" }}
          />
        </div>

        {/* Nav — px-5 py-1 */}
        <nav className="flex-1 overflow-y-auto px-5 py-1">
          {SECTIONS.map((section, sIdx) => (
            <div key={section.label} className={sIdx > 0 ? "mt-5" : ""}>
              <div className="mb-1">
                <span className="text-[12px] font-normal text-slate-400">{section.label}</span>
              </div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {({ isActive }) => (
                    <div
                      className={itemClass(isActive || location.pathname.startsWith(item.to))}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                      <span>{item.label}</span>
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User menu bottom */}
        <div className="border-t border-slate-200 p-2 shrink-0">
          <UserMenu />
        </div>
      </aside>

      <main
        className="flex-1 ml-[240px] min-h-screen bg-white"
        style={{ fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        <div className="px-8 pb-8 max-w-[1400px] mx-auto">
          {/* TOP BAR — 60px, search + ícones (igual Stripe/Tier Empresas) */}
          <div className="h-[60px] flex items-center justify-between">
            <div className="relative w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar..."
                className="w-full h-7 pl-9 pr-3 text-[14px] rounded-lg bg-[#f4f7fa] text-slate-700 placeholder:text-slate-400 outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div className="flex items-center gap-1">
              <button className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <HelpCircle className="w-[18px] h-[18px]" />
              </button>
              <button className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <Bell className="w-[18px] h-[18px]" />
              </button>
              <button className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <Settings className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          <Outlet />
        </div>
      </main>
    </div>
  );
}

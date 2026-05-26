import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Cpu,
  ToggleLeft,
  Users,
  Sliders,
  BarChart3,
  CreditCard,
  ChevronDown,
  Bot,
  MessageSquare,
  Plug,
  BookOpen,
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
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: "Plataforma",
    items: [
      { to: "/admin/agentes", label: "Agentes", icon: Bot },
      { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/admin/canais", label: "Canais", icon: Plug },
      { to: "/admin/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    title: "Configuração",
    items: [
      { to: "/admin/llm", label: "LLM Providers", icon: Cpu },
      { to: "/admin/features", label: "Feature Flags", icon: ToggleLeft },
      { to: "/admin/params", label: "Parâmetros", icon: Sliders },
    ],
  },
  {
    title: "Conta",
    items: [
      { to: "/admin/metricas", label: "Métricas", icon: BarChart3 },
      { to: "/admin/cobranca", label: "Cobrança", icon: CreditCard },
      { to: "/admin/equipe", label: "Equipe", icon: Users },
    ],
  },
];

function NavSection({ group }: { group: NavGroup }) {
  const location = useLocation();
  const hasActive = group.items.some((it) => location.pathname.startsWith(it.to));
  const [open, setOpen] = useState<boolean>(hasActive || true);
  return (
    <div className="mt-5 first:mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 mb-1 text-[12px] text-slate-400 hover:text-slate-600 transition-colors"
      >
        <span>{group.title}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div>
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 h-[30px] mx-2 px-3 rounded-md text-[14px] transition-colors ${
                  isActive
                    ? "bg-[#003083]/[0.08] text-[#003083] font-semibold"
                    : "text-[#1a2c44] hover:bg-slate-50"
                }`
              }
            >
              <it.icon className="w-4 h-4 opacity-60" />
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-white flex font-sans">
      <aside
        className="bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0 h-full"
        style={{ width: 240 }}
      >
        {/* Header com logo */}
        <div className="h-[60px] px-5 flex items-center border-b border-slate-100">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-8 w-auto" />
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-2">
          {GROUPS.map((g) => (
            <NavSection key={g.title} group={g} />
          ))}
        </nav>

        {/* User menu bottom */}
        <div className="border-t border-slate-100 p-2">
          <UserMenu />
        </div>
      </aside>

      <main className="flex-1 ml-[240px] min-h-screen bg-white">
        <div className="px-8 pb-8 max-w-[1400px] mx-auto">
          {/* TOP BAR — 60px, search + ícones */}
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

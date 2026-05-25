import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
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
  defaultOpen?: boolean;
}

const GROUPS: NavGroup[] = [
  {
    title: "Plataforma",
    defaultOpen: true,
    items: [
      { to: "/admin/agentes", label: "Agentes", icon: Bot },
      { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/admin/canais", label: "Canais", icon: Plug },
      { to: "/admin/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    title: "Configuração",
    defaultOpen: true,
    items: [
      { to: "/admin/llm", label: "LLM Providers", icon: Cpu },
      { to: "/admin/features", label: "Feature Flags", icon: ToggleLeft },
      { to: "/admin/params", label: "Parâmetros", icon: Sliders },
    ],
  },
  {
    title: "Conta",
    defaultOpen: true,
    items: [
      { to: "/admin/metricas", label: "Métricas", icon: BarChart3 },
      { to: "/admin/cobranca", label: "Cobrança", icon: CreditCard },
      { to: "/admin/equipe", label: "Equipe", icon: Users },
    ],
  },
];

function NavSection({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(group.defaultOpen ?? true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-medium hover:text-slate-600"
      >
        <span>{group.title}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="mt-0.5">
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 h-[32px] px-5 text-[13px] ${
                  isActive
                    ? "bg-tier/8 text-tier font-medium border-r-2 border-tier"
                    : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              <it.icon className="w-4 h-4 opacity-70" />
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
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-[240px] bg-white border-r border-slate-200 flex flex-col">
        {/* Header com logo */}
        <div className="h-14 px-5 flex items-center border-b border-slate-100">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-6 w-auto" />
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-2">
          {GROUPS.map((g) => (
            <NavSection key={g.title} group={g} />
          ))}
        </nav>

        {/* User menu bottom */}
        <div className="border-t border-slate-100 p-2">
          <UserMenu />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-[1280px] mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

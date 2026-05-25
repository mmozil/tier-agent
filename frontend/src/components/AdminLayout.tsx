import { NavLink, Outlet } from "react-router-dom";
import { Cpu, ToggleLeft, Users, Sliders, BarChart3, CreditCard } from "lucide-react";

const items = [
  { to: "/admin/agentes", label: "Agentes", icon: Users },
  { to: "/admin/llm", label: "LLM Providers", icon: Cpu },
  { to: "/admin/features", label: "Feature Flags", icon: ToggleLeft },
  { to: "/admin/params", label: "Parâmetros", icon: Sliders },
  { to: "/admin/metricas", label: "Métricas", icon: BarChart3 },
  { to: "/admin/cobranca", label: "Cobrança", icon: CreditCard },
];

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-[240px] bg-white border-r border-slate-200 flex flex-col">
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-100">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-6 w-auto" />
          <span className="text-[10px] text-slate-400 uppercase tracking-wide">admin</span>
        </div>
        <nav className="flex-1 py-3">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 h-[34px] px-5 text-[13px] ${
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
        </nav>
        <div className="p-4 border-t border-slate-100 text-[11px] text-slate-400">v0.1.0 · build dev</div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-[1280px] mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

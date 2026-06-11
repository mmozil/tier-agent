import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Home,
  ArrowUpRight,
  PieChart,
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
  Settings,
  Store,
  Inbox,
  BellRing,
  Zap,
  Database,
} from "lucide-react";

import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import OnlineToggle from "./OnlineToggle";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean; // match exato (ex.: /admin index)
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavGroup[] = [
  {
    label: "",
    items: [{ to: "/admin", label: "Visão geral", icon: Home, end: true }],
  },
  {
    label: "Plataforma",
    items: [
      { to: "/admin/atencao", label: "Precisa de você", icon: BellRing },
      { to: "/admin/agentes", label: "Agentes", icon: Bot },
      { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/admin/leads", label: "Leads", icon: Inbox },
      { to: "/admin/playbooks", label: "Playbooks", icon: Workflow },
      { to: "/admin/marketplace", label: "Marketplace", icon: Store },
      { to: "/admin/canais", label: "Canais", icon: Plug },
      { to: "/admin/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Configuração",
    items: [
      { to: "/admin/llm", label: "LLM Providers", icon: Cpu },
      { to: "/admin/fontes-dados", label: "Fontes de Dados", icon: Database },
      { to: "/admin/macros", label: "Macros", icon: Zap },
      { to: "/admin/features", label: "Feature Flags", icon: ToggleLeft },
      { to: "/admin/params", label: "Parâmetros", icon: Sliders },
    ],
  },
  {
    label: "Conta",
    items: [
      { to: "/admin/metricas", label: "Métricas", icon: BarChart3 },
      { to: "/admin/relatorios-atendimento", label: "Relatórios", icon: PieChart },
      { to: "/admin/cobranca", label: "Cobrança", icon: CreditCard },
      { to: "/admin/equipe", label: "Equipe", icon: Users },
    ],
  },
];

const SIDEBAR_FONT =
  "'Geist', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Ubuntu, sans-serif";

export default function AdminLayout() {
  const location = useLocation();
  // estilo FC: item h-34 rounded-10; hover = texto clareia + ícone escurece (sem bg)
  // + active:scale-[0.98] (afunda no clique); ativo = acento azul + bg faint.
  const itemClass = (active: boolean) =>
    `group tier-jelly flex items-center gap-2.5 rounded-[10px] transition-colors duration-200 active:scale-[0.98] h-[34px] text-[13px] px-2.5 ${
      active
        ? "text-[#003083] dark:text-[#5b9bff] font-medium bg-[#003083]/[0.06] dark:bg-[#5b9bff]/[0.12]"
        : "text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white font-normal"
    }`;

  return (
    <div className="min-h-screen bg-white flex">
      <aside
        className="fixed left-0 top-0 h-screen z-50 flex flex-col bg-[#F9F9F9] border-r border-[#EDEDED]"
        style={{
          width: 240,
          fontFamily: SIDEBAR_FONT,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* Logo — área h-16 com border-b (igual FC: linha sob o logo) */}
        <div className="h-16 px-5 shrink-0 flex items-center border-b border-[#EDEDED]">
          <img
            src="/tier-agent-escuro.png"
            alt="Tier Agent"
            style={{ height: 28, width: "auto", display: "block" }}
          />
        </div>

        {/* Nav — px-5 py-3 (mesmo respiro do preview/dev) */}
        <nav className="flex-1 overflow-y-auto px-5 py-3">
          {SECTIONS.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? "mt-5" : ""}>
              {section.label && (
                <div className="mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#262626]/40 dark:text-[#565d68]">{section.label}</span>
                </div>
              )}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  {({ isActive }) => {
                    const act = item.end ? isActive : isActive || location.pathname.startsWith(item.to);
                    return (
                      <div className={itemClass(act)}>
                        <item.icon
                          className={`w-4 h-4 flex-shrink-0 transition-all duration-200 ${
                            act ? "opacity-100" : "opacity-60 group-hover:opacity-100"
                          }`}
                        />
                        <span>{item.label}</span>
                      </div>
                    );
                  }}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User menu bottom */}
        <div className="border-t border-[#EDEDED] p-2 shrink-0">
          <UserMenu />
        </div>
      </aside>

      <main
        className="flex-1 ml-[240px] min-h-screen bg-[#F9F9F9]"
        style={{ fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        {/* SEM max-w: o conteúdo é full-width pra as linhas (Row) chegarem nas
            extremidades; o conteúdo em si fica contido nos rails da Row (1232). */}
        <div className="px-8 pb-8">
          {/* TOP BAR — 60px, search + ícones (igual Stripe/Tier Empresas) */}
          <div className="h-[60px] flex items-center justify-between">
            <div className="relative w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#262626]/40 dark:text-[#6b7280] pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar..."
                className="w-full h-8 pl-9 pr-3 text-[14px] rounded-lg bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626] dark:text-slate-200 placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <OnlineToggle />
              <Link
                to="/admin/suporte"
                className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all active:scale-[0.98]"
              >
                <HelpCircle className="w-4 h-4" /> Ajuda
              </Link>
              <NotificationBell />
              <Link
                to="/admin/configuracoes"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all active:scale-[0.98]"
              >
                <Settings className="w-[18px] h-[18px]" />
              </Link>
              <Link
                to="/admin/cobranca"
                className="h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-white text-[13px] font-semibold bg-[#003083] hover:bg-[#002266] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] shadow-[0_1px_2px_rgba(0,48,131,0.18)] transition-all active:scale-[0.98]"
              >
                <ArrowUpRight className="w-4 h-4" /> Upgrade
              </Link>
            </div>
          </div>

          <Outlet />
        </div>
      </main>
    </div>
  );
}

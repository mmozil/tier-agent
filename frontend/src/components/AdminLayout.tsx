import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { iconBtn, btnPrimary } from "./ds/fc";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
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
      { to: "/admin/fontes-dados", label: "Integrações", icon: Database },
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
const SIDEBAR_WIDTH = 256;
const SIDEBAR_ITEM_HEIGHT = 40;

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export default function AdminLayout() {
  const location = useLocation();
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeLane, setActiveLane] = useState<{ top: number; height: number } | null>(null);
  const [hoverLane, setHoverLane] = useState<{ top: number; height: number } | null>(null);

  const flatItems = useMemo(() => SECTIONS.flatMap((section) => section.items), []);
  const activeKey = useMemo(
    () => flatItems.find((item) => isNavItemActive(location.pathname, item))?.to ?? null,
    [flatItems, location.pathname],
  );

  const measureItem = (key: string | null) => {
    if (!key) return null;
    const el = itemRefs.current[key];
    if (!el) return null;
    return { top: el.offsetTop, height: el.offsetHeight };
  };

  useLayoutEffect(() => {
    setActiveLane(measureItem(activeKey));
  }, [activeKey]);

  useLayoutEffect(() => {
    setHoverLane(measureItem(hoveredKey));
  }, [hoveredKey]);

  useEffect(() => {
    const syncLanes = () => {
      setActiveLane(measureItem(activeKey));
      setHoverLane(measureItem(hoveredKey));
    };

    window.addEventListener("resize", syncLanes);
    return () => window.removeEventListener("resize", syncLanes);
  }, [activeKey, hoveredKey]);

  const itemClass = (active: boolean) =>
    `group relative z-10 flex w-full items-center gap-3 rounded-[12px] px-3 text-[13px] leading-5 transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] ${
      active
        ? "font-medium text-[#003083] dark:text-[#8db9ff]"
        : "font-normal text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white"
    }`;

  return (
    <div className="min-h-screen bg-white flex">
      <aside
        className="fixed left-0 top-0 h-screen z-50 flex flex-col border-r border-[#EDEDED] bg-[#F9F9F9]"
        style={{
          width: SIDEBAR_WIDTH,
          fontFamily: SIDEBAR_FONT,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div className="flex h-16 shrink-0 items-center border-b border-[#EDEDED] px-4">
          <img
            src="/tier-agent-escuro.png"
            alt="Tier Agent"
            style={{ height: 28, width: "auto", display: "block" }}
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-3" onMouseLeave={() => setHoveredKey(null)}>
          <div className="relative">
            {hoverLane && hoveredKey && hoveredKey !== activeKey && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 rounded-[12px] bg-black/[0.04] opacity-100 transition-[transform,height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-white/[0.05] motion-reduce:transition-none"
                style={{ height: hoverLane.height, transform: `translateY(${hoverLane.top}px)` }}
              />
            )}
            {activeLane && activeKey && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 rounded-[12px] border border-[#003083]/[0.08] bg-[#003083]/[0.07] opacity-100 transition-[transform,height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-[#5b9bff]/[0.14] dark:bg-[#5b9bff]/[0.12] motion-reduce:transition-none"
                style={{ height: activeLane.height, transform: `translateY(${activeLane.top}px)` }}
              />
            )}

            {SECTIONS.map((section, sIdx) => (
              <div key={sIdx} className={sIdx > 0 ? "mt-5" : ""}>
                {section.label && (
                  <div className="mb-1.5 px-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#262626]/40 dark:text-[#565d68]">
                      {section.label}
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  {section.items.map((item) => {
                    const active = isNavItemActive(location.pathname, item);

                    return (
                      <NavLink key={item.to} to={item.to} end={item.end} className="block">
                        <div
                          ref={(el) => {
                            itemRefs.current[item.to] = el;
                          }}
                          className={itemClass(active)}
                          style={{ height: SIDEBAR_ITEM_HEIGHT }}
                          onMouseEnter={() => setHoveredKey(item.to)}
                          onFocus={() => setHoveredKey(item.to)}
                          onBlur={() => setHoveredKey((current) => (current === item.to ? null : current))}
                        >
                          <item.icon
                            className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                              active
                                ? "text-[#003083] dark:text-[#8db9ff]"
                                : "text-[#262626]/[0.56] dark:text-[#6b7280] group-hover:text-[#262626]/[0.72] dark:group-hover:text-white/80"
                            }`}
                          />
                          <span className="flex-1">{item.label}</span>
                        </div>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="shrink-0 border-t border-[#EDEDED] p-2">
          <UserMenu />
        </div>
      </aside>

      <main
        className="flex-1 min-h-screen bg-[#F9F9F9]"
        style={{
          marginLeft: SIDEBAR_WIDTH,
          fontFamily: SIDEBAR_FONT,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div className="px-8 pb-8">
          <div className="flex h-[60px] items-center justify-between">
            <div className="relative w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#262626]/40 dark:text-[#6b7280]" />
              <input
                type="text"
                placeholder="Buscar..."
                className="h-9 w-full rounded-[10px] bg-[#F1F3F5] pl-9 pr-3 text-[14px] text-[#262626] outline-none transition-shadow placeholder:text-[#262626]/40 focus:shadow-[0_0_0_2px_#003083] dark:bg-[#16191f] dark:text-slate-200 dark:placeholder:text-[#6b7280]"
              />
            </div>
            <div className="flex items-center gap-1">
              <OnlineToggle />
              <Link
                to="/admin/suporte"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[14px] font-medium text-[#262626]/[0.72] transition-all active:scale-[0.98] hover:bg-black/[0.04] hover:text-[#262626] dark:text-[#9aa1ab] dark:hover:bg-white/[0.04] dark:hover:text-white"
              >
                <HelpCircle className="h-4 w-4" /> Ajuda
              </Link>
              <NotificationBell />
              <Link to="/admin/configuracoes" className={iconBtn} title="Configurações">
                <Settings className="h-[18px] w-[18px]" />
              </Link>
              <Link to="/admin/cobranca" className={`${btnPrimary} ml-1`}>
                <ArrowUpRight className="h-4 w-4" /> Upgrade
              </Link>
            </div>
          </div>

          <Outlet />
        </div>
      </main>
    </div>
  );
}

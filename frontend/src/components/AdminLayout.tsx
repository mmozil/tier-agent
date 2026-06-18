import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, HelpCircle, Search, Settings } from "lucide-react";

import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import OnlineToggle from "./OnlineToggle";
import { iconBtn, btnPrimary } from "./ds/fc";
import {
  AgentsMenuIcon,
  AttentionMenuIcon,
  ChannelsMenuIcon,
  ConversationsMenuIcon,
  KnowledgeMenuIcon,
  LeadsMenuIcon,
  MarketplaceMenuIcon,
  MetricsMenuIcon,
  OverviewMenuIcon,
  PlaybooksMenuIcon,
  ReportsMenuIcon,
  SettingsMenuIcon,
} from "./icons/menuIcons";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  metaLabel?: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavGroup[] = [
  {
    label: "",
    items: [{ to: "/admin", label: "Visão geral", icon: OverviewMenuIcon, metaLabel: "/overview", end: true }],
  },
  {
    label: "Plataforma",
    items: [
      { to: "/admin/atencao", label: "Precisa de você", icon: AttentionMenuIcon, metaLabel: "/attention" },
      { to: "/admin/agentes", label: "Agentes", icon: AgentsMenuIcon, metaLabel: "/agents" },
      { to: "/admin/conversas", label: "Conversas", icon: ConversationsMenuIcon, metaLabel: "/inbox" },
      { to: "/admin/leads", label: "Leads", icon: LeadsMenuIcon, metaLabel: "/leads" },
      { to: "/admin/playbooks", label: "Playbooks", icon: PlaybooksMenuIcon, metaLabel: "/flows" },
      { to: "/admin/marketplace", label: "Marketplace", icon: MarketplaceMenuIcon, metaLabel: "/market" },
      { to: "/admin/canais", label: "Canais", icon: ChannelsMenuIcon, metaLabel: "/channels" },
      { to: "/admin/knowledge", label: "Knowledge", icon: KnowledgeMenuIcon, metaLabel: "/knowledge" },
    ],
  },
  {
    label: "Análise",
    items: [
      { to: "/admin/metricas", label: "Métricas", icon: MetricsMenuIcon, metaLabel: "/metrics" },
      { to: "/admin/relatorios-atendimento", label: "Relatórios", icon: ReportsMenuIcon, metaLabel: "/reports" },
    ],
  },
  {
    label: "",
    items: [{ to: "/admin/configuracoes", label: "Configurações", icon: SettingsMenuIcon, metaLabel: "/settings" }],
  },
];

const SIDEBAR_FONT =
  "'Geist', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Ubuntu, sans-serif";

export default function AdminLayout() {
  const location = useLocation();
  const itemClass = (active: boolean) =>
    `tier-jelly relative flex h-9 w-full items-center overflow-hidden rounded-[10px] transition-all duration-200 ease-out motion-reduce:transition-none active:scale-[0.98] ${
      active
        ? "tier-sidebar-item-active text-[#003083] dark:text-[#8ab4ff]"
        : "text-[#262626]/[0.56] hover:text-[#262626]/[0.72] dark:text-[#8b93a0] dark:hover:text-[#d9dde5]"
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
        <div className="h-16 px-5 shrink-0 flex items-center border-b border-[#EDEDED]">
          <img
            src="/tier-agent-escuro.png"
            alt="Tier Agent"
            style={{ height: 28, width: "auto", display: "block" }}
          />
        </div>

        <nav className="sidebar-scroll flex-1 overflow-y-auto px-5 py-3">
          {SECTIONS.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? "mt-5" : ""}>
              {section.label && (
                <div className="mb-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#262626]/40 dark:text-[#565d68]">
                    {section.label}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className="group tier-sidebar-item block rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003083]/25"
                  >
                    {({ isActive }) => {
                      const act = item.end ? isActive : isActive || location.pathname.startsWith(item.to);
                      return (
                        <div className={itemClass(act)}>
                          <div className="absolute left-0 flex h-9 w-9 items-center justify-center">
                            <item.icon
                              className={`h-4 w-4 transition-all duration-200 motion-reduce:transition-none ${
                                act
                                  ? "text-[#003083] dark:text-[#8ab4ff]"
                                  : "text-[#262626]/[0.72] opacity-80 dark:text-[#d9dde5] dark:opacity-60 group-hover:opacity-100"
                              }`}
                            />
                          </div>
                          <div className="flex flex-1 items-center pl-9 pr-2">
                            <span
                              className={`truncate text-[13px] leading-5 transition-colors duration-200 motion-reduce:transition-none ${
                                act
                                  ? "font-medium text-[#003083] dark:text-[#8ab4ff]"
                                  : "font-normal text-[#262626]/[0.72] dark:text-[#9aa1ab] group-hover:text-[#262626] dark:group-hover:text-white"
                              }`}
                            >
                              {item.label}
                            </span>
                            {item.metaLabel && (
                              <span className="ml-auto relative flex items-center pl-2">
                                <span className="pointer-events-none font-mono text-[11px] leading-4 text-[#262626]/[0.32] dark:text-[#6b7280] opacity-0 -translate-x-1 transition-all duration-150 ease-out motion-reduce:translate-x-0 motion-reduce:transition-none group-hover:translate-x-0 group-hover:opacity-100">
                                  {item.metaLabel}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#EDEDED] p-2 shrink-0">
          <UserMenu />
        </div>
      </aside>

      <main
        className="flex-1 ml-[240px] min-h-screen bg-[#F9F9F9]"
        style={{ fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        <div className="px-8 pb-8">
          <div className="h-[60px] flex items-center justify-between">
            <div className="relative w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#262626]/40 dark:text-[#6b7280] pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar..."
                className="w-full h-9 pl-9 pr-3 text-[14px] rounded-[10px] bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626] dark:text-slate-200 placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow"
              />
            </div>
            <div className="flex items-center gap-1">
              <OnlineToggle />
              <Link
                to="/admin/suporte"
                className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[14px] font-medium text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all active:scale-[0.98]"
              >
                <HelpCircle className="w-4 h-4" /> Ajuda
              </Link>
              <NotificationBell />
              <Link to="/admin/configuracoes" className={iconBtn} title="Configurações">
                <Settings className="w-[18px] h-[18px]" />
              </Link>
              <Link to="/admin/cobranca" className={`${btnPrimary} ml-1`}>
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

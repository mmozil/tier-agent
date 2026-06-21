import { Fragment, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, BookOpen, ChevronDown, HelpCircle, PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react";

import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import OnlineToggle from "./OnlineToggle";
import ThemeToggle from "./ThemeToggle";
import ErrorBoundary from "./ErrorBoundary";
import CommandPalette from "./CommandPalette";

const CMDK_LABEL = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

// Botão-ícone ghost da topbar (32px) — reutilizado pelo tema (sol/lua) e engrenagem.
const topIconBtn =
  "w-8 h-8 inline-flex items-center justify-center rounded-[10px] text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all active:scale-[0.95]";
// Botão outlined da topbar (Ajuda · Docs).
const topPillBtn =
  "h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#14171c] text-[13px] font-medium text-[#262626]/[0.82] dark:text-[#cdd2da] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-all active:scale-[0.98] shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
import { PRIMARY_SHADOW, ScrambleText } from "./ds/fc";
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

// Logomarca Tier (3 quadrados em diagonal) — mostrada quando o sidebar está colapsado.
function TierLogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden>
      <path d="M15.1904 17.7378H2.92909C1.31144 17.7378 0 19.0593 0 20.6897V33.0478C0 34.6782 1.31144 36 2.92909 36H15.1904C16.808 36 18.1192 34.6782 18.1192 33.0478V20.6897C18.1192 19.0593 16.808 17.7378 15.1904 17.7378Z" fill="#020855" />
      <path d="M24.1201 8.8916H11.8588C10.2411 8.8916 8.92969 10.2131 8.92969 11.8436V24.2016C8.92969 25.832 10.2411 27.1536 11.8588 27.1536H24.1201C25.7377 27.1536 27.0489 25.832 27.0489 24.2016V11.8436C27.0489 10.2131 25.7377 8.8916 24.1201 8.8916Z" fill="#003083" />
      <path d="M33.071 0H20.8099C19.1923 0 17.8809 1.32179 17.8809 2.9522V15.31C17.8809 16.9404 19.1923 18.2622 20.8099 18.2622H33.071C34.6887 18.2622 36.0001 16.9404 36.0001 15.31V2.9522C36.0001 1.32179 34.6887 0 33.071 0Z" fill="#1F42E4" />
    </svg>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  // Modo embed (?embed=1): o Tier Empresas embute o inbox num iframe — esconde
  // a casca do Agent (sidebar + topbar) e mostra só o conteúdo. "Um vidro só".
  const embed = new URLSearchParams(location.search).get("embed") === "1";
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("tier-admin-collapsed") === "1");
  // Conversas é colapsável (chevron) — quando fechado, esconde a sub-nav do inbox
  // (filas/canais/etiquetas/times) que o ConversasPage injeta no slot abaixo.
  const [convNavOpen, setConvNavOpen] = useState(() => localStorage.getItem("ta-convnav") !== "0");

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("tier-admin-collapsed", next ? "1" : "0");
      return next;
    });
  }

  function toggleConvNav() {
    setConvNavOpen((prev) => {
      const next = !prev;
      localStorage.setItem("ta-convnav", next ? "1" : "0");
      return next;
    });
  }


  const itemClass = (active: boolean) =>
    `tier-jelly relative flex h-8 items-center overflow-hidden rounded-[10px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none active:scale-[0.98] ${
      collapsed ? "w-9" : "w-full"
    } ${
      active
        ? "tier-sidebar-item-active text-[#003083] dark:text-[#8ab4ff]"
        : "text-[#262626]/[0.56] hover:text-[#262626]/[0.72] dark:text-[#8b93a0] dark:hover:text-[#d9dde5]"
    }`;

  const iconClass = (active: boolean) =>
    `h-4 w-4 transition-all duration-200 motion-reduce:transition-none ${
      active
        ? "text-[#003083] dark:text-[#8ab4ff]"
        : "text-[#262626]/[0.72] opacity-80 dark:text-[#d9dde5] dark:opacity-60 group-hover:opacity-100"
    }`;

  // Embed: sem sidebar/topbar — só o inbox, pra encaixar dentro do Tier Empresas.
  // Mantém o padding padrão do Agent (px-8) pra não ficar grudado na sidebar do ERP.
  if (embed) {
    return (
      <div
        className="min-h-screen bg-[#F9F9F9] dark:bg-[#0c0e12] px-8 pt-6 pb-8"
        style={{ fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0c0e12] flex">
      <aside
        className="fixed left-0 top-0 h-screen z-50 flex flex-col bg-[#F9F9F9] dark:bg-[#0c0e12] border-r border-[#EDEDED] dark:border-[#23272e] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ width: collapsed ? 64 : 240, fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        {/* Logo — crossfade entre a marca (3 quadrados, recolhido) e o logo completo */}
        <div className="h-16 shrink-0 relative overflow-hidden border-b border-[#EDEDED] dark:border-[#23272e]">
          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
              collapsed ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
            }`}
          >
            <TierLogoMark className="w-7 h-7" />
          </div>
          <div
            className={`absolute inset-0 flex items-center px-5 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
              collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-7 w-auto block dark:hidden" />
            <img src="/tier-agent-claro.png" alt="Tier Agent" className="h-7 w-auto hidden dark:block" />
          </div>
        </div>

        <nav className={`sidebar-scroll flex-1 overflow-y-auto py-3 ${collapsed ? "px-3" : "px-5"}`}>
          {SECTIONS.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? "mt-5" : ""}>
              {section.label && !collapsed && (
                <div className="mb-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#262626]/40 dark:text-[#565d68]">
                    {section.label}
                  </span>
                </div>
              )}
              <div className={`flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
                {section.items.map((item) => (
                  <Fragment key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={`group tier-sidebar-item block rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003083]/25 ${collapsed ? "w-9" : ""}`}
                  >
                    {({ isActive }) => {
                      const act = item.end ? isActive : isActive || location.pathname.startsWith(item.to);
                      return (
                        <div className={itemClass(act)}>
                          {/* ícone — SEMPRE absolute na faixa de 36px à esquerda: posição
                              estável ao recolher (não pula); o label desliza/some por baixo */}
                          <div className="absolute left-0 top-0 flex h-8 w-9 items-center justify-center">
                            <item.icon className={iconClass(act)} />
                          </div>
                          {/* label — sempre montado; some com fade + slide e é clipado pelo
                              overflow-hidden do item conforme a largura encolhe (recolher elegante) */}
                          <div
                            aria-hidden={collapsed}
                            className={`flex flex-1 items-center pl-9 pr-2 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
                              collapsed ? "opacity-0 -translate-x-1" : "opacity-100 translate-x-0"
                            }`}
                          >
                            <span
                              className={`truncate text-[13px] leading-5 transition-colors duration-200 motion-reduce:transition-none ${
                                act
                                  ? "font-medium text-[#003083] dark:text-[#8ab4ff]"
                                  : "font-normal text-[#262626]/[0.72] dark:text-[#9aa1ab] group-hover:text-[#262626] dark:group-hover:text-white"
                              }`}
                            >
                              {item.label}
                            </span>
                            {item.metaLabel && !(item.to === "/admin/conversas" && act) && (
                              <span className="ml-auto relative flex items-center pl-2">
                                <span className="pointer-events-none font-mono text-[11px] leading-4 text-[#262626]/[0.32] dark:text-[#6b7280] opacity-0 -translate-x-1 transition-all duration-150 ease-out motion-reduce:translate-x-0 motion-reduce:transition-none group-hover:translate-x-0 group-hover:opacity-100">
                                  {item.metaLabel}
                                </span>
                              </span>
                            )}
                            {item.to === "/admin/conversas" && act && !collapsed && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleConvNav(); }}
                                className="ml-auto shrink-0 -mr-1 p-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#262626]/50 dark:text-[#8b93a0]"
                                aria-label="Expandir ou recolher Conversas"
                              >
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${convNavOpen ? "" : "-rotate-90"}`} />
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  </NavLink>
                  {/* Slot do portal: a sub-nav do inbox (filas/canais/etiquetas/times) é
                      injetada aqui pelo ConversasPage. Abre/fecha com slide (accordion via
                      grid-rows 0fr↔1fr — técnica do animate-ui) ao clicar no chevron.
                      O slot fica SEMPRE no DOM pra o portal nunca perder o alvo. */}
                  {item.to === "/admin/conversas" && (
                    <div
                      className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                        !collapsed && convNavOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                      }`}
                    >
                      <div id="ta-conversas-subnav" className="overflow-hidden min-h-0 pl-2" />
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Toggle recolher/expandir */}
        <div className={`shrink-0 pt-2 ${collapsed ? "px-3" : "px-3"}`}>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir" : "Recolher"}
            className={`flex items-center h-8 rounded-[8px] text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-[#262626] dark:hover:text-white transition-colors ${
              collapsed ? "w-9 justify-center" : "w-full px-2.5 gap-2"
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4" /> <span>Recolher</span>
              </>
            )}
          </button>
        </div>

        <div className="border-t border-[#EDEDED] p-2 shrink-0">
          <UserMenu collapsed={collapsed} />
        </div>
      </aside>

      <main
        className="flex-1 min-h-screen bg-[#F9F9F9] dark:bg-[#0c0e12] transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ marginLeft: collapsed ? 64 : 240, fontFamily: SIDEBAR_FONT, WebkitFontSmoothing: "antialiased" }}
      >
        <div className="px-8 pb-8">
          <div className="h-[60px] flex items-center justify-between">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("ta:cmdk"))}
              title="Buscar telas e ações"
              className="relative w-[320px] h-8 pl-9 pr-2 inline-flex items-center rounded-[10px] bg-[#F1F3F5] dark:bg-[#16191f] text-[13px] text-[#262626]/45 dark:text-[#6b7280] hover:bg-[#ECEEF1] dark:hover:bg-[#1b1f26] transition-colors"
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
              <span className="flex-1 text-left">Buscar...</span>
              <kbd className="text-[10.5px] font-medium border border-[#E2E4E8] dark:border-[#2a2f37] rounded px-1.5 py-0.5">{CMDK_LABEL}</kbd>
            </button>
            {/* Topbar estilo Firecrawl (32px): ícones ghost (sino · tema · engrenagem) ·
                Ajuda/Docs outlined · Upgrade filled */}
            <div className="flex items-center gap-1.5">
              <OnlineToggle />
              <NotificationBell />
              <ThemeToggle className={topIconBtn} />
              <Link to="/admin/configuracoes" title="Configurações" className={topIconBtn}>
                <Settings className="w-4 h-4" />
              </Link>
              <Link to="/admin/suporte" className={topPillBtn}>
                <HelpCircle className="w-3.5 h-3.5" /> Ajuda
              </Link>
              <a href="https://docs.tier.finance" target="_blank" rel="noopener noreferrer" className={topPillBtn}>
                <BookOpen className="w-3.5 h-3.5" /> Docs
              </a>
              <Link
                to="/admin/cobranca"
                className={`ml-0.5 h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] transition-all active:scale-[0.98] ${PRIMARY_SHADOW}`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> <ScrambleText text="Upgrade" />
              </Link>
            </div>
          </div>

          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}

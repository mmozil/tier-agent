import { NavLink, Outlet } from "react-router-dom";

import { FC } from "@/components/ds/fc";

// Área de Configurações estilo Chatwoot: sub-nav à esquerda + a página de settings à
// direita (via <Outlet/>). As páginas de config (LLM, Integrações, etc.) usam `-mx-8`
// + PageFrame/Row (full-bleed), então o conteúdo tem um wrapper px-8 pra acomodar.
const SETTINGS_NAV: { label: string; items: { to: string; label: string }[] }[] = [
  {
    label: "Agente",
    items: [
      { to: "/admin/configuracoes/llm", label: "LLM Providers" },
      { to: "/admin/configuracoes/integracoes", label: "Integrações" },
      { to: "/admin/configuracoes/macros", label: "Macros" },
      { to: "/admin/configuracoes/parametros", label: "Parâmetros" },
      { to: "/admin/configuracoes/features", label: "Feature Flags" },
    ],
  },
  {
    label: "Conta",
    items: [
      { to: "/admin/configuracoes/equipe", label: "Equipe" },
      { to: "/admin/configuracoes/cobranca", label: "Cobrança" },
      { to: "/admin/configuracoes/perfil", label: "Perfil" },
    ],
  },
];

export default function ConfiguracoesLayout() {
  return (
    <div className="-mx-8 -mb-8 h-[calc(100vh-60px)] flex bg-white dark:bg-[#0c0e12] border-t border-[#EDEDED] dark:border-[#23272e]">
      {/* sub-nav */}
      <aside className={`w-[236px] shrink-0 border-r ${FC.hair} flex flex-col min-h-0 ${FC.base}`}>
        <div className={`h-14 shrink-0 flex items-center px-5 border-b ${FC.hair}`}>
          <h1 className="text-[15px] font-[550] text-[#262626] dark:text-[#e6e8eb]">Configurações</h1>
        </div>
        <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-3 min-h-0">
          {SETTINGS_NAV.map((sec) => (
            <div key={sec.label} className="mt-4 first:mt-0">
              <div className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-[#262626]/40 dark:text-[#565d68]">
                {sec.label}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                      `flex items-center h-8 px-2.5 rounded-[8px] text-[13px] transition-colors ${
                        isActive
                          ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#8ab4ff] font-medium"
                          : "text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-[#262626] dark:hover:text-white font-[450]"
                      }`
                    }
                  >
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* conteúdo da seção */}
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto sidebar-scroll bg-[#F9F9F9] dark:bg-[#0c0e12]">
        <div className="px-8 pt-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

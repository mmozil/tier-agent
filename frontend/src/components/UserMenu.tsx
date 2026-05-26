import { useState, useRef, useEffect } from "react";
import { LogOut, Settings, HelpCircle, User as UserIcon } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import Avatar from "./Avatar";

interface Produto {
  key: string;
  label: string;
  url: string;
  colors: [string, string, string];
}

const PRODUTOS: Produto[] = [
  // Atual primeiro (Tier Agent usa mesmo favicon cinza/preto do Tier Empresas — design unificado)
  { key: "agent", label: "tier agent", url: "https://agent.tier.finance", colors: ["#1a1a1a", "#4a4a4a", "#888"] },
  { key: "erp", label: "tier empresas", url: "https://erp.tier.finance", colors: ["#1a1a1a", "#4a4a4a", "#888"] },
  { key: "emissor", label: "tier emissor", url: "https://emissor.tier.finance", colors: ["#1a1a1a", "#4a4a4a", "#888"] },
  { key: "pay", label: "tier pay", url: "https://pay.tier.finance", colors: ["#0a3520", "#1f5e36", "#d4f5dd"] },
  { key: "invest", label: "tier invest", url: "https://investimentos.tier.finance", colors: ["#1e293b", "#334e68", "#38bdf8"] },
  { key: "personal", label: "tier personal", url: "https://app.tier.finance", colors: ["#06113C", "#002967", "#113FD6"] },
];

function Favicon({ colors }: { colors: [string, string, string] }) {
  return (
    <div className="w-6 h-6 rounded shrink-0 flex items-center justify-center overflow-hidden">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="12" width="12" height="12" rx="2" fill={colors[0]} />
        <rect x="6" y="6" width="12" height="12" rx="2" fill={colors[1]} />
        <rect x="12" y="0" width="12" height="12" rx="2" fill={colors[2]} />
      </svg>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-slate-300 group-hover:text-slate-400 transition-colors">
      <path
        d="M3.5 2H10M10 2V8.5M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  const nome = user.tenant?.nome || user.email;

  return (
    <div className="relative" ref={ref}>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 py-1.5 z-50 w-[280px]">
          {/* Cabeçalho com user info */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Avatar nome={nome} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-slate-900 truncate">{nome}</div>
                <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
              </div>
            </div>
          </div>

          {/* Opções */}
          <div className="px-1 py-1">
            <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400 px-3 py-1.5">
              Opções
            </p>
            <button
              onClick={() => (window.location.href = "/admin/perfil")}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
            >
              <UserIcon className="w-3.5 h-3.5" /> Meu perfil
            </button>
            <button
              onClick={() => (window.location.href = "/admin/params")}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
            >
              <Settings className="w-3.5 h-3.5" /> Configurações
            </button>
            <button
              onClick={() => window.open("https://tier.finance/contato", "_blank")}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
            >
              <HelpCircle className="w-3.5 h-3.5" /> Suporte
            </button>
          </div>

          <div className="h-px bg-slate-100 mx-3" />

          {/* Produtos */}
          <div className="px-1 py-1">
            <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400 px-3 py-1.5">
              Produtos
            </p>
            {PRODUTOS.map((p, idx) => {
              const isActive = idx === 0;
              const Inner = (
                <>
                  <Favicon colors={p.colors} />
                  <div className="flex-1 min-w-0 text-left">
                    <p
                      className={`text-[15px] font-medium leading-tight ${
                        isActive
                          ? "text-slate-800"
                          : "text-slate-500 group-hover:text-slate-700 transition-colors"
                      }`}
                      style={{ fontFamily: "'Exotica', sans-serif" }}
                    >
                      {p.label}
                    </p>
                  </div>
                  {isActive ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#444] shrink-0" />
                  ) : (
                    <ExternalIcon />
                  )}
                </>
              );
              if (isActive) {
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-md bg-slate-100"
                  >
                    {Inner}
                  </div>
                );
              }
              return (
                <a
                  key={p.key}
                  href={p.url}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-slate-50 transition-colors group mt-0.5"
                >
                  {Inner}
                </a>
              );
            })}
          </div>

          <div className="h-px bg-slate-100 mx-3" />

          {/* Sair */}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-4 py-2 text-[13px] text-rose-600 hover:bg-rose-50"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      )}

      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 p-2 rounded-md transition-colors ${
          open ? "bg-slate-100" : "hover:bg-slate-50"
        }`}
      >
        <Avatar nome={nome} size={32} />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] font-medium text-slate-900 truncate">{nome}</div>
          <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
        </div>
      </button>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { LogOut, User as UserIcon, ChevronUp } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import Avatar from "./Avatar";

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
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-slate-50 transition-colors"
      >
        <Avatar nome={nome} size={28} />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] font-medium text-slate-900 truncate">{nome}</div>
          <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
        </div>
        <ChevronUp className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 py-1.5 z-50">
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="text-[13px] font-medium text-slate-900 truncate">{nome}</div>
            <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
            {user.tenant?.sku && (
              <div className="mt-1 inline-block px-1.5 py-0.5 bg-tier/10 text-tier text-[10px] rounded uppercase tracking-wide">
                {user.tenant.sku}
              </div>
            )}
          </div>
          <button
            onClick={() => (window.location.href = "/admin/perfil")}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
          >
            <UserIcon className="w-3.5 h-3.5" /> Meu perfil
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

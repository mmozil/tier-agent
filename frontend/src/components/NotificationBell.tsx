import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bell, Phone, ArrowRight } from "lucide-react";

import { api } from "@/lib/api";

// Animação de "tocar" o sininho (estilo animate-ui Bell): balança feito pêndulo,
// pivotando no topo. Toca no hover e, quando há mensagens, toca em loop suave.
const bellAnim = {
  idle: { rotate: 0 },
  ring: {
    rotate: [0, 14, -11, 8, -6, 4, -2, 0],
    transition: { duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatDelay: 4 },
  },
  hover: {
    rotate: [0, 12, -10, 7, -4, 0],
    transition: { duration: 0.6, ease: "easeInOut" },
  },
};

// Botão-ícone da topbar (36px — a topbar é maior que os botões do corpo, que são 32px)
const topIconBtn =
  "w-8 h-8 inline-flex items-center justify-center rounded-[10px] text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all active:scale-[0.95]";

interface Stats {
  unread: number;
  by_category: Record<string, number>;
}

interface Notif {
  id: number;
  category: string;
  title: string;
  body: string | null;
  status: string;
  created_at: string;
  contato: string | null;
  telefone: string | null;
  conversation_id: number | null;
}

const CAT_DOT: Record<string, string> = {
  handoff: "bg-blue-500",
  lead: "bg-emerald-500",
  sla: "bg-amber-500",
  mention: "bg-violet-500",
  frustration: "bg-rose-500",
  error: "bg-amber-500",
};

const POLL_MS = 20000;

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get<Stats>("/notifications/stats");
      setCount(data.unread || 0);
    } catch {
      /* silencioso */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const { data } = await api.get<Notif[]>("/notifications", {
        params: { status: "unread", limit: 8 },
      });
      setItems(data);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, POLL_MS);
    // Atualiza NA HORA quando outra tela marca lida/arquiva (sem esperar o poll de 20s).
    const onChanged = () => {
      loadCount();
      if (open) loadItems();
    };
    window.addEventListener("notifications:changed", onChanged);
    return () => {
      clearInterval(t);
      window.removeEventListener("notifications:changed", onChanged);
    };
  }, [loadCount, loadItems, open]);

  // Fecha ao clicar fora
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadItems();
  }

  return (
    <div className="relative" ref={ref}>
      <motion.button
        onClick={toggle}
        className={`${topIconBtn} relative`}
        title="Notificações"
        initial="idle"
        animate={count > 0 ? "ring" : "idle"}
        whileHover="hover"
      >
        <motion.span
          className="inline-flex"
          style={{ transformOrigin: "50% 12%" }}
          variants={bellAnim}
        >
          <Bell className="w-4 h-4" />
        </motion.span>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold inline-flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </motion.button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] bg-white rounded-xl shadow-lg ring-1 ring-black/5 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-800">Notificações</span>
            {count > 0 && (
              <span className="text-[11px] text-slate-400">{count} não lidas</span>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-slate-400">
                Tudo em dia 🎉
              </div>
            )}
            {items.map((n) => {
              const tel = n.telefone;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    navigate("/admin/leads");
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 flex gap-2.5"
                >
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${CAT_DOT[n.category] || "bg-slate-300"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-800 truncate">{n.title}</p>
                    {n.body && (
                      <p className="text-[12px] text-slate-500 line-clamp-2 mt-0.5">{n.body}</p>
                    )}
                    {tel && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700 mt-1">
                        <Phone className="w-3 h-3" /> {tel}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              navigate("/admin/leads");
            }}
            className="w-full px-4 py-2.5 text-[13px] text-[#003083] font-medium hover:bg-slate-50 inline-flex items-center justify-center gap-1 border-t border-slate-100"
          >
            Ver tudo <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

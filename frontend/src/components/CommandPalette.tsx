import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Home, Bell, Sparkles, MessageSquare, UserPlus, Workflow, Store, Radio, BookOpen,
  BarChart3, FileText, Settings, Cpu, Plug, Zap, SlidersHorizontal, Users, CreditCard,
  User, Moon, Search, CornerDownLeft, LifeBuoy,
} from "lucide-react";

interface Cmd {
  id: string;
  label: string;
  group: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string;
  run: (nav: (to: string) => void) => void;
}

const COMMANDS: Cmd[] = [
  // Navegação
  { id: "overview", label: "Visão geral", group: "Ir para", icon: Home, keywords: "home dashboard inicio", run: (n) => n("/admin") },
  { id: "atencao", label: "Precisa de você", group: "Ir para", icon: Bell, keywords: "atencao pendencias handoff", run: (n) => n("/admin/atencao") },
  { id: "agentes", label: "Agentes", group: "Ir para", icon: Sparkles, keywords: "agents ia bot", run: (n) => n("/admin/agentes") },
  { id: "conversas", label: "Conversas", group: "Ir para", icon: MessageSquare, keywords: "inbox chat atendimento", run: (n) => n("/admin/conversas") },
  { id: "leads", label: "Leads", group: "Ir para", icon: UserPlus, keywords: "contatos clientes", run: (n) => n("/admin/leads") },
  { id: "playbooks", label: "Playbooks", group: "Ir para", icon: Workflow, keywords: "fluxos flows automacao", run: (n) => n("/admin/playbooks") },
  { id: "marketplace", label: "Marketplace", group: "Ir para", icon: Store, keywords: "loja apps", run: (n) => n("/admin/marketplace") },
  { id: "canais", label: "Canais", group: "Ir para", icon: Radio, keywords: "whatsapp instancias channels", run: (n) => n("/admin/canais") },
  { id: "knowledge", label: "Knowledge", group: "Ir para", icon: BookOpen, keywords: "base conhecimento rag docs", run: (n) => n("/admin/knowledge") },
  { id: "metricas", label: "Métricas", group: "Ir para", icon: BarChart3, keywords: "metrics custo uso", run: (n) => n("/admin/metricas") },
  { id: "relatorios", label: "Relatórios", group: "Ir para", icon: FileText, keywords: "reports atendimento", run: (n) => n("/admin/relatorios-atendimento") },
  { id: "suporte", label: "Ajuda / Suporte", group: "Ir para", icon: LifeBuoy, keywords: "help suporte ajuda", run: (n) => n("/admin/suporte") },
  // Configurações
  { id: "config", label: "Configurações", group: "Configurações", icon: Settings, keywords: "settings ajustes", run: (n) => n("/admin/configuracoes") },
  { id: "llm", label: "LLM Providers", group: "Configurações", icon: Cpu, keywords: "modelo ia openai anthropic minimax", run: (n) => n("/admin/configuracoes/llm") },
  { id: "embedding", label: "Embedding (RAG)", group: "Configurações", icon: Cpu, keywords: "rag vetor embedding gemini openai voyage cohere pgvector", run: (n) => n("/admin/configuracoes/embedding") },
  { id: "integracoes", label: "Integrações", group: "Configurações", icon: Plug, keywords: "fontes dados integrations", run: (n) => n("/admin/configuracoes/integracoes") },
  { id: "macros", label: "Macros", group: "Configurações", icon: Zap, keywords: "atalhos respostas", run: (n) => n("/admin/configuracoes/macros") },
  { id: "parametros", label: "Parâmetros", group: "Configurações", icon: SlidersHorizontal, keywords: "params ajustes", run: (n) => n("/admin/configuracoes/parametros") },
  { id: "equipe", label: "Equipe", group: "Configurações", icon: Users, keywords: "time atendentes membros", run: (n) => n("/admin/configuracoes/equipe") },
  { id: "cobranca", label: "Cobrança", group: "Configurações", icon: CreditCard, keywords: "billing plano upgrade", run: (n) => n("/admin/configuracoes/cobranca") },
  { id: "perfil", label: "Perfil", group: "Configurações", icon: User, keywords: "conta account profile", run: (n) => n("/admin/configuracoes/perfil") },
  // Ações
  {
    id: "theme",
    label: "Alternar tema (claro / escuro)",
    group: "Ações",
    icon: Moon,
    keywords: "dark light modo escuro claro tema",
    run: () => {
      const dark = document.documentElement.classList.toggle("dark");
      try {
        localStorage.setItem("ta-theme", dark ? "dark" : "light");
      } catch {
        /* ignore */
      }
    },
  },
];

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Hotkey global (Cmd/Ctrl+K) + evento custom disparado pela busca da topbar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("ta:cmdk", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ta:cmdk", onOpen as EventListener);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(term) || (c.keywords || "").includes(term) || c.group.toLowerCase().includes(term),
    );
  }, [q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  function exec(c?: Cmd) {
    if (!c) return;
    c.run(navigate);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      exec(filtered[idx]);
    }
  }

  if (!open) return null;

  // Agrupa preservando a ordem de COMMANDS.
  const groups: { name: string; items: { c: Cmd; n: number }[] }[] = [];
  filtered.forEach((c, n) => {
    let g = groups.find((x) => x.name === c.group);
    if (!g) {
      g = { name: c.group, items: [] };
      groups.push(g);
    }
    g.items.push({ c, n });
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh] bg-black/30 dark:bg-black/50 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[560px] rounded-[14px] bg-white dark:bg-[#14171c] border border-[#EDEDED] dark:border-[#23272e] shadow-[0_24px_60px_rgba(0,0,0,0.25)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[#EDEDED] dark:border-[#23272e]">
          <Search className="w-4 h-4 text-[#262626]/40 dark:text-[#6b7280] shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar telas e ações…"
            className="flex-1 bg-transparent outline-none text-[14px] text-[#262626] dark:text-slate-200 placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]"
          />
          <kbd className="text-[10.5px] font-medium text-[#262626]/45 dark:text-[#8b93a0] border border-[#EDEDED] dark:border-[#2a2f37] rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto sidebar-scroll py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-[#262626]/45 dark:text-[#8b93a0]">Nada encontrado.</div>
          )}
          {groups.map((g) => (
            <div key={g.name} className="px-2 pb-1">
              <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-[#262626]/40 dark:text-[#565d68]">
                {g.name}
              </div>
              {g.items.map(({ c, n }) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setIdx(n)}
                  onClick={() => exec(c)}
                  className={`group w-full flex items-center gap-3 h-9 px-2.5 rounded-[8px] text-[13px] transition-colors ${
                    n === idx
                      ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#8ab4ff]"
                      : "text-[#262626]/[0.82] dark:text-[#cdd2da]"
                  }`}
                >
                  <c.icon className="w-4 h-4 shrink-0 opacity-70" />
                  <span className="flex-1 text-left truncate">{c.label}</span>
                  {n === idx && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-50" />}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 h-9 border-t border-[#EDEDED] dark:border-[#23272e] text-[11px] text-[#262626]/40 dark:text-[#6b7280]">
          <span className="flex items-center gap-1">
            <kbd className="border border-[#EDEDED] dark:border-[#2a2f37] rounded px-1">↑</kbd>
            <kbd className="border border-[#EDEDED] dark:border-[#2a2f37] rounded px-1">↓</kbd> navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border border-[#EDEDED] dark:border-[#2a2f37] rounded px-1">↵</kbd> abrir
          </span>
          <span className="ml-auto">{isMac ? "⌘" : "Ctrl"} K</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

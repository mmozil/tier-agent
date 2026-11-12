import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Check, Loader2, LogOut, Settings, HelpCircle, User as UserIcon } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

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
  { key: "agent", label: "tier agent", url: "https://agent.tier.finance", colors: ["#001a4d", "#003083", "#0050D5"] },
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

interface Conta {
  agent_tenant_id: number;
  nome: string;
  papel: string | null;
  cargo: string | null;
  atual: boolean;
  ciencia_pendente: boolean;
}

export default function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Troca de conta (12/11/2026): a pessoa que está em mais de uma conta (a dela, o CCDA, a M7…)
  // troca aqui. Quem diz as contas e o papel em cada uma é o CRM. Dentro do CRM (inbox embutido,
  // sessão `ta_sso`) quem troca de conta é o próprio CRM — o seletor não aparece.
  const [contas, setContas] = useState<Conta[]>([]);
  const [trocando, setTrocando] = useState<number | null>(null);
  const embutido = (() => {
    try {
      return !!sessionStorage.getItem("ta_sso");
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    if (!open || embutido) return;
    api.get<{ contas: Conta[] }>("/auth/contas").then(({ data }) => setContas(data?.contas || [])).catch(() => setContas([]));
  }, [open, embutido]);
  async function trocar(c: Conta) {
    if (c.atual || trocando) return;
    setTrocando(c.agent_tenant_id);
    try {
      await api.post("/auth/trocar-conta", { agent_tenant_id: c.agent_tenant_id });
      window.location.assign("/admin/conversas");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Não deu para trocar de conta");
      setTrocando(null);
    }
  }

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  const nomePessoa = user.tenant?.nome_pessoa || user.tenant?.nome || user.email;
  const nomeEmpresa = user.tenant?.nome || "";

  return (
    <div className="relative" ref={ref}>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 py-1.5 z-50 w-[280px]">
          {/* Cabeçalho com user info */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Avatar nome={nomePessoa} src={user.tenant?.avatar_url} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-slate-900 truncate">{nomePessoa}</div>
                {nomeEmpresa && nomeEmpresa !== nomePessoa && (
                  <div className="text-[11px] text-slate-500 truncate">{nomeEmpresa}</div>
                )}
              </div>
            </div>
          </div>

          {/* Contas — só quando a pessoa tem mais de uma */}
          {contas.length > 1 && (
            <>
              <div className="px-1 py-1">
                <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400 px-3 py-1.5">Contas</p>
                {contas.map((c) => (
                  <button
                    key={c.agent_tenant_id}
                    onClick={() => trocar(c)}
                    disabled={c.ciencia_pendente && !c.atual}
                    title={c.ciencia_pendente && !c.atual ? "Confirme a ciência do registro das conversas no CRM antes de abrir esta conta" : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left ${
                      c.atual ? "bg-slate-100" : "hover:bg-slate-50"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-slate-800 truncate">{c.nome}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {c.ciencia_pendente && !c.atual ? "Confirme a ciência no CRM" : c.cargo || (c.papel === "admin" ? "Vê todas as conversas" : "Vê as suas conversas")}
                      </span>
                    </span>
                    {trocando === c.agent_tenant_id ? (
                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-slate-400" />
                    ) : (
                      c.atual && <Check className="w-3.5 h-3.5 shrink-0 text-[#003083]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="h-px bg-slate-100 mx-3" />
            </>
          )}

          {/* Opções */}
          <div className="px-1 py-1">
            <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400 px-3 py-1.5">
              Opções
            </p>
            <button
              onClick={() => go("/admin/perfil")}
              className="w-full flex items-center gap-2 h-8 px-3 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
            >
              <UserIcon className="w-3.5 h-3.5" /> Meu perfil
            </button>
            <button
              onClick={() => go("/admin/configuracoes")}
              className="w-full flex items-center gap-2 h-8 px-3 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
            >
              <Settings className="w-3.5 h-3.5" /> Configurações
            </button>
            <button
              onClick={() => go("/admin/suporte")}
              className="w-full flex items-center gap-2 h-8 px-3 text-[13px] text-slate-700 hover:bg-slate-50 rounded-md"
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
            className="w-full flex items-center gap-2 h-8 px-4 text-[13px] text-rose-600 hover:bg-rose-50"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      )}

      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        title={collapsed ? nomePessoa : undefined}
        className={`flex items-center p-2 rounded-md transition-colors ${
          collapsed ? "w-9 justify-center" : "w-full gap-2.5"
        } ${open ? "bg-slate-100" : "hover:bg-slate-50"}`}
      >
        <Avatar nome={nomePessoa} src={user.tenant?.avatar_url} size={collapsed ? 28 : 32} />
        {!collapsed && (
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[12px] font-medium text-slate-900 truncate">{nomePessoa}</div>
            {nomeEmpresa && nomeEmpresa !== nomePessoa && (
              <div className="text-[10px] text-slate-500 truncate">{nomeEmpresa}</div>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

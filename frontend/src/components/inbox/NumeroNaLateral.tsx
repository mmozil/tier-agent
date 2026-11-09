/**
 * Número na lateral do Atendimento, com o cartão de quem é (09/11/2026, M7).
 *
 * Pedido do dono, com print: a lista «Números» mostrava «551131329150», «55119118335…»,
 * sem dizer de quem era. Agora a linha mostra a foto e o nome de quem responde pelo número
 * (ou o agente, no número da IA) e, ao passar o mouse, um cartão com o número formatado, o
 * uso (agente com IA ou registro), a conexão, quem mais vê e quantas conversas há.
 *
 * Um mesmo número pode ter mais de um cadastro (o 3132‑9150 da M7 foi da Isabella e hoje é
 * do agente): o cartão lista os dois, e a linha fala pelo cadastro ligado.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import { formatPhone } from "@/lib/phone";

export type Pessoa = { id: number; nome: string; cargo?: string | null; role?: string; avatar_url?: string | null };

export type CadastroDoNumero = {
  id: number;
  modo: string; // agente | registro
  ligado: boolean;
  status?: string | null; // connected | logged_out | …
  dono?: Pessoa | null;
  agente?: string | null;
  tambem?: Pessoa[];
};

export type InfoNumero = { rotulo: string; cadastros: CadastroDoNumero[] };

/** O cadastro que fala pela linha: o ligado e conectado, senão o ligado, senão o primeiro. */
export function principal(info: InfoNumero): CadastroDoNumero | null {
  const c = info.cadastros;
  return (
    c.find((x) => x.ligado && x.status === "connected") || c.find((x) => x.ligado) || c[0] || null
  );
}

/** Nome da linha: a pessoa dona, o agente (número da IA) ou o número formatado. */
export function tituloDoNumero(info: InfoNumero): string {
  const p = principal(info);
  if (p?.modo === "agente" && p.agente) return p.agente;
  if (p?.dono?.nome) return p.dono.nome;
  if (p?.agente) return p.agente;
  return telefone(info.rotulo);
}

function telefone(rotulo: string): string {
  const d = (rotulo || "").replace(/\D/g, "");
  return d.length >= 10 ? formatPhone(d) : rotulo;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] || "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
}

function Avatar({ c, tam }: { c: CadastroDoNumero | null; tam: number }) {
  const estilo = { width: tam, height: tam };
  if (c?.modo === "agente" && !c.dono) {
    return (
      <span style={estilo} className="relative z-10 inline-flex shrink-0 items-center justify-center rounded-full bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]">
        <Bot style={{ width: tam * 0.6, height: tam * 0.6 }} />
      </span>
    );
  }
  if (c?.dono?.avatar_url) {
    return <img src={c.dono.avatar_url} alt="" style={estilo} className="relative z-10 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      style={{ ...estilo, fontSize: Math.round(tam * 0.42) }}
      className="relative z-10 inline-flex shrink-0 items-center justify-center rounded-full bg-[#003083]/[0.08] font-semibold leading-none text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
    >
      {c?.dono?.nome ? iniciais(c.dono.nome) : "#"}
    </span>
  );
}

const CONEXAO: Record<string, { rotulo: string; cor: string }> = {
  connected: { rotulo: "Conectado", cor: "#16a34a" },
  logged_out: { rotulo: "Desconectado", cor: "#dc2626" },
  disconnected: { rotulo: "Desconectado", cor: "#dc2626" },
  close: { rotulo: "Desconectado", cor: "#dc2626" },
  pending: { rotulo: "Aguardando o QR", cor: "#d97706" },
  qr: { rotulo: "Aguardando o QR", cor: "#d97706" },
  connecting: { rotulo: "Conectando", cor: "#d97706" },
};

function conexao(c: CadastroDoNumero): { rotulo: string; cor: string } {
  if (!c.ligado) return { rotulo: "Desligado", cor: "#9ca3af" };
  return CONEXAO[c.status || ""] || { rotulo: c.status ? c.status : "Sem informação", cor: "#9ca3af" };
}

function uso(c: CadastroDoNumero): string {
  return c.modo === "agente" ? `Agente com IA${c.agente ? ` · ${c.agente}` : ""}` : "Registro, sem IA";
}

function papel(p?: Pessoa | null): string | null {
  if (!p) return null;
  if (p.cargo) return p.cargo;
  return p.role === "admin" ? "Administrador" : p.role === "atendente" ? "Atendente" : null;
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[#262626]/50 dark:text-[#8b93a0]">{rotulo}</dt>
      <dd className="min-w-0 text-right text-[#262626] dark:text-[#e6e8eb]">{children}</dd>
    </div>
  );
}

function Cartao({ info, conversas, rect }: { info: InfoNumero; conversas: number; rect: DOMRect }) {
  const p = principal(info);
  const outros = info.cadastros.filter((c) => c !== p);
  const ALT = 300;
  const top = Math.max(8, Math.min(rect.top - 10, window.innerHeight - ALT - 8));
  const left = Math.min(rect.right + 8, window.innerWidth - 276);
  const nome = p?.modo === "agente" && !p.dono ? p.agente || "Agente" : p?.dono?.nome || telefone(info.rotulo);
  const sub = p?.modo === "agente" && !p.dono ? "Número do agente" : papel(p?.dono) || (p?.dono ? null : "Número sem responsável");
  return (
    <motion.div
      role="tooltip"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      style={{ top, left }}
      className="pointer-events-none fixed z-[80] w-[268px] rounded-[12px] border border-[#EDEDED] bg-white p-3.5 shadow-[0_10px_32px_rgba(0,0,0,0.12)] dark:border-[#23272e] dark:bg-[#14171c]"
    >
      <div className="flex items-center gap-3">
        <Avatar c={p} tam={40} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium leading-tight text-[#262626] dark:text-[#e6e8eb]">{nome}</p>
          {sub && <p className="mt-0.5 truncate text-[12px] text-[#262626]/55 dark:text-[#8b93a0]">{sub}</p>}
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-[#EDEDED] pt-3 text-[12.5px] dark:border-[#23272e]">
        <Linha rotulo="Número"><span className="tabular-nums">{telefone(info.rotulo)}</span></Linha>
        {p && <Linha rotulo="Uso">{uso(p)}</Linha>}
        {p && (
          <Linha rotulo="Conexão">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: conexao(p).cor }} />
              {conexao(p).rotulo}
            </span>
          </Linha>
        )}
        {p?.tambem && p.tambem.length > 0 && (
          <Linha rotulo="Também veem">{p.tambem.map((x) => x.nome.split(" ")[0]).join(", ")}</Linha>
        )}
        <Linha rotulo="Conversas"><span className="tabular-nums">{conversas}</span></Linha>
      </dl>
      {outros.length > 0 && (
        <div className="mt-3 border-t border-[#EDEDED] pt-2.5 dark:border-[#23272e]">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[#262626]/45 dark:text-[#6b7280]">
            Outro cadastro deste número
          </p>
          {outros.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-0.5 text-[12px] text-[#262626]/75 dark:text-[#b6bcc6]">
              <Avatar c={c} tam={18} />
              <span className="min-w-0 flex-1 truncate">{c.dono?.nome || c.agente || "Sem responsável"}</span>
              <span className="shrink-0 text-[#262626]/50 dark:text-[#8b93a0]">
                {c.modo === "agente" ? "IA" : "Registro"} · {conexao(c).rotulo}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default function NumeroNaLateral({
  info, conversas, active, onClick, compacto = false,
}: {
  info: InfoNumero;
  conversas: number;
  active: boolean;
  onClick: () => void;
  /** Menu recolhido (09/11/2026): só a foto, com o mesmo cartão no hover. */
  compacto?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const espera = useRef<number | undefined>(undefined);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => () => window.clearTimeout(espera.current), []);
  const abrir = () => {
    window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => ref.current && setRect(ref.current.getBoundingClientRect()), 220);
  };
  const fechar = () => {
    window.clearTimeout(espera.current);
    setRect(null);
  };
  const p = principal(info);
  const alerta = p && (!p.ligado || (p.status && p.status !== "connected")) ? conexao(p).cor : null;
  if (compacto) {
    return (
      <>
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          onMouseEnter={abrir}
          onMouseLeave={fechar}
          onFocus={abrir}
          onBlur={fechar}
          aria-label={`${tituloDoNumero(info)} · ${telefone(info.rotulo)}`}
          className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors ${
            active ? "" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          }`}
        >
          {active && (
            <motion.span
              layoutId="ta-subnav-active"
              className="absolute inset-0 z-0 rounded-[8px] bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12]"
              transition={{ type: "spring", stiffness: 350, damping: 35 }}
            />
          )}
          <Avatar c={p} tam={24} />
          {alerta && (
            <span className="absolute bottom-1 right-1 z-10 h-2 w-2 rounded-full ring-2 ring-white dark:ring-[#0c0e12]" style={{ background: alerta }} />
          )}
        </button>
        {rect && createPortal(<Cartao info={info} conversas={conversas} rect={rect} />, document.body)}
      </>
    );
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        aria-label={`${tituloDoNumero(info)} · ${telefone(info.rotulo)}`}
        className={`group relative flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] transition-colors ${
          active
            ? "font-medium text-[#003083] dark:text-[#8ab4ff]"
            : "font-[450] text-[#262626]/[0.72] hover:bg-black/[0.04] hover:text-[#262626] dark:text-[#9aa1ab] dark:hover:bg-white/[0.05] dark:hover:text-white"
        }`}
      >
        {active && (
          <motion.span
            layoutId="ta-subnav-active"
            className="absolute inset-0 z-0 rounded-[8px] bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12]"
            transition={{ type: "spring", stiffness: 350, damping: 35 }}
          />
        )}
        <Avatar c={p} tam={18} />
        <span className="relative z-10 flex-1 truncate text-left">{tituloDoNumero(info)}</span>
        {/* Ponto só quando algo não está bem: desconectado (vermelho), aguardando (âmbar), desligado (cinza). */}
        {alerta && <span className="relative z-10 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: alerta }} />}
        {conversas > 0 && (
          <span className="relative z-10 shrink-0 text-[11px] tabular-nums text-[#262626]/[0.5] dark:text-[#8b93a0]">{conversas}</span>
        )}
      </button>
      {rect && createPortal(<Cartao info={info} conversas={conversas} rect={rect} />, document.body)}
    </>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Search, Settings2, Tag, X } from "lucide-react";

import { FC } from "@/components/ds/fc";

// Etiquetas da conta (12/11/2026, pedido do CCDA): a equipe ESCOLHE numa lista fixa, no padrão
// do Chatwoot, em vez de digitar.
//
// 🚨 A lista abre SOLTA, ancorada ao botão — o MESMO padrão do `Select` do design system (a lista
// da Prioridade). A 1ª versão abria DENTRO do painel: a seção fica no pé da janela, a lista
// nascia abaixo da dobra (2 itens à vista), com duas barras de rolagem e o anel de foco cortado
// pela sanfona. Sem espaço embaixo, abre para cima; a altura nunca passa do que cabe na tela e só
// a lista rola.

export interface Etiqueta {
  id: number;
  nome: string;
  descricao: string | null;
  cor: string;
  na_lateral: boolean;
}

export const MAX_ETIQUETAS = 8;
/** Etiqueta antiga, que não está mais na lista da conta. */
export const COR_FORA_DA_LISTA = "#9CA3AF";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Busca + rodapé da lista solta (para o cálculo da altura). */
const CABECA_E_PE = 44 + 36;

export function ChipEtiqueta({ nome, cor, onRemover }: { nome: string; cor: string; onRemover?: () => void }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-7 pl-2.5 ${onRemover ? "pr-1" : "pr-2.5"} rounded-full border text-[12.5px] ${FC.ink}`}
      style={{ background: `${cor}1A`, borderColor: `${cor}59` }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
      <span className="truncate max-w-[180px]">{nome}</span>
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label={`Tirar a etiqueta ${nome}`}
          title="Tirar"
          className={`w-5 h-5 inline-flex items-center justify-center rounded-full ${FC.sub} hover:bg-black/[0.07] dark:hover:bg-white/[0.1] hover:text-[#c0362c] dark:hover:text-[#ff6b5e]`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

export function SeletorDeEtiquetas({
  etiquetas,
  aplicadas,
  onChange,
  corDe,
  podeGerenciar,
}: {
  etiquetas: Etiqueta[];
  aplicadas: string[];
  onChange: (proximas: string[]) => void;
  corDe: (nome: string) => string;
  podeGerenciar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [destaque, setDestaque] = useState(0);
  const [livre, setLivre] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);

  // Mesmo cálculo do `Select`: abaixo do botão; sem espaço (menos de ~6 linhas), para cima.
  const posicionar = useCallback(() => {
    const b = botaoRef.current?.getBoundingClientRect();
    if (!b) return;
    const abaixo = window.innerHeight - b.bottom - 8;
    const acima = b.top - 8;
    const paraCima = abaixo < 300 && acima > abaixo;
    const max = Math.max(160, Math.min(400, (paraCima ? acima : abaixo) - 4));
    const width = Math.max(b.width, 280);
    const left = Math.min(b.left, window.innerWidth - width - 8);
    setPos(paraCima ? { left, width, bottom: window.innerHeight - b.top + 4, max } : { left, width, top: b.bottom + 4, max });
  }, []);
  useLayoutEffect(() => {
    if (aberto) posicionar();
  }, [aberto, posicionar]);

  useEffect(() => {
    if (!aberto) {
      setBusca("");
      return;
    }
    const fora = (e: globalThis.MouseEvent) => {
      const alvo = e.target as Node;
      if (ref.current?.contains(alvo) || menuRef.current?.contains(alvo)) return;
      setAberto(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    // O painel rolou / a janela mudou: a lista acompanha o botão (rolar DENTRO dela não conta).
    const mover = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      posicionar();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", mover);
    window.addEventListener("scroll", mover, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", mover);
      window.removeEventListener("scroll", mover, true);
    };
  }, [aberto, posicionar]);

  const termo = semAcento(busca.trim());
  const visiveis = termo ? etiquetas.filter((e) => semAcento(`${e.nome} ${e.descricao || ""}`).includes(termo)) : etiquetas;
  useEffect(() => setDestaque(0), [busca, aberto]);
  const cheio = aplicadas.length >= MAX_ETIQUETAS;
  const alternar = (nome: string) => {
    if (aplicadas.includes(nome)) onChange(aplicadas.filter((x) => x !== nome));
    else if (!cheio) onChange([...aplicadas, nome]);
  };

  const campo = `w-full h-8 rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} text-[14px] outline-none transition-shadow`;

  return (
    // pt-[3px]: folga para o anel de foco (2 px) — a sanfona do painel corta o que passa da borda.
    <div ref={ref} className="space-y-2 pt-[3px]">
      {aplicadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aplicadas.map((t) => (
            <ChipEtiqueta key={t} nome={t} cor={corDe(t)} onRemover={() => onChange(aplicadas.filter((x) => x !== t))} />
          ))}
        </div>
      )}

      {etiquetas.length === 0 ? (
        // Conta sem lista: segue o texto livre de antes, com espaço para digitar.
        <div className="space-y-1">
          <input
            value={livre}
            onChange={(e) => setLivre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && livre.trim() && !cheio) {
                e.preventDefault();
                onChange([...aplicadas, livre]);
                setLivre("");
              }
            }}
            disabled={cheio}
            placeholder={cheio ? `Máximo de ${MAX_ETIQUETAS} etiquetas` : "Digite a etiqueta e tecle Enter"}
            className={`${campo} px-3 text-[13px] ${FC.ink} focus:shadow-[0_0_0_2px_#003083] placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]`}
          />
          {podeGerenciar && (
            <Link
              to="/admin/configuracoes/etiquetas"
              className={`inline-flex items-center gap-1 text-[11.5px] ${FC.mut} hover:text-[#003083] dark:hover:text-[#5b9bff]`}
            >
              <Settings2 className="w-3 h-3" /> Criar a lista de etiquetas da conta
            </Link>
          )}
        </div>
      ) : (
        <button
          ref={botaoRef}
          type="button"
          onClick={() => setAberto((o) => !o)}
          aria-expanded={aberto}
          aria-haspopup="listbox"
          className={`${campo} pl-3 pr-2 inline-flex items-center justify-between gap-2 ${
            aberto ? "shadow-[0_0_0_2px_#003083]" : "hover:border-[#d8d8d8] dark:hover:border-[#33373e]"
          }`}
        >
          <span className={`inline-flex items-center gap-2 ${FC.mut}`}>
            <Tag className="w-3.5 h-3.5" />
            {aplicadas.length ? "Adicionar etiqueta" : "Escolher etiqueta"}
          </span>
          <ChevronDown className={`w-4 h-4 shrink-0 ${FC.mut} transition-transform ${aberto ? "rotate-180" : ""}`} />
        </button>
      )}

      {aberto &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.max + CABECA_E_PE, zIndex: 1000 }}
            className={`flex flex-col rounded-[10px] border ${FC.hair} bg-white dark:bg-[#14171c] shadow-[0_8px_28px_rgba(0,0,0,0.12)]`}
          >
            <div className={`shrink-0 border-b ${FC.hair} p-1.5`}>
              <div className="flex h-8 items-center gap-2 rounded-[8px] bg-[#F1F3F5] px-2.5 dark:bg-[#1b1f26]">
                <Search className={`h-3.5 w-3.5 shrink-0 ${FC.mut}`} />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setDestaque((i) => Math.min(i + 1, visiveis.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setDestaque((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const alvo = visiveis[destaque];
                      if (alvo) alternar(alvo.nome);
                    }
                  }}
                  placeholder="Buscar etiqueta…"
                  aria-label="Buscar etiqueta"
                  className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#262626]/40 dark:placeholder:text-white/30 ${FC.ink}`}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto sidebar-scroll p-1">
              {visiveis.length === 0 ? (
                <div className={`px-2.5 py-2 text-[13px] ${FC.mut}`}>Nenhuma etiqueta com «{busca.trim()}»</div>
              ) : (
                visiveis.map((e, i) => {
                  const marcada = aplicadas.includes(e.nome);
                  const bloqueada = !marcada && cheio;
                  const realce = termo !== "" && i === destaque && !marcada;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="option"
                      aria-selected={marcada}
                      disabled={bloqueada}
                      onClick={() => alternar(e.nome)}
                      onMouseEnter={() => setDestaque(i)}
                      className={`w-full min-h-[32px] px-2.5 py-1.5 rounded-[7px] flex items-center gap-2.5 text-left text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        marcada
                          ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12]"
                          : realce
                            ? "bg-black/[0.05] dark:bg-white/[0.07]"
                            : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ background: e.cor }} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate ${marcada ? "font-medium text-[#003083] dark:text-[#8ab4ff]" : FC.ink}`}
                        >
                          {e.nome}
                        </span>
                        {e.descricao && <span className={`block truncate text-[11.5px] leading-4 ${FC.mut}`}>{e.descricao}</span>}
                      </span>
                      {marcada && <Check className="w-3.5 h-3.5 shrink-0 text-[#003083] dark:text-[#8ab4ff]" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className={`shrink-0 flex items-center justify-between gap-2 h-9 px-3 border-t ${FC.hair} text-[11.5px] ${FC.mut}`}>
              <span>{cheio ? `Máximo de ${MAX_ETIQUETAS} por conversa` : `${aplicadas.length} de ${MAX_ETIQUETAS} na conversa`}</span>
              {podeGerenciar && (
                <Link
                  to="/admin/configuracoes/etiquetas"
                  onClick={() => setAberto(false)}
                  className="inline-flex items-center gap-1 hover:text-[#003083] dark:hover:text-[#5b9bff]"
                >
                  <Settings2 className="w-3 h-3" /> Gerenciar etiquetas
                </Link>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

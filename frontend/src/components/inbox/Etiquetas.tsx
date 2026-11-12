import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Search, Settings2, Tag, X } from "lucide-react";

import { FC } from "@/components/ds/fc";

// Etiquetas da conta (12/11/2026, pedido do CCDA): a equipe ESCOLHE numa lista fixa, no padrão
// do Chatwoot, em vez de digitar. A lista é aberta DENTRO do painel (empurra o resto para baixo)
// e não solta por cima — a seção do painel corta o que passa da borda, e lista escondida atrás de
// outra seção já enganou teste por clique (feedback_lista_invisivel_clique_passa).

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
  const [livre, setLivre] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) {
      setBusca("");
      return;
    }
    buscaRef.current?.focus();
    const fora = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const termo = semAcento(busca.trim());
  const visiveis = termo ? etiquetas.filter((e) => semAcento(`${e.nome} ${e.descricao || ""}`).includes(termo)) : etiquetas;
  const cheio = aplicadas.length >= MAX_ETIQUETAS;
  const alternar = (nome: string) =>
    onChange(aplicadas.includes(nome) ? aplicadas.filter((x) => x !== nome) : [...aplicadas, nome]);

  const campo = `w-full h-8 rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} text-[13px] outline-none transition-shadow`;

  return (
    <div ref={ref} className="space-y-2">
      {aplicadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aplicadas.map((t) => (
            <ChipEtiqueta key={t} nome={t} cor={corDe(t)} onRemover={() => onChange(aplicadas.filter((x) => x !== t))} />
          ))}
        </div>
      )}

      {etiquetas.length === 0 ? (
        // Conta sem lista: segue o texto livre de antes, só que com espaço para digitar.
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
            className={`${campo} px-3 ${FC.ink} focus:shadow-[0_0_0_2px_#003083] placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]`}
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
        <>
          <button
            type="button"
            onClick={() => setAberto((o) => !o)}
            aria-expanded={aberto}
            className={`${campo} pl-3 pr-2 inline-flex items-center justify-between gap-2 ${FC.dim} ${
              aberto ? "shadow-[0_0_0_2px_#003083]" : "hover:border-[#d8d8d8] dark:hover:border-[#33373e]"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" />
              {aplicadas.length ? "Adicionar ou tirar etiqueta" : "Escolher etiqueta"}
            </span>
            <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
          </button>

          {aberto && (
            <div className={`rounded-[12px] border ${FC.hair} bg-white dark:bg-[#14171c] overflow-hidden`}>
              <div className={`flex items-center gap-2 h-9 px-3 border-b ${FC.hair}`}>
                <Search className={`w-3.5 h-3.5 shrink-0 ${FC.mut}`} />
                <input
                  ref={buscaRef}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar etiqueta"
                  className={`flex-1 min-w-0 bg-transparent outline-none text-[13px] ${FC.ink} placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280]`}
                />
              </div>
              <div className="max-h-[320px] overflow-y-auto p-1">
                {visiveis.map((e) => {
                  const marcada = aplicadas.includes(e.nome);
                  const bloqueada = !marcada && cheio;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={bloqueada}
                      onClick={() => alternar(e.nome)}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[8px] text-left ${FC.hover} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`w-4 h-4 shrink-0 rounded-[5px] border flex items-center justify-center ${
                          marcada
                            ? "bg-[#262626] border-[#262626] dark:bg-[#e6e8eb] dark:border-[#e6e8eb]"
                            : "border-[#262626]/25 dark:border-white/25"
                        }`}
                      >
                        {marcada && <Check className="w-3 h-3 text-white dark:text-[#0c0e12]" strokeWidth={3} />}
                      </span>
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ background: e.cor }} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13.5px] leading-5 truncate ${FC.ink}`}>{e.nome}</span>
                        {e.descricao && <span className={`block text-[11.5px] leading-4 truncate ${FC.mut}`}>{e.descricao}</span>}
                      </span>
                    </button>
                  );
                })}
                {visiveis.length === 0 && (
                  <div className={`px-3 py-5 text-center text-[12.5px] ${FC.mut}`}>Nenhuma etiqueta com «{busca.trim()}»</div>
                )}
              </div>
              <div className={`flex items-center justify-between gap-2 h-9 px-3 border-t ${FC.hair} text-[11.5px] ${FC.mut}`}>
                <span>{cheio ? `Máximo de ${MAX_ETIQUETAS} por conversa` : `${aplicadas.length} de ${MAX_ETIQUETAS}`}</span>
                {podeGerenciar && (
                  <Link
                    to="/admin/configuracoes/etiquetas"
                    className="inline-flex items-center gap-1 hover:text-[#003083] dark:hover:text-[#5b9bff]"
                  >
                    <Settings2 className="w-3 h-3" /> Gerenciar etiquetas
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

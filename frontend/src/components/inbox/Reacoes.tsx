/**
 * Reação com emoji nos balões (21/10/2026) — como no WhatsApp: passa o mouse no
 * balão, escolhe o emoji, o contato vê embaixo da mensagem dele. Clicar de novo no
 * mesmo emoji tira. Só aparece em mensagem com chave do WhatsApp (as novas).
 */
import { useState } from "react";
import { FC } from "@/components/ds/fc";

export const EMOJIS_DE_REACAO = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type Reacoes = {
  nosso?: { emoji: string; nome?: string | null; pelo_celular?: boolean } | null;
  contato?: { emoji: string } | null;
} | null;

/** A barra de emojis que aparece ao passar o mouse no balão (o pai tem `group`). */
export function BarraDeReacao({
  atual,
  lado,
  onReagir,
}: {
  atual?: string | null;
  lado: "esquerda" | "direita";
  onReagir: (emoji: string) => Promise<void> | void;
}) {
  const [enviando, setEnviando] = useState(false);
  return (
    <div
      className={`absolute -top-3 ${lado === "direita" ? "right-2" : "left-2"} z-10 flex items-center gap-0.5 rounded-full border ${FC.hair} bg-white dark:bg-[#16191f] px-1 py-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)] opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto`}
    >
      {EMOJIS_DE_REACAO.map((e) => (
        <button
          key={e}
          type="button"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            try {
              await onReagir(atual === e ? "" : e);
            } finally {
              setEnviando(false);
            }
          }}
          title={atual === e ? "Tirar a reação" : `Reagir com ${e}`}
          aria-pressed={atual === e}
          className={`h-6 w-6 rounded-full text-[14px] leading-none transition-transform hover:scale-125 disabled:opacity-50 ${
            atual === e ? "bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.16]" : ""
          }`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/** As reações já feitas, embaixo do balão: a do contato e a nossa. */
export function ChipsDeReacao({ reacoes, lado }: { reacoes: Reacoes; lado: "esquerda" | "direita" }) {
  const itens = [
    reacoes?.contato?.emoji ? { emoji: reacoes.contato.emoji, quem: "O contato reagiu" } : null,
    reacoes?.nosso?.emoji
      ? {
          emoji: reacoes.nosso.emoji,
          quem: reacoes.nosso.pelo_celular
            ? "Reagido pelo celular do número"
            : `Reagido por ${reacoes.nosso.nome || "alguém da equipe"}`,
        }
      : null,
  ].filter(Boolean) as { emoji: string; quem: string }[];
  if (!itens.length) return null;
  return (
    <div className={`-mt-2 flex gap-1 ${lado === "direita" ? "justify-end pr-2" : "justify-start pl-2"}`}>
      {itens.map((i) => (
        <span
          key={i.quem}
          title={i.quem}
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border ${FC.hair} bg-white dark:bg-[#16191f] px-1 text-[12px] leading-none shadow-[0_1px_2px_rgba(0,0,0,0.06)]`}
        >
          {i.emoji}
        </span>
      ))}
    </div>
  );
}

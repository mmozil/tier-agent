import { useMemo } from "react";

import { FC } from "@/components/ds/fc";
import { analisarCategoria, precoDe, reais, type Categoria } from "@/lib/categoriaModelo";

// Embaixo do «Categoria» do modelo (14/11/2026): o custo das duas categorias e a leitura do
// texto — o que a Meta tende a aprovar, e por quê. Marcar Utilidade não garante Utilidade: a Meta
// decide pelo texto e, aprovado, não muda mais. Melhor saber antes de mandar para análise.

const NOME: Record<Categoria, string> = { MARKETING: "Marketing", UTILITY: "Utilidade" };

export default function AnaliseCategoria({
  categoria,
  corpo,
  rodape,
  botoes,
  onTrocar,
}: {
  categoria: Categoria;
  corpo: string;
  rodape: string;
  botoes: string[];
  onTrocar: (c: Categoria) => void;
}) {
  const a = useMemo(() => analisarCategoria(corpo, rodape, botoes), [corpo, rodape, botoes]);
  const pm = precoDe("MARKETING");
  const pu = precoDe("UTILITY");
  const vezes = pu > 0 ? Math.round(pm / pu) : 0;

  const custos = (
    <p className={`text-[11px] leading-4 ${FC.mut}`}>
      Custo por mensagem entregue (tabela da Meta, Brasil): <b className={FC.sub}>Marketing {reais(pm)}</b> ·{" "}
      <b className={FC.sub}>Utilidade {reais(pu, 3)}</b>
      {vezes > 1 ? ` — Marketing sai cerca de ${vezes}× mais caro.` : "."} Quem paga é a conta da Meta do número.
    </p>
  );

  if (!corpo.trim()) {
    return (
      <div className="mt-2 space-y-1">
        {custos}
        <p className={`text-[11px] leading-4 ${FC.mut}`}>Escreva o texto abaixo para ver como a Meta deve classificar.</p>
      </div>
    );
  }

  const motivos = a.provavel === "MARKETING" ? a.motivosMarketing : a.motivosUtilidade;
  const marcouUtilidadeMasEMarketing = categoria === "UTILITY" && a.provavel === "MARKETING";
  const marcouMarketingMasEUtilidade = categoria === "MARKETING" && a.provavel === "UTILITY" && !a.incerto;

  return (
    <div className="mt-2 space-y-2">
      {custos}
      <div
        className={`rounded-[10px] border px-3 py-2.5 ${
          marcouUtilidadeMasEMarketing
            ? "border-amber-300/70 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/[0.08]"
            : `${FC.hair} ${FC.base}`
        }`}
      >
        <p className={`text-[12px] leading-5 ${FC.ink}`}>
          {a.incerto ? (
            <>
              <b>Sem sinal claro.</b> Sem falar de algo que a pessoa já pediu ou marcou, a Meta tende a aprovar como{" "}
              <b>Marketing</b>.
            </>
          ) : (
            <>
              Pelo texto, a Meta deve aprovar como <b>{NOME[a.provavel]}</b> ({reais(precoDe(a.provavel), a.provavel === "UTILITY" ? 3 : 2)} por
              mensagem entregue).
            </>
          )}
        </p>
        {motivos.length > 0 && (
          <ul className={`mt-1 space-y-0.5 text-[11.5px] leading-4 ${FC.sub}`}>
            {motivos.slice(0, 4).map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        )}
        {marcouUtilidadeMasEMarketing && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11.5px] leading-4 text-amber-800 dark:text-amber-300">
              Você marcou Utilidade, mas o texto tem cara de Marketing. Se a Meta aprovar como Marketing, a categoria não muda
              mais: 100 mensagens custam cerca de {reais(pm * 100)}, e não {reais(pu * 100)}.
            </p>
            <p className={`text-[11.5px] leading-4 ${FC.sub}`}>
              Para ficar em Utilidade: fale só de algo que a pessoa já pediu ou marcou (pedido, agendamento, pagamento), sem
              convite, oferta, novidade nem botão de «quero agendar».
            </p>
            <button
              type="button"
              onClick={() => onTrocar("MARKETING")}
              className="text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline"
            >
              Marcar como Marketing
            </button>
          </div>
        )}
        {marcouMarketingMasEUtilidade && (
          <div className="mt-2 space-y-1">
            <p className={`text-[11.5px] leading-4 ${FC.sub}`}>
              O texto tem cara de Utilidade, que sai {vezes > 1 ? `cerca de ${vezes}×` : ""} mais barato.
            </p>
            <button
              type="button"
              onClick={() => onTrocar("UTILITY")}
              className="text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline"
            >
              Marcar como Utilidade
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

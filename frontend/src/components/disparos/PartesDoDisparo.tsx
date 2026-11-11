// Pedaços da página «Disparos» (11/11/2026) usados na lista e no detalhe.
import { TOM, type Contagens } from "@/lib/disparos";

export function Pilula({ texto, tom }: { texto: string; tom: keyof typeof TOM }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium ${TOM[tom]}`}>
      {texto}
    </span>
  );
}

/** As partes da barra, na ordem do funil. Cor só com função: verde = chegou, azul = saiu e ainda
 * sem confirmação, vermelho = falhou, âmbar = ficou de fora (pediu para sair / sem nome). */
export const PARTES_DA_BARRA = [
  { chave: "chegou", rotulo: "Entregue ou lido", cor: "bg-emerald-500" },
  { chave: "saiu", rotulo: "Enviado", cor: "bg-[#003083] dark:bg-[#5b9bff]" },
  { chave: "falhou", rotulo: "Falhou", cor: "bg-red-500" },
  { chave: "fora", rotulo: "Fora da lista", cor: "bg-amber-500" },
  { chave: "cancelado", rotulo: "Cancelado", cor: "bg-black/20 dark:bg-white/25" },
] as const;

export function partesDaBarra(c: Contagens): Record<(typeof PARTES_DA_BARRA)[number]["chave"], number> {
  return {
    chegou: c.entregues,
    saiu: Math.max(0, c.enviados - c.entregues),
    falhou: c.falhas,
    fora: c.descadastrados + c.sem_nome,
    cancelado: c.cancelados,
  };
}

export function BarraDoDisparo({ contagens, total, alta = false }: { contagens: Contagens; total: number; alta?: boolean }) {
  const p = partesDaBarra(contagens);
  const base = Math.max(1, total);
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08] ${alta ? "h-2" : "h-1.5"}`}
      role="img"
      aria-label={`${total - contagens.pendentes} de ${total} processados`}
    >
      {PARTES_DA_BARRA.map((parte) =>
        p[parte.chave] > 0 ? (
          <div key={parte.chave} className={`h-full ${parte.cor}`} style={{ width: `${(p[parte.chave] / base) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

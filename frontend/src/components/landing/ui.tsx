/**
 * Kit visual do site público do Tier Agent — o MESMO padrão do Tier Emissor
 * (`tier-finance/frontend/src/pages/emissor/EmissorSite.tsx`) e do Tier Empresas
 * (`.../tier-empresas/TierEmpresasSite.tsx`): tema escuro, cartão com anel,
 * botão em contorno, selo da marca e carrossel com encaixe no celular.
 *
 * 🚨 Por que não importamos o animate-ui de lá: este repositório (tier-agent) não
 * tem os componentes nem as dependências que eles usam (`class-variance-authority`,
 * `tailwind-merge`). Em vez de arrastar duas dependências para um frontend que já
 * compila, as medidas foram COPIADAS do original e estão escritas abaixo. Os valores
 * vieram do código, não de memória:
 *
 *   TierButton (variante outline, tema escuro)
 *     base .... inline-flex items-center justify-center gap-1.5 rounded-lg
 *               text-[12px] font-medium leading-none, ícone 12×12
 *     borda ... --aui-border no escuro = oklch(1 0 0 / 10%) = branco a 10%
 *     fundo ... --aui-background = oklch(0.145 0 0)
 *     texto ... --aui-foreground = oklch(0.985 0 0)
 *     hover ... --aui-accent     = oklch(0.269 0 0)
 *     tamanho . md = h-8 px-3 · xl = h-10 px-5
 *
 *   Badge (variante brand, tema escuro)
 *     bg-[#4d8bff]/15 text-[#4d8bff], rounded-md, text-[11px] px-2 py-0.5,
 *     ponto de 6px na mesma cor
 *
 * Se o original mudar, mude aqui também — são dois lugares de propósito, e o
 * comentário acima é o contrato entre eles.
 */
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

/** Chrome do cartão no tema escuro (spec CRM > Pipeline: ring-1, rounded-xl). */
export const CARD = 'rounded-xl bg-[#161616] ring-1 ring-[#333]';

/**
 * Celular: a lista de cartões vira carrossel lateral com encaixe (a ponta do
 * próximo cartão aparece e convida a deslizar); do tablet para cima volta a ser
 * grade. O -mx-6/px-6 deixa o carrossel correr até a borda sem perder o respiro.
 */
export const CARROSSEL =
  'flex md:grid gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory -mx-6 px-6 md:mx-0 md:px-0 pb-1 ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
export const ITEM_CARROSSEL = 'snap-center shrink-0 w-[84%] sm:w-[62%] md:w-auto';

type TamanhoBotao = 'md' | 'xl';

/** Botão em contorno — a única forma de botão do site (decisão do dono, 06/10/2026). */
export function BotaoTier({
  children,
  onClick,
  href,
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  size?: TamanhoBotao;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium leading-none ' +
    'whitespace-nowrap transition-colors outline-none select-none ' +
    'border border-white/10 bg-[#252525] text-[#fafafa] hover:bg-[#444] ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='w-'])]:w-3 [&_svg:not([class*='h-'])]:h-3";
  const tamanho = size === 'xl' ? 'h-10 px-5' : 'h-8 px-3';
  const classe = `${base} ${tamanho} ${className}`;

  if (href) {
    return (
      <a href={href} className={classe}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classe}>
      {children}
    </button>
  );
}

/** Selo da marca, com ou sem ponto. */
export function Selo({ children, dot = false, className = '' }: { children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium leading-none whitespace-nowrap text-[11px] px-2 py-0.5 bg-[#4d8bff]/15 text-[#4d8bff] ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#4d8bff]" />}
      {children}
    </span>
  );
}

/** Selo neutro — para estado e rótulo que não são da marca. */
export function SeloNeutro({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium leading-none whitespace-nowrap text-[11px] px-2 py-0.5 bg-[#2a2a2a] text-neutral-400 ${className}`}
    >
      {children}
    </span>
  );
}

/** Cabeçalho de seção: rótulo pequeno, título e linha de apoio, centrados. */
export function Cabecalho({ titulo, rotulo, texto }: { titulo: string; rotulo: string; texto?: string }) {
  return (
    <div className="text-center max-w-[620px] mx-auto">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">{rotulo}</p>
      <h2 className="mt-3 text-[30px] md:text-[36px] font-medium tracking-[-0.02em] leading-[1.15] text-white">{titulo}</h2>
      {texto && <p className="mt-3 text-[15px] leading-relaxed text-neutral-400">{texto}</p>}
    </div>
  );
}

/** Item de lista com marca de conferido. */
export function ItemCheck({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-[13px] text-neutral-300">
      <Check className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
      {children}
    </li>
  );
}

import type { ReactNode } from "react";

/* ───────────────────────────────────────────────────────────────
   Design System Firecrawl × Tier — primitivos.
   Valores EXTRAÍDOS do Firecrawl real (DOM/CSS ao vivo):
   - ink #262626 · faint #EDEDED · secundário ink@56% · muted ink@40% · hover preto 4%
   - tipografia: label-x-large 20/450/-0.1 · label-large 16/450 · body-small 13/400
   - efeito de grade: container de borda arredondada + células flush cujas bordas
     internas (border-r/border-b) se CRUZAM nas interseções (forma o "+").
   Referência: D:/Project/DESIGN/firecrawl-ref/DESIGN-SYSTEM-REAL.md
   ─────────────────────────────────────────────────────────────── */

// tokens reutilizáveis (string class) — valores REAIS do Firecrawl
export const FC = {
  ink: "text-[#262626] dark:text-[#e6e8eb]",
  sub: "text-[#262626]/[0.56] dark:text-[#8b93a0]", // black-alpha-56
  mut: "text-[#262626]/40 dark:text-[#6b7280]", // black-alpha-40
  dim: "text-[#262626]/[0.72] dark:text-[#9aa1ab]", // black-alpha-72 (sidebar)
  hair: "border-[#EDEDED] dark:border-[#23272e]", // border-faint
  hairBg: "bg-[#EDEDED] dark:bg-[#23272e]",
  hover: "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]", // black-alpha-4
  base: "bg-[#F9F9F9] dark:bg-[#0c0e12]", // background-base (o "cinza" do FC)
};

// CurvyRect — os 4 corner brackets do Firecrawl (classe .curvy-rect). 11×11,
// preenchidos com border-faint (#EDEDED). Arredondam o canto do container e,
// nas junções de seções/células, formam o "+" — É O EFEITO do Firecrawl.
const BRACKET_D =
  "M11 1L11 11L10 11L10 7C10 3.68629 7.31371 1 4 1L-4.37114e-08 1L0 -4.80825e-07L11 4.37114e-07L11 1Z";
export function CurvyRect() {
  const f = "fill-[#EDEDED] dark:fill-[#23272e]";
  const s = "absolute z-10 pointer-events-none";
  // wrapper absoluto inset-0 → NÃO ocupa célula do grid; só sobrepõe os cantos.
  return (
    <div aria-hidden className="curvy-rect pointer-events-none absolute inset-0 z-10">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={`${s} top-0 left-0 -rotate-90`}><path d={BRACKET_D} className={f} /></svg>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={`${s} top-0 right-0`}><path d={BRACKET_D} className={f} /></svg>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={`${s} bottom-0 left-0 rotate-180`}><path d={BRACKET_D} className={f} /></svg>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={`${s} bottom-0 right-0 rotate-90`}><path d={BRACKET_D} className={f} /></svg>
    </div>
  );
}

// CONTENT_MAX — largura do conteúdo contido (os rails ficam aqui).
export const CONTENT_MAX = 1232;

// PageFrame — wrapper full-width. As LINHAS (border das Rows) vão até as
// extremidades da página; o CONTEÚDO fica contido nos rails (ver Row).
export function PageFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative w-full ${FC.base} ${className}`}>{children}</div>;
}

// Row — UMA seção. A linha horizontal (border-b) é FULL-WIDTH (vai até as bordas
// da página); o conteúdo fica num container centralizado com rails (border-l/r).
// Onde a linha full-width cruza o rail → "+", arredondado pelo CurvyRect.
export function Row({
  children,
  last = false,
  className = "",
}: {
  children: ReactNode;
  last?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative w-full border-t ${last ? `border-b ${FC.hair}` : ""} ${FC.hair}`}>
      <div className="mx-auto" style={{ maxWidth: CONTENT_MAX }}>
        <div className={`relative border-l border-r ${FC.hair} ${className}`}>
          <CurvyRect />
          {children}
        </div>
      </div>
    </div>
  );
}

// SectionHeader — título (label-x-large 20/450/-0.1) + subtítulo (body-small @56%).
// `right` recebe ações (toggle de período, botão Create, etc).
export function SectionHeader({
  title,
  subtitle,
  right,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 border-b ${FC.hair} p-6 ${className}`}>
      <div className="min-w-0">
        <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>{title}</h2>
        {subtitle && <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// HairCells — grade flush. As bordas internas cruzam nas interseções → "+".
// cols controla as colunas no breakpoint lg. Cada filho deve ter seu próprio padding.
export function HairCells({
  children,
  cols = 4,
  gridLines = false,
  className = "",
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4 | 5;
  gridLines?: boolean; // true = também border-b (grids multi-linha de cards)
  className?: string;
}) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  const lg =
    cols === 5 ? "lg:grid-cols-5" : cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  // remove a border-r da última coluna em cada breakpoint pra não dobrar com a borda do frame
  const cellBorder =
    cols === 5
      ? "[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(5n)]:border-r-0"
      : cols === 4
        ? "[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(4n)]:border-r-0"
        : cols === 3
          ? "[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0"
          : "[&:nth-child(2n)]:border-r-0";
  return (
    <div className={`grid grid-cols-2 ${lg} ${className}`}>
      {items.map((child, i) => (
        <div key={i} className={`${gridLines ? "border-b " : ""}border-r ${FC.hair} ${cellBorder}`}>
          {child}
        </div>
      ))}
    </div>
  );
}

// Button — botões no estilo FC: h-9, rounded-lg, efeito active:scale-[0.98] + hover.
export function Button({
  children,
  variant = "primary",
  onClick,
  className = "",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const base =
    "h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-all active:scale-[0.98] select-none disabled:opacity-50 disabled:pointer-events-none";
  const v =
    variant === "primary"
      ? "px-3.5 text-white bg-[#003083] hover:bg-[#002266] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] shadow-[0_1px_2px_rgba(0,48,131,0.18)]"
      : variant === "secondary"
        ? `px-3.5 ${FC.ink} border ${FC.hair} ${FC.hover}`
        : `px-3 ${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`;
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}

// SegToggle — toggle segmentado (período 7/30/90d) no estilo FC.
export function SegToggle<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={`inline-flex rounded-lg border ${FC.hair} p-0.5`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`h-7 px-3 rounded-md text-[12.5px] font-medium transition-all active:scale-[0.97] ${
              active
                ? "bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12] shadow-[0_1px_2px_rgba(0,48,131,0.18)]"
                : `${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

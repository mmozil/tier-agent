import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";

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

// Acabamento Firecrawl (azul Tier): micro-sombras empilhadas + inset glow na base
// (profundidade/textura) + highlight sutil no topo. Mesmo tratamento do botão
// "Start crawling" do Firecrawl, na cor da marca Tier (#003083).
export const PRIMARY_SHADOW =
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-6px_12px_rgba(0,20,60,0.28),0_2px_4px_rgba(0,48,131,0.16),0_1px_1px_rgba(0,48,131,0.14),0_0.5px_0.5px_rgba(0,48,131,0.18),0_0.25px_0.25px_rgba(0,48,131,0.20)]";

// btnPrimary — classe única do botão primário (altura h-7, azul Tier + acabamento
// Firecrawl). Use em <button> crus pra ficarem idênticos ao componente <Button>.
// Prefixe "w-full" quando precisar largura cheia.
export const btnPrimary =
  `h-9 px-3.5 rounded-[10px] text-[14px] font-medium inline-flex items-center justify-center gap-1.5 text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${PRIMARY_SHADOW}`;

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
  curvy = true,
  className = "",
}: {
  children: ReactNode;
  last?: boolean;
  curvy?: boolean; // false = sem os cantos arredondados (CurvyRect)
  className?: string;
}) {
  return (
    <div className={`relative w-full border-t ${last ? `border-b ${FC.hair}` : ""} ${FC.hair}`}>
      <div className="mx-auto" style={{ maxWidth: CONTENT_MAX }}>
        <div className={`relative border-l border-r ${FC.hair} ${className}`}>
          {curvy && <CurvyRect />}
          {children}
        </div>
      </div>
    </div>
  );
}

// Spacer — faixa vazia FC entre blocos (linhas full-width se cruzam nas bordas +
// rails). É assim que o Firecrawl dá "respiro" sem soltar as linhas do conteúdo.
// SEM cantos arredondados (curvy) — é só a faixa/linha. h = altura (default 40px).
export function Spacer({ h = 40 }: { h?: number }) {
  return (
    <Row curvy={false}>
      <div style={{ height: h }} aria-hidden />
    </Row>
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

// PageHeroRidge — decoração ASCII topográfica ANIMADA (twinkle): caracteres acendem
// e apagam de leve (azul Tier), dando vida ao hero — à DIREITA, faint, mascarada.
// Animação sempre ativa (é só uma troca sutil de cor, sem transform/parallax).
// pointer-events-none.
const HERO_RIDGE = [
  "",
  "",
  " ..::..           ....",
  ":--==--::.......::----::.                 .::::::...  ..::",
  "=++*+++==-------==++++==-:              .:-=====---:::--==",
  "*xxxxxx**+++=+++**xxxx**+-:.          .:-=+*****+++===+++*",
  "X######XXxx***xxXXX###Xxx+=-:.      .:-=+*xXXXXXxxx****xxX",
  "###########XXX##########Xx*+=::....::=+*xX#########XXXX###",
];
const HERO_RIDGE_TXT = HERO_RIDGE.join("\n");
const HERO_RIDGE_CHARS = HERO_RIDGE_TXT.split("");
const HERO_RIDGE_IDXS = HERO_RIDGE_CHARS.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);

function PageHeroRidge() {
  const [lit, setLit] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const id = setInterval(() => {
      const s = new Set<number>();
      const k = Math.max(6, Math.round(HERO_RIDGE_IDXS.length * 0.05));
      for (let j = 0; j < k; j++) s.add(HERO_RIDGE_IDXS[Math.floor(Math.random() * HERO_RIDGE_IDXS.length)]);
      setLit(s);
    }, 360);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none absolute right-0 top-0 bottom-0 hidden md:flex items-end justify-end pr-8 overflow-hidden"
      style={{
        width: 480,
        WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
        maskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
      }}
    >
      <pre className="font-mono text-[8px] leading-[8px] whitespace-pre mb-7">
        {HERO_RIDGE_CHARS.map((c, i) =>
          c === "\n" ? (
            "\n"
          ) : (
            <span
              key={i}
              className={`transition-colors duration-500 ${
                lit.has(i)
                  ? "text-[#003083]/60 dark:text-[#5b9bff]/80"
                  : "text-[#262626]/[0.10] dark:text-white/[0.07]"
              }`}
            >
              {c}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

// PageHero — banner de topo (estilo página de API Keys do Firecrawl): título grande
// (28/semibold) + subtítulo + decoração ASCII faint à direita. `right` = ação opcional
// (ex: seletor de agente). Usar como 1ª <Row> de cada página de Configurações.
export function PageHero({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Row>
      <div className="relative overflow-hidden">
        <PageHeroRidge />
        <div className="relative flex items-start justify-between gap-4 px-6 py-11">
          <div className="min-w-0">
            <h1 className={`text-[28px] font-semibold tracking-[-0.4px] leading-9 fc-crisp ${FC.ink}`}>{title}</h1>
            {subtitle && <p className={`text-[14px] leading-6 mt-2 max-w-[600px] ${FC.sub}`}>{subtitle}</p>}
          </div>
          {right && <div className="relative shrink-0">{right}</div>}
        </div>
      </div>
    </Row>
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

// iconBtn — botão-ícone quadrado (w-9 h-9 = MESMA altura dos botões de texto), ghost.
// Use em <button>/<Link> só-ícone (topbar, ações de tabela). Ícone interno: w-4 h-4
// (ou w-[18px] em destaque). Spec Firecrawl: 36px, rounded-10.
export const iconBtn =
  `w-9 h-9 inline-flex items-center justify-center rounded-[10px] ${FC.dim} hover:text-[#262626] dark:hover:text-white ${FC.hover} transition-all active:scale-[0.95] disabled:opacity-50 disabled:pointer-events-none`;

// Button — botão canônico do admin no spec REAL do Firecrawl: ALTURA e FONTE ÚNICAS
// (h-9 / 36px · texto 14px/label-medium · rounded-10), só o padding-x muda entre
// sm/md. Assim TODO botão de ação tem o mesmo tamanho visual. active:scale + hover.
// Todo botão de texto deve usar este componente (ou btnPrimary/iconBtn).
export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  className = "",
  type = "button",
  disabled = false,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-all active:scale-[0.98] select-none disabled:opacity-50 disabled:pointer-events-none";
  // Altura E FONTE ÚNICAS (h-9 / 36px · 14px) pros dois tamanhos — só o padding-x
  // varia (sm = mais compacto). Garante que todo botão de ação tenha o MESMO tamanho.
  const sz = "h-9 text-[14px]";
  const padX = size === "sm" ? "px-3" : "px-3.5";
  const v =
    variant === "primary"
      ? `${padX} text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] ${PRIMARY_SHADOW}`
      : variant === "secondary"
        ? `${padX} ${FC.ink} border ${FC.hair} ${FC.hover} shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.04)]`
        : variant === "danger"
          ? `${padX} text-[#c0362c] dark:text-[#ff6b5e] hover:bg-[#c0362c]/[0.06] dark:hover:bg-[#ff6b5e]/[0.10]`
          : `${size === "sm" ? "px-2" : "px-3"} ${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`;
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${sz} ${v} ${className}`}>
      {children}
    </button>
  );
}

// ── Primitivos de polish (jun/2026) — compartilhados por todas as páginas admin ──

// SKEL — classe base de skeleton: carregando, a página mostra a própria forma
// (não um spinner no vazio). Respeita prefers-reduced-motion.
export const SKEL = "rounded bg-black/[0.06] dark:bg-white/[0.07] animate-pulse motion-reduce:animate-none";

// SkeletonBar — barra de skeleton; dimensione via className (ex: "h-3 w-24").
export function SkeletonBar({ className = "h-3 w-24" }: { className?: string }) {
  return <div aria-hidden className={`${SKEL} ${className}`} />;
}

// EmptyHint — estado vazio que ENSINA: o que significa + próxima ação
// (PRODUCT.md, princípio 3). Use no lugar de texto cinza "Sem dados".
export function EmptyHint({
  icon: Icon,
  text,
  ctaLabel,
  ctaTo,
  className = "",
}: {
  icon: ComponentType<{ className?: string }>;
  text: string;
  ctaLabel?: string;
  ctaTo?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center text-center py-6 ${className}`}>
      <Icon className={`w-5 h-5 mb-2 ${FC.mut}`} />
      <p className={`text-[13px] ${FC.sub}`}>{text}</p>
      {ctaLabel && ctaTo && (
        <Link
          to={ctaTo}
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#003083] dark:text-[#5b9bff] hover:underline"
        >
          {ctaLabel}
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}

// Select — dropdown customizado no padrão Firecrawl (substitui o <select> nativo do
// SO, que não casa com o design). Trigger h-9 + painel flutuante com hover/check.
// Genérico sobre o tipo do value (string | number). Fecha no clique-fora / Esc.
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Selecionar…",
  className = "",
  disabled = false,
}: {
  value: T | null | undefined;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (v: T) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full h-9 pl-3 pr-2 inline-flex items-center justify-between gap-2 rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} text-[14px] ${FC.ink} outline-none transition-shadow ${
          open ? "shadow-[0_0_0_2px_#003083]" : "hover:border-[#d8d8d8] dark:hover:border-[#33373e]"
        } disabled:opacity-50 disabled:pointer-events-none`}
      >
        <span className="min-w-0 flex items-center gap-2 truncate">
          {sel?.icon}
          {sel ? <span className="truncate">{sel.label}</span> : <span className={FC.mut}>{placeholder}</span>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 ${FC.mut} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute z-50 mt-1 w-full max-h-[280px] overflow-y-auto sidebar-scroll rounded-[10px] border ${FC.hair} bg-white dark:bg-[#14171c] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.12)]`}
        >
          {options.length === 0 ? (
            <div className={`px-2.5 py-2 text-[13px] ${FC.mut}`}>Nenhuma opção</div>
          ) : (
            options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`w-full h-8 px-2.5 rounded-[7px] inline-flex items-center gap-2 text-[13px] text-left transition-colors ${
                    active
                      ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#8ab4ff] font-medium"
                      : `${FC.ink} hover:bg-black/[0.04] dark:hover:bg-white/[0.05]`
                  }`}
                >
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
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
    <div className={`inline-flex rounded-[10px] border ${FC.hair} p-0.5`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`h-8 px-3 rounded-[8px] text-[13px] font-medium transition-all active:scale-[0.97] ${
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

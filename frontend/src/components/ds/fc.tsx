import type { ComponentType, MouseEvent, ReactNode } from "react";
import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, ChevronDown, Search } from "lucide-react";

// ScrambleText — efeito "decode" (estilo Firecrawl): no mount as letras aparecem
// embaralhadas e se resolvem da esquerda pra direita até o texto final. Anti-jitter:
// um sizer invisível com o texto final reserva a largura; o scramble fica por cima.
const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$<>/";
export function ScrambleText({ text, className = "", speed = 38 }: { text: string; className?: string; speed?: number }) {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    const total = text.length;
    const revealAt = text.split("").map((_, i) => 3 + Math.floor(i * 1.4) + Math.floor(Math.random() * 4));
    const maxFrame = (revealAt.length ? Math.max(...revealAt) : 1) + 1;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      let out = "";
      for (let i = 0; i < total; i++) {
        const ch = text[i];
        if (ch === " ") out += " ";
        else out += frame >= revealAt[i] ? ch : SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
      }
      setDisplay(out);
      if (frame >= maxFrame) {
        clearInterval(id);
        setDisplay(text);
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <span className={`relative inline-block align-bottom overflow-hidden ${className}`}>
      <span aria-hidden style={{ visibility: "hidden" }}>{text}</span>
      <span className="absolute inset-0 whitespace-nowrap text-left">{display}</span>
    </span>
  );
}

// Aplica scramble nos filhos-texto (mantém ícones intactos).
function scrambleChildren(children: ReactNode): ReactNode {
  return Children.map(children, (c) => (typeof c === "string" ? <ScrambleText text={c} /> : c));
}

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

// ── Campo, rótulo e pílula de escolha (12/11/2026) ──────────────────────────────
// O painel do contato tinha 4 jeitos de campo (raio 8/10/cheio, borda #EDEDED e #E4E4E4,
// texto 12/12,5/14, foco por anel ou por cor da borda). Agora há UM: o mesmo gatilho do
// <Select/> — 32 px, raio 10, linha fina, texto 14, anel azul no foco. Escolha ativa
// (pílula) usa o azul 7% da opção selecionada do <Select/>.
export const campoCls =
  `w-full h-8 px-3 rounded-[10px] bg-white dark:bg-[#14171c] border border-[#EDEDED] dark:border-[#23272e] text-[14px] text-[#262626] dark:text-[#e6e8eb] outline-none transition-shadow hover:border-[#d8d8d8] dark:hover:border-[#33373e] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] disabled:opacity-50`;
export const rotuloCls = "block mb-1.5 text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0]";
export function pilulaCls(ativa: boolean): string {
  return `h-7 px-2.5 inline-flex items-center rounded-full border text-[12px] transition-colors ${
    ativa
      ? "border-[#003083]/30 bg-[#003083]/[0.07] text-[#003083] font-medium dark:border-[#5b9bff]/40 dark:bg-[#5b9bff]/[0.12] dark:text-[#8ab4ff]"
      : "border-[#EDEDED] dark:border-[#23272e] text-[#262626]/[0.56] dark:text-[#8b93a0] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
  }`;
}

// btnPrimary — classe única do botão primário (altura h-7, azul Tier + acabamento
// Firecrawl). Use em <button> crus pra ficarem idênticos ao componente <Button>.
// Prefixe "w-full" quando precisar largura cheia.
export const btnPrimary =
  `h-8 px-3 rounded-[10px] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] transition-all active:scale-[0.98] outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/30 disabled:opacity-50 disabled:pointer-events-none`;

// useIsDark — o tema é a classe `dark` no <html> (ver ThemeToggle/main.tsx), então
// componentes que precisam de cor em ESTILO INLINE (canvas, libs de terceiros que
// não aceitam className) não conseguem usar as variantes `dark:`. Este hook observa
// a classe e re-renderiza na troca, mantendo essas superfícies em sincronia.
// Para tudo que aceita className, prefira os tokens FC — não use este hook.
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

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

// PageHeroRidge — chuva "MATRIX" em azul Tier no canto inferior direito: colunas de
// caracteres caem devagar; cabeça brilhante (azul claro) + rastro azul que some.
// Canvas, ritmo calmo, mascarado (radial, denso no canto). pointer-events-none.
const HERO_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽ0123456789<>=+*#%XY".split("");

export function PageHeroRidge() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cx = ctx;
    const FS = 11;
    const LH = 13;
    const W = 380;
    const H = 132;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const font = `${FS}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    cx.scale(dpr, dpr);
    cx.font = font;
    cx.textBaseline = "top";
    const cw = cx.measureText("0").width || FS * 0.6;
    const cols = Math.floor(W / cw);
    const rows = Math.ceil(H / LH) + 1;
    const TRAIL = 9;
    const rnd = () => Math.random();
    const head = Array.from({ length: cols }, () => -Math.floor(rnd() * rows * 1.6));
    const speed = Array.from({ length: cols }, () => 0.04 + rnd() * 0.07); // LENTO/calmo
    let frame = 0, raf = 0;
    const glyph = (c: number, row: number) => HERO_GLYPHS[Math.abs((c * 31 + row * 17 + (frame >> 4)) % HERO_GLYPHS.length)];
    const draw = () => {
      cx.clearRect(0, 0, W, H);
      for (let c = 0; c < cols; c++) {
        head[c] += speed[c];
        if (head[c] - TRAIL > rows) head[c] = -Math.floor(rnd() * rows); // reinicia escalonado
        const h = Math.floor(head[c]);
        for (let k = 0; k < TRAIL; k++) {
          const row = h - k;
          if (row < 0 || row >= rows) continue;
          if (k === 0) cx.fillStyle = "rgba(120,170,255,0.95)"; // cabeça brilhante
          else cx.fillStyle = `rgba(0,48,131,${(1 - k / TRAIL) * 0.5})`; // rastro azul Tier
          cx.fillText(glyph(c, row), c * cw, row * LH);
        }
      }
      frame++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none absolute right-0 bottom-0 hidden md:block"
      style={{
        WebkitMaskImage: "radial-gradient(150% 150% at 100% 100%, #000 42%, transparent 84%)",
        maskImage: "radial-gradient(150% 150% at 100% 100%, #000 42%, transparent 84%)",
      }}
    >
      <canvas ref={ref} />
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
  cols?: 2 | 3 | 4 | 5 | 6;
  gridLines?: boolean; // true = também border-b (grids multi-linha de cards)
  className?: string;
}) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  const lg =
    cols === 6 ? "lg:grid-cols-6" : cols === 5 ? "lg:grid-cols-5" : cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  // remove a border-r da última coluna em cada breakpoint pra não dobrar com a borda do frame
  const cellBorder =
    cols === 6
      ? "[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(6n)]:border-r-0"
      : cols === 5
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

// iconBtn — botão-ícone quadrado (w-8 h-8 = MESMA altura dos botões de texto), ghost.
// Use em <button>/<Link> só-ícone (ações de tabela, modais). Ícone interno: w-4 h-4.
// Spec Firecrawl (corpo): 32px, rounded-10. (Topbar usa tamanho próprio, maior.)
export const iconBtn =
  `w-8 h-8 inline-flex items-center justify-center rounded-[10px] ${FC.dim} hover:text-[#262626] dark:hover:text-white ${FC.hover} transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none`;

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
  scramble,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  scramble?: boolean; // efeito decode no texto (default: ligado no primary)
}) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[12px] font-medium transition-all active:scale-[0.98] select-none outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/30 disabled:opacity-50 disabled:pointer-events-none [&_svg]:shrink-0";
  // Tamanho default: h-8 / 32px · texto 12px · px-3 · gap-1.5.
  const sz = "h-8";
  const padX = size === "sm" ? "px-2.5" : "px-3";
  const v =
    variant === "primary"
      ? `${padX} text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff]`
      : variant === "secondary"
        ? `${padX} ${FC.ink} border ${FC.hair} ${FC.hover}`
        : variant === "danger"
          ? `${padX} text-[#c0362c] dark:text-[#ff6b5e] hover:bg-[#c0362c]/[0.06] dark:hover:bg-[#ff6b5e]/[0.10]`
          : `${padX} ${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`;
  const doScramble = scramble ?? variant === "primary"; // primary tem decode por padrão
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${sz} ${v} ${className}`}>
      {doScramble ? scrambleChildren(children) : children}
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
/** O texto de um rótulo que pode ser JSX — a busca do Select procura nele. */
function textoDoNo(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textoDoNo).join(" ");
  if (isValidElement(n)) return textoDoNo((n.props as { children?: ReactNode }).children);
  return "";
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A partir daqui a lista ganha o campo de busca — a mesma regra das listas do CRM (25/09/2026). */
const BUSCA_A_PARTIR_DE = 9;

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Selecionar…",
  className = "",
  disabled = false,
}: {
  value: T | null | undefined;
  /** `busca`: texto extra para a busca (sem ele, procura no texto do rótulo). */
  options: { value: T; label: ReactNode; icon?: ReactNode; busca?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // 09/11/2026 (M7): busca dentro da lista — «ao ir digitando vai aparecendo o que tem na lista».
  const comBusca = options.length >= BUSCA_A_PARTIR_DE;
  const [busca, setBusca] = useState("");
  const [destaque, setDestaque] = useState(0);
  useEffect(() => {
    if (!open) setBusca("");
  }, [open]);
  const termo = semAcento(busca.trim());
  const visiveis = termo
    ? options.filter((o) => semAcento(o.busca ?? textoDoNo(o.label)).includes(termo))
    : options;
  useEffect(() => setDestaque(0), [busca, open]);
  const escolher = (o: { value: T }) => {
    onChange(o.value);
    setOpen(false);
  };
  const ref = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 09/11/2026 (M7): a lista é desenhada SOLTA na página (portal), na posição do campo.
  // Dentro de uma caixa que corta o que passa da borda (a sanfona «Ações da conversa» do
  // painel do contato), a lista da Prioridade abria por trás da seção de baixo.
  // Sem espaço embaixo, abre para cima.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const posicionar = useCallback(() => {
    const b = botaoRef.current?.getBoundingClientRect();
    if (!b) return;
    const abaixo = window.innerHeight - b.bottom - 8;
    const acima = b.top - 8;
    const paraCima = abaixo < 200 && acima > abaixo;
    const max = Math.max(120, Math.min(280, (paraCima ? acima : abaixo) - 4));
    setPos(
      paraCima
        ? { left: b.left, width: b.width, bottom: window.innerHeight - b.top + 4, max }
        : { left: b.left, width: b.width, top: b.bottom + 4, max },
    );
  }, []);
  useLayoutEffect(() => {
    if (open) posicionar();
  }, [open, posicionar]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      const alvo = e.target as Node;
      if (ref.current?.contains(alvo) || menuRef.current?.contains(alvo)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A página ou o painel rolou / a janela mudou: a lista acompanha o campo.
    const onMover = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      posicionar();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMover);
    window.addEventListener("scroll", onMover, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMover);
      window.removeEventListener("scroll", onMover, true);
    };
  }, [open, posicionar]);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={botaoRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full h-8 pl-3 pr-2 inline-flex items-center justify-between gap-2 rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} text-[14px] ${FC.ink} outline-none transition-shadow ${
          open ? "shadow-[0_0_0_2px_#003083]" : "hover:border-[#d8d8d8] dark:hover:border-[#33373e]"
        } disabled:opacity-50 disabled:pointer-events-none`}
      >
        <span className="min-w-0 flex items-center gap-2 truncate">
          {sel?.icon}
          {sel ? <span className="truncate">{sel.label}</span> : <span className={FC.mut}>{placeholder}</span>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 ${FC.mut} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.max + (comBusca ? 44 : 0), zIndex: 1000 }}
          className={`flex flex-col rounded-[10px] border ${FC.hair} bg-white dark:bg-[#14171c] shadow-[0_8px_28px_rgba(0,0,0,0.12)]`}
        >
          {comBusca && (
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
                      const o = visiveis[destaque];
                      if (o) escolher(o);
                    }
                  }}
                  placeholder="Buscar…"
                  aria-label="Buscar na lista"
                  className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#262626]/40 dark:placeholder:text-white/30 ${FC.ink}`}
                />
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto sidebar-scroll p-1">
          {visiveis.length === 0 ? (
            <div className={`px-2.5 py-2 text-[13px] ${FC.mut}`}>{termo ? "Nada encontrado" : "Nenhuma opção"}</div>
          ) : (
            visiveis.map((o, i) => {
              const active = o.value === value;
              const realce = comBusca && termo !== "" && i === destaque && !active;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => escolher(o)}
                  onMouseEnter={() => comBusca && setDestaque(i)}
                  className={`w-full h-8 px-2.5 rounded-[7px] inline-flex items-center gap-2 text-[13px] text-left transition-colors ${
                    active
                      ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12] text-[#003083] dark:text-[#8ab4ff] font-medium"
                      : realce
                        ? `${FC.ink} bg-black/[0.05] dark:bg-white/[0.07]`
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
        </div>,
        document.body,
      )}
    </div>
  );
}

// SegToggle — toggle segmentado (período 7/30/90d) no estilo FC.
// `compacto` (12/11/2026): 32 px no total, a mesma altura do campo (`campoCls`) — para ficar
// na mesma linha de um campo sem degrau.
export function SegToggle<T extends string | number>({
  value,
  options,
  onChange,
  compacto = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  compacto?: boolean;
}) {
  return (
    <div className={`inline-flex shrink-0 rounded-[10px] border ${FC.hair} p-0.5`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`${compacto ? "h-[26px] px-2.5 rounded-[8px] tabular-nums" : "h-8 px-3 rounded-[10px]"} text-[12px] font-medium transition-all active:scale-[0.98] ${
              active
                ? "bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12]"
                : `${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover}`
            }`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Interruptor — liga/desliga (10/11/2026, botão «IA ligada» do número). Ligado na cor
// da marca, desligado em cinco. `role="switch"` + `aria-checked` para leitor de tela.
export function Interruptor({
  ligado,
  onChange,
  disabled,
  label,
  title,
}: {
  ligado: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/30 disabled:opacity-50 disabled:pointer-events-none ${
        ligado ? "bg-[#003083] dark:bg-[#5b9bff]" : "bg-[#262626]/[0.18] dark:bg-white/[0.16]"
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform ${
          ligado ? "translate-x-[16px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// useConfirmar — confirmação no padrão do sistema (10/11/2026). Substitui o `confirm()` do
// navegador, que abre a caixa cinza «agent.tier.finance diz» com OK/Cancelar soltos (o dono
// pediu para arrumar). Uso:
//   const [confirmar, janelaConfirmar] = useConfirmar();
//   if (!(await confirmar({ titulo: "…", texto: "…", confirmar: "Desligar" }))) return;
//   …e renderizar {janelaConfirmar} uma vez na página.
export type PedidoConfirmacao = {
  titulo: string;
  texto?: ReactNode;
  confirmar: string;
  cancelar?: string;
  /** Ação que derruba algo (vermelho) — desconectar, remover. */
  perigo?: boolean;
};

export function useConfirmar(): [(p: PedidoConfirmacao) => Promise<boolean>, ReactNode] {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { resolver: (v: boolean) => void }) | null>(null);
  const confirmar = useCallback(
    (p: PedidoConfirmacao) => new Promise<boolean>((resolver) => setPedido({ ...p, resolver })),
    [],
  );
  const fechar = useCallback(
    (v: boolean) => {
      setPedido((atual) => {
        atual?.resolver(v);
        return null;
      });
    },
    [],
  );
  useEffect(() => {
    if (!pedido) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pedido, fechar]);
  const janela = pedido
    ? createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={() => fechar(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmar-titulo"
            className={`w-full max-w-[420px] rounded-2xl border bg-white p-6 shadow-2xl dark:bg-[#0c0e12] ${FC.hair}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirmar-titulo" className={`text-[16px] font-medium leading-6 ${FC.ink}`}>
              {pedido.titulo}
            </h2>
            {pedido.texto && <div className={`mt-2 text-[13px] leading-relaxed ${FC.sub}`}>{pedido.texto}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => fechar(false)}>
                {pedido.cancelar || "Cancelar"}
              </Button>
              <button
                type="button"
                autoFocus
                onClick={() => fechar(true)}
                className={
                  pedido.perigo
                    ? "h-8 px-3 rounded-[10px] text-[12px] font-medium inline-flex items-center justify-center text-white bg-[#E5484D] hover:bg-[#d13f44] transition-all active:scale-[0.98] outline-none focus-visible:ring-[3px] focus-visible:ring-[#E5484D]/30"
                    : btnPrimary
                }
              >
                {pedido.confirmar}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
  return [confirmar, janela];
}

/* ───────────────────────────────────────────────────────────────
   Primitivas de formulário e layout (ago/2026)

   Existiam 8 variantes locais de `inputCls` espalhadas pelas páginas admin,
   com 2 alturas e 2 raios diferentes. Espalhadas ninguém nota; empilhadas
   numa coluna só, viram serrote. Estas são a versão única.
   ─────────────────────────────────────────────────────────────── */

// Superfície de campo — a mesma do trigger do <Select>, pra input e select
// terem exatamente o mesmo peso visual lado a lado.
export const fieldSurface =
  `w-full rounded-[10px] bg-white dark:bg-[#14171c] border border-[#EDEDED] dark:border-[#23272e] text-[#262626] dark:text-[#e6e8eb] outline-none transition-shadow placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff] disabled:opacity-50 disabled:pointer-events-none`;

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldSurface} h-8 px-3 text-[13px] ${className}`} />;
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldSurface} px-3 py-2 text-[13px] leading-5 ${className}`} />;
}

// Field — rótulo + campo + dica/contador. `right` recebe contador de caracteres,
// estado de salvamento, etc.
export function Field({
  label,
  hint,
  right,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label className={`text-[12px] font-medium ${FC.sub}`}>{label}</label>
        {right && <span className={`text-[11px] font-mono tabular-nums shrink-0 ${FC.mut}`}>{right}</span>}
      </div>
      {children}
      {hint && <p className={`mt-1.5 text-[11px] leading-4 ${FC.mut}`}>{hint}</p>}
    </div>
  );
}

// Section — bloco colapsável da coluna de configuração. Título + contador +
// ação à direita. O estado de aberto/fechado persiste por chave, pra tela voltar
// como a pessoa deixou. Substitui ABA: aba troca de tela e mata o que estava em
// foco; seção convive e rola.
export function Section({
  id,
  title,
  count,
  right,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: ReactNode;
  count?: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `ta-sec-${id}`;
  const [open, setOpen] = useState(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return v === null ? defaultOpen : v === "1";
  });
  /* Abrir DE FORA (o índice da página). Sem isto, clicar em "Conhecimento" no
     índice rolava até uma seção recolhida — uma barra de 60px — e a pessoa
     via "não abriu nada". O evento evita subir o estado de todas as seções
     para o pai só para um clique. */
  useEffect(() => {
    const abrir = (ev: Event) => {
      if ((ev as CustomEvent<string>).detail === id) setOpen(true);
    };
    window.addEventListener("ta-secao-abrir", abrir);
    return () => window.removeEventListener("ta-secao-abrir", abrir);
  }, [id]);
  useEffect(() => {
    try {
      localStorage.setItem(key, open ? "1" : "0");
    } catch {
      /* modo privado — só não persiste */
    }
  }, [key, open]);

  // Estrutura do Firecrawl (mesma do <Row>): a LINHA horizontal atravessa a
  // largura toda, o conteúdo vive entre RAILS (border-l/r) e os cantos ganham
  // os brackets do CurvyRect — é o cruzamento linha×rail que desenha o "+".
  // Sem isso a seção vira uma faixa cinza genérica de admin qualquer.
  return (
    <section id={id} className={`relative w-full border-t ${FC.hair} scroll-mt-2`}>
      <div className="mx-auto" style={{ maxWidth: CONTENT_MAX }}>
        <div className={`relative border-l border-r ${FC.hair}`}>
          <CurvyRect />
          <div className="flex items-center gap-3 px-6 pt-5 pb-4">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="group flex items-baseline gap-2.5 min-w-0 flex-1 text-left"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 self-center ${FC.mut} transition-transform ${open ? "" : "-rotate-90"}`}
              />
              {/* label-x-large do FC: 20/450/-0.1 — é o degrau que dava falta
                  na hierarquia (título de seção estava no mesmo peso do corpo) */}
              <span className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 truncate fc-crisp ${FC.ink}`}>
                {title}
              </span>
              {count !== undefined && count !== null && (
                <span className={`text-[12px] font-mono tabular-nums shrink-0 ${FC.mut}`}>{count}</span>
              )}
            </button>
            {right && <div className="shrink-0">{right}</div>}
          </div>
          {/* Abre/fecha DESLIZANDO. O truque do grid (0fr -> 1fr) anima altura sem
              precisar medir o conteudo em JS — que e o que quebra quando o texto
              muda de tamanho. `interpolate-size` nao tem suporte largo ainda.
              Respeita prefers-reduced-motion. */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
            style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className={`px-6 pb-6 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// SplitPane — duas colunas com divisória arrastável e largura persistida.
// A da direita é a que fica fixa (painel de teste); a da esquerda rola.
// Duplo-clique na divisória volta ao padrão.
export function SplitPane({
  storageKey,
  left,
  right,
  defaultRightPct = 42,
  minLeftPx = 420,
  minRightPx = 360,
  rightCollapsed = false,
  collapsedRightPx = 64,
}: {
  storageKey: string;
  left: ReactNode;
  right: ReactNode;
  defaultRightPct?: number;
  minLeftPx?: number;
  minRightPx?: number;
  /** Painel da direita RECOLHIDO numa régua estreita (sem arrastar). A largura
      aberta continua guardada, então reabrir volta ao tamanho de antes. */
  rightCollapsed?: boolean;
  collapsedRightPx?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rightPct, setRightPct] = useState(() => {
    const v = parseFloat(localStorage.getItem(storageKey) || "");
    return Number.isFinite(v) ? v : defaultRightPct;
  });
  const [dragging, setDragging] = useState(false);

  function clampPct(pct: number): number {
    const w = wrapRef.current?.clientWidth || 1200;
    const minRight = (minRightPx / w) * 100;
    const maxRight = 100 - (minLeftPx / w) * 100;
    if (maxRight < minRight) return pct; // tela estreita: não força
    return Math.min(maxRight, Math.max(minRight, pct));
  }

  function startDrag(e: { preventDefault: () => void }) {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: globalThis.MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRightPct(clampPct(((r.right - ev.clientX) / r.width) * 100));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(false);
      setRightPct((p) => {
        try {
          localStorage.setItem(storageKey, String(p));
        } catch {
          /* ignore */
        }
        return p;
      });
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 w-full">
      <div className="min-w-0 flex-1 overflow-y-auto sidebar-scroll">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startDrag}
        onDoubleClick={() => {
          setRightPct(defaultRightPct);
          try {
            localStorage.setItem(storageKey, String(defaultRightPct));
          } catch {
            /* ignore */
          }
        }}
        title={rightCollapsed ? undefined : "Arraste para redimensionar · duplo-clique para redefinir"}
        className={`relative w-px shrink-0 ${FC.hairBg} after:absolute after:inset-y-0 after:-left-2 after:-right-2 after:content-[''] transition-colors ${
          rightCollapsed
            ? "pointer-events-none"
            : `cursor-col-resize ${dragging ? "bg-[#003083] dark:bg-[#5b9bff]" : "hover:bg-[#003083]/40 dark:hover:bg-[#5b9bff]/40"}`
        }`}
      />
      {/* A largura anima entre % e px (o CSS interpola via calc). Durante o
          arrasto a transição sai, senão o painel fica correndo atrás do mouse. */}
      {/* 🚨 `overflow-hidden` é o que faz o deslize existir. Sem ele o conteúdo
          do painel aparece inteiro no primeiro quadro, transbordando a
          largura que ainda está crescendo — e o olho lê "abriu seco", mesmo
          com a largura animando. Com ele, a largura vira uma cortina que
          revela o painel. 520ms com curva de saída longa: rápido no começo,
          assenta devagar. */}
      <div
        className={`shrink-0 min-w-0 flex flex-col overflow-hidden ${
          dragging ? "" : "transition-[width] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        }`}
        style={{ width: rightCollapsed ? `${collapsedRightPx}px` : `${rightPct}%` }}
      >
        {right}
      </div>
    </div>
  );
}

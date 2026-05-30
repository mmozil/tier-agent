import type { ReactNode } from "react";

/* ─────────────────────────────────────────────────────────────
   Efeitos "premium" (padrão Aceternity / Magic UI, MIT) recriados
   com Tailwind + CSS. Usados pra dar polish ao hero/mockup.
   ──────────────────────────────────────────────────────────── */

// Anel de luz percorrendo a borda (conic-gradient girando) — Magic UI BorderBeam
export function BorderBeam({
  children,
  className = "",
  radius = "rounded-2xl",
  from = "#003083",
  to = "#38BDF8",
  duration = 8,
}: {
  children: ReactNode;
  className?: string;
  radius?: string;
  from?: string;
  to?: string;
  duration?: number;
}) {
  return (
    <div className={`relative ${radius} p-[1.5px] overflow-hidden ${className}`}>
      <div
        className="absolute inset-[-150%] animate-spinslow"
        style={{
          background: `conic-gradient(from 0deg, transparent 0 62%, ${to} 80%, ${from} 92%, transparent 100%)`,
          animationDuration: `${duration}s`,
        }}
      />
      <div className={`relative ${radius}`}>{children}</div>
    </div>
  );
}

// Spotlight suave no topo (Aceternity) — radial blur tingido de acento
export function Spotlight({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${className}`}
      style={{
        background: "radial-gradient(60% 60% at 50% 30%, rgba(0,48,131,.10), rgba(56,189,248,.05) 45%, transparent 75%)",
        filter: "blur(6px)",
      }}
    />
  );
}

// Fundo de grade pontilhada com máscara radial (some nas bordas) — Aceternity grid
export function GridFade({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 bg-dots-lg ${className}`}
      style={{
        maskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, #000 40%, transparent 80%)",
        WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, #000 40%, transparent 80%)",
      }}
    />
  );
}

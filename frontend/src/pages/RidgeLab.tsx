import { useEffect, useRef, useState } from "react";

// Laboratório de variantes ANIMADAS pro ridge decorativo do hero (PageHeroRidge).
// Rota pública /ridge-lab — só pra escolher qual efeito usar. Removo depois.

const RIDGE = [
  "",
  "",
  " ..::..           ....",
  ":--==--::.......::----::.                 .::::::...  ..::",
  "=++*+++==-------==++++==-:              .:-=====---:::--==",
  "*xxxxxx**+++=+++**xxxx**+-:.          .:-=+*****+++===+++*",
  "X######XXxx***xxXXX###Xxx+=-:.      .:-=+*xXXXXXxxx****xxX",
  "###########XXX##########Xx*+=::....::=+*xX#########XXXX###",
];
const RIDGE_TXT = RIDGE.join("\n");

const wrap = "pointer-events-none select-none absolute right-0 top-0 bottom-0 hidden md:flex items-end justify-end pr-8 overflow-hidden";
const wrapStyle = {
  width: 480,
  WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
  maskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
} as const;
const preBase = "font-mono text-[8px] leading-[8px] whitespace-pre mb-7";

/* 0 — Atual (estático), pra comparar */
function StaticRidge() {
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <pre className={`${preBase} text-[#262626]/[0.10]`}>{RIDGE_TXT}</pre>
    </div>
  );
}

/* 1 — Shimmer: uma luz azul varre o ridge da direita pra esquerda */
function ShimmerRidge() {
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <div className="relative mb-7">
        <pre className={`${preBase} mb-0 text-[#262626]/[0.10]`}>{RIDGE_TXT}</pre>
        <pre className={`${preBase} mb-0 absolute inset-0 ridge-shimmer`}>{RIDGE_TXT}</pre>
      </div>
    </div>
  );
}

/* 2 — Drift: o ridge desliza devagar e "respira" (opacidade) */
function DriftRidge() {
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <pre className={`${preBase} ridge-drift text-[#003083]`}>{RIDGE_TXT}</pre>
    </div>
  );
}

/* 3 — Twinkle: caracteres acendem/apagam como brasas vivas */
function TwinkleRidge() {
  const chars = RIDGE_TXT.split("");
  const [lit, setLit] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const idxs = chars.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    const id = setInterval(() => {
      const s = new Set<number>();
      for (let k = 0; k < 10; k++) s.add(idxs[Math.floor(Math.random() * idxs.length)]);
      setLit(s);
    }, 360);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <pre className={`${preBase}`}>
        {chars.map((c, i) =>
          c === "\n" ? (
            "\n"
          ) : (
            <span key={i} style={{ color: lit.has(i) ? "rgba(0,48,131,0.55)" : "rgba(38,38,38,0.10)", transition: "color 0.5s ease" }}>
              {c}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

/* 4 — Wave (canvas): campo topográfico de pontos que ondula (estilo Firecrawl real) */
function WaveCanvasRidge() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cx = ctx;
    const W = 480, H = 150, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cx.scale(dpr, dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gap = 7;
    let t = 0, raf = 0;
    function draw() {
      cx.clearRect(0, 0, W, H);
      for (let y = 0; y < H; y += gap) {
        for (let x = 0; x < W; x += gap) {
          const v = Math.sin(x * 0.026 + t) * Math.cos(y * 0.05 - t * 0.7) + Math.sin((x + y) * 0.02 + t * 1.2);
          const n = (v + 2) / 4; // 0..1
          const a = Math.max(0, n - 0.5) * 0.55 * (y / H + 0.25);
          if (a > 0.02) {
            cx.fillStyle = `rgba(0,48,131,${a})`;
            cx.fillRect(x, y, 1.7, 1.7);
          }
        }
      }
      t += 0.02;
      if (!reduce) raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <canvas ref={ref} style={{ width: 480, height: 150 }} className="mb-1" />
    </div>
  );
}

/* 5 — Flow (canvas): a densidade escorre pra baixo, tipo chuva fininha */
function FlowCanvasRidge() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cx = ctx;
    const W = 480, H = 150, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cx.scale(dpr, dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gap = 7;
    let t = 0, raf = 0;
    function draw() {
      cx.clearRect(0, 0, W, H);
      for (let y = 0; y < H; y += gap) {
        for (let x = 0; x < W; x += gap) {
          const phase = Math.sin(x * 0.04 + t * 1.5 + y * 0.08);
          const n = (phase + 1) / 2;
          const a = Math.max(0, n - 0.45) * 0.5 * (y / H + 0.2);
          if (a > 0.02) {
            cx.fillStyle = `rgba(0,48,131,${a})`;
            cx.fillRect(x, y, 1.6, 2.4);
          }
        }
      }
      t += 0.03;
      if (!reduce) raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <canvas ref={ref} style={{ width: 480, height: 150 }} className="mb-1" />
    </div>
  );
}

const VARIANTS: { n: number; name: string; desc: string; C: () => JSX.Element }[] = [
  { n: 0, name: "Atual (estático)", desc: "O que está hoje — sem movimento.", C: StaticRidge },
  { n: 1, name: "Shimmer", desc: "Uma luz azul varre o ridge devagar (CSS, leve, elegante).", C: ShimmerRidge },
  { n: 2, name: "Drift / respira", desc: "O ridge desliza de leve e pulsa a opacidade (CSS, bem sutil).", C: DriftRidge },
  { n: 3, name: "Twinkle / brasas", desc: "Caracteres acendem e apagam aleatoriamente — textura viva.", C: TwinkleRidge },
  { n: 4, name: "Wave (canvas) ★", desc: "Campo topográfico de pontos que ondula — o mais perto do Firecrawl real.", C: WaveCanvasRidge },
  { n: 5, name: "Flow (canvas)", desc: "A densidade escorre pra baixo, tipo chuva fininha de pontos.", C: FlowCanvasRidge },
];

export default function RidgeLab() {
  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#262626] py-10 px-6">
      <style>{`
        .ridge-shimmer {
          background: linear-gradient(110deg, transparent 38%, rgba(0,48,131,0.45) 50%, transparent 62%);
          background-size: 280% 100%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: ridgeShimmer 4.5s linear infinite;
        }
        @keyframes ridgeShimmer { from { background-position: 200% 0; } to { background-position: -120% 0; } }
        .ridge-drift { color: rgba(0,48,131,0.10); animation: ridgeDrift 16s ease-in-out infinite; }
        @keyframes ridgeDrift {
          0%,100% { transform: translateX(0); opacity: 0.55; }
          50%     { transform: translateX(-16px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ridge-shimmer, .ridge-drift { animation: none; }
        }
      `}</style>

      <div className="max-w-[1000px] mx-auto">
        <h1 className="text-[28px] font-semibold tracking-[-0.4px]">Ridge — variantes animadas</h1>
        <p className="text-[14px] text-[#262626]/60 mt-1 mb-8">
          Cada bloco é uma simulação do hero (igual “LLM Providers”). O efeito fica no canto direito. Me diz o número que você curtir.
        </p>

        <div className="space-y-5">
          {VARIANTS.map((v) => (
            <div key={v.n} className="rounded-xl border border-[#EDEDED] bg-white overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="relative h-[152px] overflow-hidden border-b border-[#EDEDED]">
                <v.C />
                <div className="relative px-6 py-9">
                  <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#003083] text-white text-[12px] font-semibold mb-2">{v.n}</div>
                  <h2 className="text-[26px] font-semibold tracking-[-0.4px] leading-8">LLM Providers</h2>
                  <p className="text-[13px] text-[#262626]/55 mt-1">Conecte as LLMs do seu agente e defina a ordem de uso.</p>
                </div>
              </div>
              <div className="px-5 py-3 flex items-center gap-2">
                <span className="text-[13px] font-semibold">{v.name}</span>
                <span className="text-[13px] text-[#262626]/55">— {v.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[13px] text-[#262626]/45 mt-8">
          Todas respeitam <code className="font-mono">prefers-reduced-motion</code> (param desligado = estático). Página temporária — removo depois de escolhermos.
        </p>
      </div>
    </div>
  );
}

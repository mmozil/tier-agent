import { useEffect, useRef, useState } from "react";

// Laboratório de variantes ANIMADAS pro ridge decorativo do hero (PageHeroRidge).
// Rota pública /ridge-lab — só pra escolher. AQUI o efeito está EXAGERADO (mais forte
// e rápido) pra dar pra ver o movimento; no hero real fica bem mais sutil.
// Animação FORÇADA (ignora prefers-reduced-motion) só nesta página de teste.

const RIDGE = [
  "",
  " ..::..           ....",
  ":--==--::.......::----::.                 .::::::...  ..::",
  "=++*+++==-------==++++==-:              .:-=====---:::--==",
  "*xxxxxx**+++=+++**xxxx**+-:.          .:-=+*****+++===+++*",
  "X######XXxx***xxXXX###Xxx+=-:.      .:-=+*xXXXXXxxx****xxX",
  "###########XXX##########Xx*+=::....::=+*xX#########XXXX###",
];
const RIDGE_TXT = RIDGE.join("\n");

const wrap = "pointer-events-none select-none absolute right-0 top-0 bottom-0 flex items-end justify-end pr-6 overflow-hidden";
const wrapStyle = {
  width: 520,
  WebkitMaskImage: "linear-gradient(to left, #000 45%, transparent 100%)",
  maskImage: "linear-gradient(to left, #000 45%, transparent 100%)",
} as const;
// texto maior (11px) e mais visível que o hero real, só pra demo
const preBase = "font-mono text-[11px] leading-[11px] whitespace-pre mb-6";

/* 0 — Atual (estático), pra comparar */
function StaticRidge() {
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <pre className={`${preBase} text-[#262626]/[0.14]`}>{RIDGE_TXT}</pre>
    </div>
  );
}

/* 1 — Shimmer: uma luz azul varre o ridge (forte e rápido na demo) */
function ShimmerRidge() {
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <div className="relative mb-6">
        <pre className={`${preBase} mb-0 text-[#262626]/[0.16]`}>{RIDGE_TXT}</pre>
        <pre className={`${preBase} mb-0 absolute inset-0 ridge-shimmer`}>{RIDGE_TXT}</pre>
      </div>
    </div>
  );
}

/* 2 — Drift: o ridge desliza e "respira" (bem visível na demo) */
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
    const idxs = chars.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    const id = setInterval(() => {
      const s = new Set<number>();
      for (let k = 0; k < 22; k++) s.add(idxs[Math.floor(Math.random() * idxs.length)]);
      setLit(s);
    }, 240);
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
            <span key={i} style={{ color: lit.has(i) ? "rgba(0,48,131,0.75)" : "rgba(38,38,38,0.12)", transition: "color 0.45s ease" }}>
              {c}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

function useCanvas(drawFactory: (cx: CanvasRenderingContext2D, W: number, H: number) => (t: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cx = ctx;
    const W = 520, H = 150, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cx.scale(dpr, dpr);
    const frame = drawFactory(cx, W, H);
    let t = 0, raf = 0;
    const loop = () => {
      frame(t);
      t += 1;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

/* 4 — Wave (canvas): campo topográfico de pontos que ondula (estilo Firecrawl real) */
function WaveCanvasRidge() {
  const ref = useCanvas((cx, W, H) => (t) => {
    const tt = t * 0.045;
    cx.clearRect(0, 0, W, H);
    const gap = 6;
    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        const v = Math.sin(x * 0.03 + tt) * Math.cos(y * 0.05 - tt * 0.8) + Math.sin((x + y) * 0.02 + tt * 1.4);
        const n = (v + 2) / 4;
        const a = Math.max(0, n - 0.45) * 0.85 * (y / H + 0.25);
        if (a > 0.02) {
          cx.fillStyle = `rgba(0,48,131,${a})`;
          cx.fillRect(x, y, 2.4, 2.4);
        }
      }
    }
  });
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <canvas ref={ref} style={{ width: 520, height: 150 }} className="mb-1" />
    </div>
  );
}

/* 5 — Flow (canvas): a densidade escorre pra baixo, tipo chuva fininha */
function FlowCanvasRidge() {
  const ref = useCanvas((cx, W, H) => (t) => {
    const tt = t * 0.06;
    cx.clearRect(0, 0, W, H);
    const gap = 6;
    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        const phase = Math.sin(x * 0.045 + tt * 1.6 + y * 0.09);
        const n = (phase + 1) / 2;
        const a = Math.max(0, n - 0.4) * 0.8 * (y / H + 0.2);
        if (a > 0.02) {
          cx.fillStyle = `rgba(0,48,131,${a})`;
          cx.fillRect(x, y, 2, 3);
        }
      }
    }
  });
  return (
    <div aria-hidden className={wrap} style={wrapStyle}>
      <canvas ref={ref} style={{ width: 520, height: 150 }} className="mb-1" />
    </div>
  );
}

/* 6 — Vanta BIRDS (nossas cores): bando de pássaros (boids) Three.js via CDN */
let vantaPromise: Promise<void> | null = null;
function loadVanta(): Promise<void> {
  if ((window as any).VANTA?.BIRDS) return Promise.resolve();
  if (vantaPromise) return vantaPromise;
  const inject = (src: string) =>
    new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error("load " + src));
      document.head.appendChild(s);
    });
  vantaPromise = inject("https://cdn.jsdelivr.net/npm/three@0.134.0/build/three.min.js")
    .then(() => inject("https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.birds.min.js"))
    .then(() => undefined);
  return vantaPromise;
}

function VantaBirdsRidge() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let effect: any;
    let cancelled = false;
    loadVanta()
      .then(() => {
        if (cancelled || !ref.current || !(window as any).VANTA?.BIRDS) return;
        effect = (window as any).VANTA.BIRDS({
          el: ref.current,
          THREE: (window as any).THREE,
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          backgroundAlpha: 0,
          color1: 0x003083, // azul Tier
          color2: 0x1f42e4, // azul mais claro da marca
          birdSize: 1.0,
          wingSpan: 22,
          speedLimit: 4,
          separation: 40,
          alignment: 24,
          cohesion: 24,
          quantity: 3,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      try {
        effect?.destroy();
      } catch {
        /* noop */
      }
    };
  }, []);
  return <div ref={ref} aria-hidden className={wrap} style={{ ...wrapStyle, width: 640 }} />;
}

const VARIANTS: { n: number; name: string; desc: string; C: () => JSX.Element }[] = [
  { n: 6, name: "Vanta BIRDS ★ (nossas cores)", desc: "Bando de pássaros (boids) Three.js, em azul Tier — o que você pediu.", C: VantaBirdsRidge },
  { n: 0, name: "Atual (estático)", desc: "O que está hoje — sem movimento.", C: StaticRidge },
  { n: 1, name: "Shimmer", desc: "Uma luz azul varre o ridge (CSS, leve e elegante).", C: ShimmerRidge },
  { n: 2, name: "Drift / respira", desc: "O ridge desliza e pulsa a opacidade (CSS).", C: DriftRidge },
  { n: 3, name: "Twinkle / brasas", desc: "Caracteres acendem e apagam aleatoriamente — textura viva.", C: TwinkleRidge },
  { n: 4, name: "Wave (canvas) ★", desc: "Campo topográfico de pontos que ondula — o mais perto do Firecrawl real.", C: WaveCanvasRidge },
  { n: 5, name: "Flow (canvas)", desc: "A densidade escorre pra baixo, tipo chuva fininha de pontos.", C: FlowCanvasRidge },
];

export default function RidgeLab() {
  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#262626] py-10 px-6">
      <style>{`
        .ridge-shimmer {
          background: linear-gradient(110deg, transparent 40%, rgba(0,48,131,0.7) 50%, transparent 60%);
          background-size: 260% 100%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: ridgeShimmer 3s linear infinite;
        }
        @keyframes ridgeShimmer { from { background-position: 200% 0; } to { background-position: -120% 0; } }
        .ridge-drift { color: rgba(0,48,131,0.16); animation: ridgeDrift 7s ease-in-out infinite; }
        @keyframes ridgeDrift {
          0%,100% { transform: translateX(0); opacity: 0.5; }
          50%     { transform: translateX(-34px); opacity: 1; }
        }
      `}</style>

      <div className="max-w-[1000px] mx-auto">
        <h1 className="text-[28px] font-semibold tracking-[-0.4px]">Ridge — variantes animadas</h1>
        <p className="text-[14px] text-[#262626]/60 mt-1">
          Cada bloco simula o hero (igual “LLM Providers”). O efeito fica no canto direito. Me diz o número que você curtir.
        </p>
        <p className="text-[13px] text-[#9a6700] bg-[#F5A300]/[0.10] border border-[#F5A300]/30 rounded-lg px-3 py-2 mt-3 mb-8 inline-block">
          ⚠️ Aqui o efeito está <b>exagerado</b> (mais forte e rápido) e a animação é <b>forçada</b> só pra você VER o movimento. No hero real eu deixo bem mais sutil.
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

        <p className="text-[13px] text-[#262626]/45 mt-8">Página temporária — removo depois de escolhermos.</p>
      </div>
    </div>
  );
}

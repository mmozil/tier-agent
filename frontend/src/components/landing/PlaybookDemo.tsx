import { useEffect, useRef, useState } from "react";
import {
  Zap,
  Bot,
  GitBranch,
  Workflow,
  Search,
  ChevronDown,
  Check,
  CircleSlash,
  CircleDot,
  Loader2,
} from "lucide-react";
import {
  AgentsMenuIcon,
  ConversationsMenuIcon,
  LeadsMenuIcon,
  MetricsMenuIcon,
  OverviewMenuIcon,
  PlaybooksMenuIcon,
} from "../icons/menuIcons";

/* ─────────────────────────────────────────────────────────────
   Tier Agent — Tela do builder "Workflows" (estilo Attio).
   App completo: sidebar + canvas com cards espaçados (header/body),
   ramificação de condições + painel de Execuções ao vivo + Overview.
   Fluxo roda em loop. 100% CSS/SVG. Pausa fora da viewport.
   ──────────────────────────────────────────────────────────── */

type NodeDef = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  tag: string;
  desc: string;
  color: string;
  trigger?: boolean;
  doneLabel?: string;
};

const NODES: NodeDef[] = [
  { icon: Zap, title: "Carrinho abandonado", tag: "Gatilho", desc: "Dispara em uma conversa de venda", color: "#8B5CF6", trigger: true, doneLabel: "Disparado" },
  { icon: Bot, title: "Pesquisa o cliente", tag: "Agente", desc: "Levanta histórico e perfil de compra", color: "#003083" },
  { icon: GitBranch, title: "Decide a abordagem", tag: "Condições", desc: "Roteia conforme a intenção do cliente", color: "#F5A300" },
];

const CONDITIONS = ["Comprar", "Negociar", "Suporte"];

const NAV = [
  { icon: OverviewMenuIcon, label: "Início" },
  { icon: ConversationsMenuIcon, label: "Conversas" },
  { icon: LeadsMenuIcon, label: "Leads" },
  { icon: PlaybooksMenuIcon, label: "Playbooks", active: true },
  { icon: AgentsMenuIcon, label: "Agentes" },
  { icon: MetricsMenuIcon, label: "Métricas" },
];

const RUNS = [
  { n: 70, state: "run", label: "rodando", steps: 3 },
  { n: 69, state: "ok", label: "agora", steps: 15 },
  { n: 68, state: "ok", label: "2 min", steps: 11 },
  { n: 67, state: "ok", label: "3 min", steps: 11 },
  { n: 66, state: "ok", label: "5 min", steps: 16 },
  { n: 65, state: "ok", label: "6 min", steps: 14 },
] as const;

type NodeState = "idle" | "running" | "completed";

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[19px] h-[19px] px-1 rounded-full bg-surface-muted border border-hairline text-[9.5px] font-semibold text-[#9AA4B2] tabular-nums">
      {n}
    </span>
  );
}

function StatePill({ state, label }: { state: "running" | "completed"; label: string }) {
  return (
    <div
      className={`absolute -top-[13px] right-3 z-20 inline-flex items-center gap-1 h-[20px] pl-1.5 pr-2.5 rounded-full text-[10.5px] font-semibold ring-[3px] ring-white animate-fadein ${
        state === "running" ? "bg-flow-runbg text-flow-runfg" : "bg-flow-okbg text-flow-okfg"
      }`}
    >
      {state === "running" ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" strokeWidth={3} />}
      {label}
    </div>
  );
}

function WNode({ def, state }: { def: NodeDef; state: NodeState }) {
  // bordas finas e elegantes (sem halo pesado) — igual Attio
  const borderCls =
    state === "running"
      ? "border-[1.5px] border-warning/55 shadow-[0_4px_14px_-8px_rgba(245,163,0,.4)]"
      : state === "completed"
        ? "border-[1.5px] border-success/45 shadow-[0_4px_14px_-8px_rgba(0,209,126,.32)]"
        : "border border-line shadow-[0_1px_2px_rgba(13,15,17,.04)]";
  return (
    <div className="relative w-[316px]">
      {def.trigger && (
        <div className="absolute -top-[28px] left-0 inline-flex items-center gap-1.5 h-[21px] px-2 rounded-full bg-white/80 border border-hairline text-[10px] font-medium text-[#9AA4B2]">
          <CircleDot className="w-3 h-3" /> Trigger
        </div>
      )}
      {state !== "idle" && (
        <StatePill state={state === "running" ? "running" : "completed"} label={state === "running" ? "Executando" : def.doneLabel || "Concluído"} />
      )}
      <div className={`relative rounded-[14px] bg-white border ${borderCls} overflow-hidden transition-colors duration-300`}>
        {/* header */}
        <div className="h-[42px] px-4 flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-[4px] flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${def.color}12` }}
          >
            <def.icon className="w-3.5 h-3.5" style={{ color: def.color }} />
          </div>
          <span className="flex-1 text-[14.5px] font-semibold text-ink truncate">{def.title}</span>
          <span className="shrink-0 h-[21px] px-2 inline-flex items-center rounded-md bg-surface-muted text-[10.5px] font-medium text-[#8A93A1]">
            {def.tag}
          </span>
        </div>
        {/* body */}
        <div className="px-4 py-2.5 border-t border-hairline text-[12.5px] text-[#7A828E] leading-relaxed">{def.desc}</div>
      </div>
    </div>
  );
}

// Conector: porta (○) na borda do card de cima + seta (▼) no card de baixo
function Edge({ state, height = 56 }: { state: "idle" | "active" | "flowing"; height?: number }) {
  const color = state === "idle" ? "#D6DAE0" : "#00D17E";
  return (
    <svg width="16" height={height} viewBox={`0 0 16 ${height}`} className="block shrink-0 -mt-[6px] relative z-10" aria-hidden>
      <line x1="8" y1="8" x2="8" y2={height - 8} stroke={color} strokeWidth={state === "idle" ? 1.5 : 2} />
      {state === "flowing" && (
        <line x1="8" y1="8" x2="8" y2={height - 8} stroke="#0AA968" strokeWidth="2.5" strokeDasharray="5 8" className="animate-dashflow" />
      )}
      <circle cx="8" cy="5" r="3.5" fill="#FFFFFF" stroke={color} strokeWidth="1.5" />
      <path d={`M8 ${height} L3 ${height - 8} L13 ${height - 8} Z`} fill={color} />
    </svg>
  );
}

// Ramificação das condições (fan-out abaixo do Switch)
function BranchFork({ active }: { active: boolean }) {
  const color = active ? "#00D17E" : "#D6DAE0";
  const W = 408;
  const cx = W / 2;
  const cols = [68, cx, W - 68];
  return (
    <div className="relative -mt-[6px]" style={{ width: W }}>
      <svg width={W} height="48" viewBox={`0 0 ${W} 48`} className="block relative z-10" aria-hidden>
        <circle cx={cx} cy="5" r="3.5" fill="#FFFFFF" stroke={color} strokeWidth="1.5" />
        <line x1={cx} y1="8" x2={cx} y2="22" stroke={color} strokeWidth="2" />
        <path d={`M${cols[0]} 22 H${cols[2]}`} stroke={color} strokeWidth="2" fill="none" />
        {cols.map((x) => (
          <g key={x}>
            <line x1={x} y1="22" x2={x} y2={x === cx ? 44 : 44} stroke={color} strokeWidth="2" />
            <path d={`M${x} 46 L${x - 4} 39 L${x + 4} 39 Z`} fill={color} />
          </g>
        ))}
      </svg>
      <div className="flex justify-between">
        {CONDITIONS.map((c) => (
          <div
            key={c}
            className={`w-[124px] text-center text-[11px] font-medium py-1.5 rounded-lg bg-white border ${
              active ? "border-success/40 text-ink" : "border-line text-[#9AA4B2]"
            }`}
          >
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunRow({ n, state, label, steps }: { n: number; state: "run" | "ok"; label: string; steps: number }) {
  return (
    <div className="flex items-center gap-2.5 px-4 h-[46px] border-b border-hairline hover:bg-surface-subtle transition-colors">
      {state === "run" ? (
        <Loader2 className="w-4 h-4 text-node-trigger animate-spin shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-success flex items-center justify-center shrink-0">
          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </span>
      )}
      <span className="text-[13px] font-medium text-ink whitespace-nowrap">Execução #{n}</span>
      <StepBadge n={steps} />
      <span className="ml-auto text-[11.5px] text-[#9AA4B2] whitespace-nowrap">{label}</span>
    </div>
  );
}

function StatCard({ value, label, tone }: { value: string; label: string; tone?: "ok" | "fail" }) {
  const wrap =
    tone === "ok"
      ? "bg-flow-okbg/60 border-success/25"
      : tone === "fail"
        ? "bg-flow-errbg/40 border-danger/20"
        : "bg-surface-muted border-line";
  return (
    <div className={`relative rounded-xl border p-3.5 ${wrap}`}>
      <div className="font-display text-[24px] font-semibold text-ink leading-none">{value}</div>
      <div className="text-[11.5px] text-[#6A7385] mt-1.5">{label}</div>
      {tone === "ok" && <Check className="absolute top-3 right-3 w-3.5 h-3.5 text-success" strokeWidth={2.5} />}
      {tone === "fail" && <CircleSlash className="absolute top-3 right-3 w-3.5 h-3.5 text-danger/70" />}
    </div>
  );
}

export default function PlaybookDemo() {
  const [step, setStep] = useState(0); // 0..NODES.length (último = tudo concluído)
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (visible.current) setStep((s) => (s + 1) % (NODES.length + 1));
    }, 1350);
    return () => clearInterval(id);
  }, []);

  const allDone = step >= NODES.length;
  const nodeState = (i: number): NodeState => (allDone ? "completed" : i < step ? "completed" : i === step ? "running" : "idle");
  const edgeState = (i: number): "idle" | "active" | "flowing" =>
    allDone ? "active" : step === i + 1 ? "flowing" : step > i ? "active" : "idle";
  const branchActive = allDone || step > NODES.length - 1;

  return (
    <div ref={ref} className="mx-auto max-w-[1040px]">
      <div className="rounded-2xl border border-line bg-white shadow-md overflow-hidden">
        {/* topbar */}
        <div className="h-12 border-b border-line bg-white flex items-center px-4 gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#E4E7EC]" />
          </div>
          <div className="flex items-center gap-1.5 text-[13px]">
            <Workflow className="w-4 h-4 text-[#6A7385]" />
            <span className="font-medium text-ink">Playbooks</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-medium text-success">Ao vivo</span>
            <span className="w-8 h-[18px] rounded-full bg-success/90 relative">
              <span className="absolute right-0.5 top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm" />
            </span>
          </div>
        </div>

        <div className="flex">
          {/* sidebar */}
          <aside className="hidden md:flex flex-col w-[196px] shrink-0 bg-surface-subtle border-r border-hairline py-3">
            <div className="px-3">
              <button className="w-full flex items-center gap-2 h-8 px-2 rounded-lg bg-white border border-line shadow-sm">
                <span className="w-5 h-5 rounded-md bg-cta flex items-center justify-center">
                  <span className="w-2 h-2 rounded-[2px] bg-white" />
                </span>
                <span className="text-[13px] font-semibold text-ink">Tier Agent</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#9AA4B2] ml-auto" />
              </button>
              <div className="mt-2.5 flex items-center gap-2 h-9 px-2.5 rounded-lg bg-surface-muted border border-hairline">
                <Search className="w-3.5 h-3.5 text-[#9AA4B2]" />
                <span className="text-[12px] text-[#9AA4B2]">Ações rápidas</span>
                <span className="ml-auto text-[10px] text-[#9AA4B2] bg-white border border-hairline rounded px-1 py-0.5">⌘K</span>
              </div>
            </div>
            <nav className="mt-3 px-2.5 flex flex-col gap-1">
              {NAV.map((it) => (
                <div
                  key={it.label}
                  className={`flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] ${
                    it.active ? "bg-white shadow-sm text-ink font-medium" : "text-[#6A7385]"
                  }`}
                >
                  <it.icon className={`w-4 h-4 ${it.active ? "text-accent" : "text-[#9AA4B2]"}`} />
                  {it.label}
                </div>
              ))}
            </nav>
            <div className="mt-4 px-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#B4BBC6] mb-2">Favoritos</div>
              <div className="flex flex-col gap-2">
                {["Recuperação de carrinho", "Qualificação SDR", "Triagem com RAG"].map((f, i) => (
                  <div key={f} className={`flex items-center gap-2 text-[12px] ${i === 0 ? "text-accent font-medium" : "text-[#9AA4B2]"}`}>
                    <Workflow className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* canvas */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="h-11 border-b border-hairline flex items-center gap-5 px-5 bg-white">
              <span className="text-[13px] font-medium text-[#9AA4B2]">Editor</span>
              <span className="text-[13px] font-semibold text-ink border-b-2 border-accent h-11 inline-flex items-center">
                Execuções <span className="ml-1.5 text-[10px] text-[#6A7385] bg-surface-muted rounded-full px-1.5 py-0.5">70</span>
              </span>
            </div>

            <div className="relative bg-surface-sunken bg-dots px-7 pt-7 pb-10 min-h-[440px] flex flex-col items-center">
              <span className="self-start mb-8 inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full bg-flow-okbg text-flow-okfg text-[10.5px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-flow-okfg" /> Execução #70
              </span>
              {NODES.map((def, i) => (
                <div key={def.title} className="flex flex-col items-center">
                  <WNode def={def} state={nodeState(i)} />
                  {i < NODES.length - 1 && <Edge state={edgeState(i)} />}
                </div>
              ))}
              {/* ramificação das condições */}
              <div className="mt-1.5">
                <BranchFork active={branchActive} />
              </div>
            </div>
          </div>

          {/* painel de execuções */}
          <aside className="hidden lg:flex flex-col w-[272px] shrink-0 border-l border-hairline">
            <div className="flex-1 overflow-hidden">
              {RUNS.map((r) => (
                <RunRow key={r.n} n={r.n} state={r.state} label={r.label} steps={r.steps} />
              ))}
            </div>
            <div className="border-t border-line p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9AA4B2] mb-2.5">Overview</div>
              <div className="grid grid-cols-2 gap-2.5">
                <StatCard value="70" label="Concluídas" tone="ok" />
                <StatCard value="0" label="Falhas" tone="fail" />
                <StatCard value="1" label="Em andamento" />
                <StatCard value="18s" label="Tempo médio" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

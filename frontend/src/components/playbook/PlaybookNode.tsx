import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Inbox } from "lucide-react";

import { FC } from "@/components/ds/fc";
import { getNodeMeta, type PlaybookNodeKind } from "@/lib/playbookSchema";

/**
 * Card de nó do canvas — design system Firecrawl × Tier (`ds/fc`).
 *
 * O desenho segue o nó da landing (`landing/PlaybookDemo.tsx`): raio 14px,
 * header de 42px separado do corpo por uma hairline, tile de ícone 24px.
 * Cores, texto e superfícies vêm dos tokens `FC` — nunca hex solto — para o
 * nó acompanhar o tema claro/escuro junto com o resto do admin.
 *
 * Handles:
 * - target (entrada) à esquerda — sempre, exceto triggers (não recebem entrada)
 * - source (saída) à direita — todos, exceto handoff_human (sink final)
 * - branch tem 2 saídas: "sim" (verde, topo) e "não" (coral, embaixo)
 */

// Superfície interna dos previews (código, mensagem, expressão). Substitui o
// bg-slate-50, que é token do Tier Empresas e não tinha variante escura.
const INSET = "bg-black/[0.035] dark:bg-white/[0.05] rounded-[6px] px-2 py-1";

/**
 * Um nó está incompleto quando falta a configuração que o torna executável.
 * Publicar um fluxo com nó incompleto é o erro mais caro do editor, então ele
 * ganha aro âmbar + selo — em vez de parecer pronto e falhar em runtime.
 */
function isIncomplete(kind: PlaybookNodeKind, data: Record<string, unknown>): boolean {
  const empty = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
  switch (kind) {
    case "trigger_keyword":
      return !((data.patterns as string[]) || []).length;
    case "trigger_intent":
      return !((data.intents as string[]) || []).length;
    case "trigger_event":
      return empty(data.event_key);
    case "send_text":
      return empty(data.text);
    case "branch":
      return empty(data.condition);
    case "set_var":
      return empty(data.key);
    case "llm_step":
      return empty(data.system_prompt);
    case "knowledge_lookup":
      return empty(data.query);
    case "call_api":
      return empty(data.url);
    case "route_to_specialist":
      return !((data.specialists as unknown[]) || []).length;
    default:
      return false;
  }
}

export default function PlaybookNode(props: NodeProps) {
  const kind = props.type as PlaybookNodeKind;
  const meta = getNodeMeta(kind);
  if (!meta) {
    return (
      <div className="rounded-[14px] border border-[#E5484D]/40 bg-[#E5484D]/[0.06] px-3 py-2.5 text-[12px] text-[#c0362c] dark:text-[#ff6b5e]">
        Tipo desconhecido: {kind}
      </div>
    );
  }

  const Icon = meta.icon;
  const isTrigger = meta.isTrigger;
  const data = (props.data as Record<string, unknown>) || {};
  const selected = props.selected;
  const status = (data.status as string) || ""; // triggered | completed | running | error
  const done = status === "completed" || status === "triggered";
  const incomplete = !status && isIncomplete(kind, data);

  // Estado de repouso vive em classe (para acompanhar o tema); só os estados
  // COLORIDOS usam boxShadow inline, porque leem bem nos dois temas.
  const restCls = incomplete
    ? "border-[#F5A300]/55 dark:border-[#fbbf24]/45"
    : `${FC.hair}`;
  const ring = selected
    ? `0 0 0 2px ${meta.color}, 0 8px 24px -6px rgba(13,15,17,.16)`
    : done
      ? "0 0 0 1.5px #00D17E, 0 0 0 4px rgba(0,209,126,.14)"
      : status === "error"
        ? "0 0 0 1.5px #E5484D, 0 0 0 4px rgba(229,72,77,.12)"
        : undefined;

  return (
    <div
      // sem overflow-hidden: o selo de status e o de trigger vivem FORA da caixa
      // (top negativo) e seriam cortados pela metade.
      className={`relative w-[240px] rounded-[14px] border bg-white dark:bg-[#14171c] transition-all duration-150 ${
        ring ? "" : "shadow-[0_1px_2px_rgba(13,15,17,.06)] dark:shadow-none hover:shadow-[0_4px_14px_-6px_rgba(13,15,17,.16)]"
      } ${ring ? "border-transparent" : restCls}`}
      style={ring ? { boxShadow: ring } : undefined}
    >
      {/* Faixa de categoria (esquerda) — arredonda sozinha, já que o pai não corta */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[13px]"
        style={{ backgroundColor: meta.color }}
      />

      {/* Selo de trigger, acima do card */}
      {isTrigger && (
        <div className={`absolute -top-[18px] left-0 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${FC.mut}`}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
          Trigger
        </div>
      )}

      {/* Header */}
      <div className="h-[42px] pl-3.5 pr-3 flex items-center gap-2.5">
        <div
          className="w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}14`, boxShadow: `inset 0 0 0 1px ${meta.color}26` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <span className={`flex-1 min-w-0 truncate text-[13px] font-semibold leading-tight ${FC.ink}`}>
          {meta.label}
        </span>
        {incomplete && (
          <span
            title="Falta configurar este nó"
            className="shrink-0 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-md bg-[#F5A300]/[0.14] text-[10px] font-medium text-[#8a5b00] dark:text-[#fbbf24]"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
          </span>
        )}
        {!incomplete && (data.objectTag as string) && (
          <span className={`shrink-0 h-[18px] px-1.5 inline-flex items-center rounded-md bg-black/[0.04] dark:bg-white/[0.06] text-[10px] font-medium ${FC.mut}`}>
            {data.objectTag as string}
          </span>
        )}
      </div>

      {/* Corpo — preview da config, separado por hairline (padrão da landing) */}
      <div className={`border-t ${FC.hair} px-3.5 py-2.5 text-[11px] leading-relaxed ${FC.sub}`}>
        <NodePreview kind={kind} data={data} color={meta.color} />
      </div>

      {/* Pill de status da execução (canto sup-dir) */}
      {status && (
        <div
          className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full text-[10px] font-semibold ring-[3px] ring-white dark:ring-[#0c0e12] ${
            status === "error"
              ? "bg-flow-errbg text-flow-errfg"
              : status === "running"
                ? "bg-flow-runbg text-flow-runfg"
                : "bg-flow-okbg text-flow-okfg"
          }`}
        >
          {status === "running" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-flow-runfg animate-pulsedot" />
          ) : status === "error" ? (
            "✕"
          ) : (
            "✓"
          )}
          <span className="capitalize">
            {status === "triggered"
              ? "Triggered"
              : status === "completed"
                ? "Completed"
                : status === "running"
                  ? "Running"
                  : "Error"}
          </span>
        </div>
      )}

      {/* Entrada (esquerda) — só para não-triggers */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#fff", border: `2px solid ${meta.color}`, width: 11, height: 11, left: -6 }}
        />
      )}

      {/* Saídas (direita) */}
      {kind === "route_to_specialist" ? (
        (() => {
          const specs = ((data.specialists as any[]) || []).filter((s) => s && typeof s.name === "string" && s.name);
          if (!specs.length) {
            return (
              <Handle
                id="default"
                type="source"
                position={Position.Right}
                style={{ background: "#fff", border: `2px solid ${meta.color}`, width: 12, height: 12, right: -6 }}
              />
            );
          }
          return (
            <>
              {specs.map((s, i) => (
                <SpecHandle key={s.name} name={s.name} pct={((i + 0.5) / specs.length) * 100} color={meta.color} />
              ))}
            </>
          );
        })()
      ) : meta.hasMultipleOutputs ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{
              background: "#10b981",
              border: "2px solid #fff",
              width: 12,
              height: 12,
              right: -6,
              top: "35%",
              boxShadow: "0 0 0 1px #10b98140",
            }}
          />
          {/* Rótulos das saídas ficam FORA do card (à direita do handle). Dentro,
              eles caíam por cima do preview da condição. */}
          <span
            className="absolute left-full ml-2.5 -translate-y-1/2 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 pointer-events-none uppercase tracking-wide"
            style={{ top: "35%" }}
          >
            sim
          </span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{
              background: "#ef4444",
              border: "2px solid #fff",
              width: 12,
              height: 12,
              right: -6,
              top: "70%",
              boxShadow: "0 0 0 1px #ef444440",
            }}
          />
          <span
            className="absolute left-full ml-2.5 -translate-y-1/2 text-[9px] font-semibold text-red-500 dark:text-red-400 pointer-events-none uppercase tracking-wide"
            style={{ top: "70%" }}
          >
            não
          </span>
        </>
      ) : kind === "handoff_human" ? null : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: "#fff", border: `2px solid ${meta.color}`, width: 12, height: 12, right: -6 }}
        />
      )}
    </div>
  );
}

function SpecHandle({ name, pct, color }: { name: string; pct: number; color: string }) {
  return (
    <>
      <Handle
        id={name}
        type="source"
        position={Position.Right}
        style={{
          background: color,
          border: "2px solid #fff",
          width: 12,
          height: 12,
          right: -6,
          top: `${pct}%`,
          boxShadow: `0 0 0 1px ${color}40`,
        }}
      />
      <span
        className="absolute left-full ml-2.5 -translate-y-1/2 text-[9px] font-semibold pointer-events-none uppercase tracking-wide whitespace-nowrap"
        style={{ top: `${pct}%`, color }}
      >
        {name}
      </span>
    </>
  );
}

function NodePreview({
  kind,
  data,
  color,
}: {
  kind: PlaybookNodeKind;
  data: Record<string, unknown>;
  color: string;
}) {
  switch (kind) {
    case "trigger_keyword": {
      const patterns = (data.patterns as string[]) || [];
      return (
        <div className="flex flex-wrap gap-1">
          {patterns.slice(0, 3).map((p, i) => (
            <span
              key={i}
              className="inline-block px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono"
              style={{ backgroundColor: `${color}14`, color }}
            >
              {p}
            </span>
          ))}
          {patterns.length > 3 && <span className={`text-[10px] font-medium ${FC.mut}`}>+{patterns.length - 3}</span>}
          {patterns.length === 0 && <span className="italic text-[10px]">sem palavras-chave</span>}
        </div>
      );
    }
    case "send_text": {
      const text = (data.text as string) || "";
      return <div className={`${INSET} line-clamp-2 italic text-[11px]`}>"{text || "Mensagem vazia"}"</div>;
    }
    case "branch": {
      const cond = (data.condition as string) || "";
      return <div className={`${INSET} font-mono text-[10px] line-clamp-2`}>{cond || "sem condição"}</div>;
    }
    case "wait": {
      const s = (data.duration_seconds as number) || 0;
      const human = s >= 3600 ? `${Math.round(s / 3600)}h` : s >= 60 ? `${Math.round(s / 60)}min` : `${s}s`;
      return (
        <div className="flex items-center gap-1.5">
          <span className={`font-medium text-[12px] ${FC.ink}`}>{human}</span>
          <span className="text-[10px]">de pausa</span>
        </div>
      );
    }
    case "set_var": {
      const key = (data.key as string) || "?";
      const value = String(data.value ?? "");
      return (
        <div className={`${INSET} font-mono text-[10px] line-clamp-1`}>
          <span style={{ color }}>{key}</span> = "{value}"
        </div>
      );
    }
    case "trigger_manual":
      return <div>Disparo manual via botão no painel</div>;
    case "trigger_cron":
      return <div className={`${INSET} font-mono text-[10px]`}>{(data.cron_expr as string) || "* * * * *"}</div>;
    case "trigger_event":
      return (
        <div className={`${INSET} font-mono text-[10px] truncate flex items-center gap-1.5`}>
          <Inbox className="w-3 h-3 shrink-0" />
          {(data.event_key as string) || "?"}
        </div>
      );
    case "trigger_intent": {
      const intents = (data.intents as string[]) || [];
      return (
        <div className="text-[11px]">
          Intenções: <span className={FC.ink}>{intents.join(", ") || "—"}</span>
        </div>
      );
    }
    case "llm_step": {
      const prompt = (data.system_prompt as string) || "";
      const saveAs = (data.save_as as string) || "";
      return (
        <div className="space-y-1">
          <div className={`${INSET} line-clamp-2 italic text-[11px]`}>{prompt || "sem prompt"}</div>
          {saveAs && <div className={`text-[10px] font-mono ${FC.mut}`}>→ vars.{saveAs}</div>}
        </div>
      );
    }
    case "knowledge_lookup":
      return <div className={`${INSET} text-[11px] line-clamp-2 italic`}>Buscar: {(data.query as string) || "—"}</div>;
    case "call_api":
      return (
        <div className={`${INSET} font-mono text-[10px] line-clamp-1`}>
          <span className="font-semibold" style={{ color }}>
            {(data.method as string) || "POST"}
          </span>{" "}
          {(data.url as string) || "—"}
        </div>
      );
    case "tier_pay": {
      const cents = (data.valor_cents as number) || 0;
      const metodo = (data.metodo as string) || "pix";
      return (
        <div className="flex items-center justify-between">
          <span className={`font-semibold text-[12px] tabular-nums ${FC.ink}`}>
            R$ {(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </span>
          <span className={`text-[10px] uppercase tracking-wide ${FC.mut}`}>{metodo}</span>
        </div>
      );
    }
    case "handoff_human":
      return (
        <div className="text-[11px]">
          Fila: <span className={`font-medium ${FC.ink}`}>{(data.queue as string) || "padrão"}</span>
        </div>
      );
    case "route_to_specialist": {
      const specs = (data.specialists as any[]) || [];
      return (
        <div className="text-[11px]">
          <div className="mb-1">{specs.length} especialista(s):</div>
          <div className="flex flex-wrap gap-1">
            {specs.slice(0, 4).map((s: any, i: number) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded-[5px] text-[10px] font-medium"
                style={{ backgroundColor: `${color}14`, color }}
              >
                {s.name}
              </span>
            ))}
            {specs.length > 4 && <span className={`text-[10px] ${FC.mut}`}>+{specs.length - 4}</span>}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { getNodeMeta, type PlaybookNodeKind } from "@/lib/playbookSchema";

/**
 * Card de nó renderizado no canvas — referência visual: n8n (cards squared
 * minimalistas com header colorido) + Dify (sombra elegante, ícone destacado).
 *
 * Handles:
 * - target (input) à esquerda — sempre exceto triggers (não recebem entrada)
 * - source (output) à direita — todos exceto handoff_human (sink final)
 * - branch tem 2 sources direita: "sim" verde topo, "não" coral em baixo
 */
export default function PlaybookNode(props: NodeProps) {
  const kind = props.type as PlaybookNodeKind;
  const meta = getNodeMeta(kind);
  if (!meta) {
    return (
      <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-[12px] text-red-700 shadow-sm">
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

  // Borda/sombra Attio: hairline padrão · azul acento selecionado · verde no caminho ativo
  const ring = selected
    ? `0 0 0 2px ${meta.color}, 0 8px 24px -6px rgba(13,15,17,.14)`
    : done
      ? `0 0 0 1.5px #00D17E, 0 0 0 4px rgba(0,209,126,.14), 0 4px 12px -4px rgba(13,15,17,.08)`
      : status === "error"
        ? `0 0 0 1.5px #E5484D, 0 4px 12px -4px rgba(13,15,17,.08)`
        : `0 1px 2px rgba(13,15,17,.06), 0 0 0 1px #E4E7EC`;

  return (
    <div
      className="bg-white rounded-lg transition-all duration-150 relative hover:shadow-md"
      style={{ width: 240, boxShadow: ring }}
    >
      {/* Tab de trigger acima do nó */}
      {isTrigger && (
        <div className="absolute -top-[18px] left-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-node-trigger">
          <span className="w-1.5 h-1.5 rounded-full bg-node-trigger" />
          Trigger
        </div>
      )}

      {/* Pill de status (canto sup-dir) */}
      {status && (
        <div
          className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full text-[10px] font-semibold ${
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
          <span className="capitalize">{status === "triggered" ? "Triggered" : status === "completed" ? "Completed" : status === "running" ? "Running" : "Error"}</span>
        </div>
      )}

      {/* Input handle (esquerda) — só pra não-triggers */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#fff", border: `2px solid ${meta.color}`, width: 11, height: 11, left: -6 }}
        />
      )}

      {/* Faixa de categoria lateral (esquerda) */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg" style={{ backgroundColor: meta.color }} />

      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}12`, boxShadow: `0 0 0 1px ${meta.color}22` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate leading-tight tracking-snug">
            {meta.label}
          </div>
          <div className="text-[11px] text-[#6A7385] truncate leading-tight mt-0.5">
            {(data.subtitle as string) || meta.category}
          </div>
        </div>
        {(data.objectTag as string) && (
          <span className="shrink-0 h-[18px] px-1.5 inline-flex items-center rounded-full bg-surface-sunken text-[10px] font-medium text-[#6A7385]">
            {data.objectTag as string}
          </span>
        )}
      </div>

      {/* Body — preview da config */}
      <div className="px-3 pb-3 text-[11px] text-[#697386] leading-relaxed">
        <NodePreview kind={kind} data={data} color={meta.color} />
      </div>

      {/* Source handles (direita) */}
      {kind === "route_to_specialist" ? (
        (() => {
          const specs = ((data.specialists as any[]) || []).filter(
            (s) => s && typeof s.name === "string" && s.name,
          );
          if (!specs.length) {
            return (
              <Handle
                id="default"
                type="source"
                position={Position.Right}
                style={{
                  background: "#fff",
                  border: `2px solid ${meta.color}`,
                  width: 12,
                  height: 12,
                  right: -6,
                }}
              />
            );
          }
          return (
            <>
              {specs.map((s, i) => {
                const total = specs.length;
                const pct = ((i + 0.5) / total) * 100;
                return (
                  <SpecHandle
                    key={s.name}
                    name={s.name}
                    pct={pct}
                    color={meta.color}
                  />
                );
              })}
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
          <span
            className="absolute right-[14px] text-[9px] font-semibold text-emerald-600 pointer-events-none uppercase tracking-wide"
            style={{ top: "29%" }}
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
            className="absolute right-[14px] text-[9px] font-semibold text-red-500 pointer-events-none uppercase tracking-wide"
            style={{ top: "64%" }}
          >
            não
          </span>
        </>
      ) : kind === "handoff_human" ? null : (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            background: "#fff",
            border: `2px solid ${meta.color}`,
            width: 12,
            height: 12,
            right: -6,
          }}
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
        className="absolute right-[14px] text-[9px] font-semibold pointer-events-none uppercase tracking-wide"
        style={{ top: `calc(${pct}% - 6px)`, color }}
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
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{ backgroundColor: `${color}10`, color: color }}
            >
              {p}
            </span>
          ))}
          {patterns.length > 3 && (
            <span className="text-[10px] text-[#697386] font-medium">+{patterns.length - 3}</span>
          )}
          {patterns.length === 0 && <span className="italic text-[10px]">sem palavras-chave</span>}
        </div>
      );
    }
    case "send_text": {
      const text = (data.text as string) || "";
      return (
        <div className="bg-slate-50 rounded px-2 py-1.5 line-clamp-2 italic text-[11px]">
          "{text || "Mensagem vazia"}"
        </div>
      );
    }
    case "branch": {
      const cond = (data.condition as string) || "";
      return (
        <div className="font-mono text-[10px] line-clamp-2 bg-slate-50 rounded px-2 py-1">
          {cond || "sem condição"}
        </div>
      );
    }
    case "wait": {
      const s = (data.duration_seconds as number) || 0;
      const human = s >= 3600 ? `${Math.round(s / 3600)}h` : s >= 60 ? `${Math.round(s / 60)}min` : `${s}s`;
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[#1a2c44] font-medium text-[12px]">{human}</span>
          <span className="text-[10px]">de pausa</span>
        </div>
      );
    }
    case "set_var": {
      const key = (data.key as string) || "?";
      const value = String(data.value ?? "");
      return (
        <div className="font-mono text-[10px] line-clamp-1 bg-slate-50 rounded px-2 py-1">
          <span style={{ color }}>{key}</span> = "{value}"
        </div>
      );
    }
    case "trigger_manual":
      return <div>Disparo manual via botão no painel</div>;
    case "trigger_cron":
      return (
        <div className="font-mono text-[10px] bg-slate-50 rounded px-2 py-1">
          {(data.cron_expr as string) || "* * * * *"}
        </div>
      );
    case "trigger_event":
      return (
        <div className="font-mono text-[10px] bg-slate-50 rounded px-2 py-1 truncate">
          📥 {(data.event_key as string) || "?"}
        </div>
      );
    case "trigger_intent": {
      const intents = (data.intents as string[]) || [];
      return (
        <div className="text-[11px]">
          <span className="text-[#697386]">Intenções:</span>{" "}
          <span className="text-[#1a2c44]">{intents.join(", ") || "—"}</span>
        </div>
      );
    }
    case "llm_step": {
      const prompt = (data.system_prompt as string) || "";
      const saveAs = (data.save_as as string) || "";
      return (
        <div className="space-y-1">
          <div className="line-clamp-2 italic text-[11px] bg-slate-50 rounded px-2 py-1">
            {prompt || "sem prompt"}
          </div>
          {saveAs && (
            <div className="text-[10px] font-mono text-[#697386]">→ vars.{saveAs}</div>
          )}
        </div>
      );
    }
    case "knowledge_lookup":
      return (
        <div className="text-[11px] line-clamp-2 italic bg-slate-50 rounded px-2 py-1">
          Buscar: {(data.query as string) || "—"}
        </div>
      );
    case "call_api":
      return (
        <div className="font-mono text-[10px] line-clamp-1 bg-slate-50 rounded px-2 py-1">
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
          <span className="text-[#1a2c44] font-semibold text-[12px]">
            R$ {(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-[#697386]">{metodo}</span>
        </div>
      );
    }
    case "handoff_human":
      return (
        <div className="text-[11px]">
          <span className="text-[#697386]">Fila:</span>{" "}
          <span className="text-[#1a2c44] font-medium">{(data.queue as string) || "padrão"}</span>
        </div>
      );
    case "route_to_specialist": {
      const specs = (data.specialists as any[]) || [];
      return (
        <div className="text-[11px]">
          <div className="text-[#697386] mb-1">{specs.length} especialista(s):</div>
          <div className="flex flex-wrap gap-1">
            {specs.slice(0, 4).map((s: any, i: number) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: `${color}14`, color }}
              >
                {s.name}
              </span>
            ))}
            {specs.length > 4 && (
              <span className="text-[10px] text-[#697386]">+{specs.length - 4}</span>
            )}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

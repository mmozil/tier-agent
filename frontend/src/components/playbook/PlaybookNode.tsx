import { Handle, Position, type NodeProps } from "@xyflow/react";

import { getNodeMeta, type PlaybookNodeKind } from "@/lib/playbookSchema";

/**
 * Componente único de nó renderizado no canvas — recebe `type` via NodeProps
 * e usa o catálogo (NODE_CATALOG) pra escolher ícone/cor/label.
 *
 * Padrão visual: card branco rounded-md, header colorido (cor da categoria),
 * body com preview da config principal.
 *
 * Handles:
 * - target (input) à esquerda — sempre presente em actions/flow/integration
 * - source (output) à direita — todos exceto handoff_human (sink)
 * - branch tem 2 sources direita: "true" topo, "false" base
 */
export default function PlaybookNode(props: NodeProps) {
  const kind = props.type as PlaybookNodeKind;
  const meta = getNodeMeta(kind);
  if (!meta) {
    return (
      <div className="bg-red-50 border border-red-300 rounded-md p-3 text-[12px] text-red-700">
        Tipo desconhecido: {kind}
      </div>
    );
  }

  const Icon = meta.icon;
  const isTrigger = meta.isTrigger;
  const data = (props.data as Record<string, unknown>) || {};

  return (
    <div
      className={`bg-white rounded-md shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow ${
        props.selected ? "ring-2 ring-[#003083]/40" : ""
      }`}
      style={{ width: 200, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Input handle (esquerda) — só pra não-triggers */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            background: "#fff",
            border: `2px solid ${meta.color}`,
            width: 10,
            height: 10,
            left: -5,
          }}
        />
      )}

      {/* Header */}
      <div
        className="px-3 py-2 rounded-t-md flex items-center gap-2"
        style={{ backgroundColor: `${meta.color}14` }}
      >
        <div
          className="w-5 h-5 rounded flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}26` }}
        >
          <Icon className="w-3 h-3" style={{ color: meta.color }} />
        </div>
        <div className="text-[12px] font-semibold truncate" style={{ color: meta.color }}>
          {meta.label}
        </div>
      </div>

      {/* Body — preview da config */}
      <div className="px-3 py-2 text-[11px] text-[#697386] leading-relaxed">
        <NodePreview kind={kind} data={data} />
      </div>

      {/* Source handles (direita) */}
      {meta.hasMultipleOutputs ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{
              background: "#10b981",
              border: "2px solid #fff",
              width: 10,
              height: 10,
              right: -5,
              top: "35%",
            }}
          />
          <span
            className="absolute right-[10px] text-[9px] font-medium text-emerald-600 pointer-events-none"
            style={{ top: "30%" }}
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
              width: 10,
              height: 10,
              right: -5,
              top: "70%",
            }}
          />
          <span
            className="absolute right-[10px] text-[9px] font-medium text-red-500 pointer-events-none"
            style={{ top: "65%" }}
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
            width: 10,
            height: 10,
            right: -5,
          }}
        />
      )}
    </div>
  );
}

function NodePreview({ kind, data }: { kind: PlaybookNodeKind; data: Record<string, unknown> }) {
  switch (kind) {
    case "trigger_keyword": {
      const patterns = (data.patterns as string[]) || [];
      return (
        <div className="flex flex-wrap gap-1">
          {patterns.slice(0, 3).map((p, i) => (
            <span key={i} className="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono text-slate-700">
              {p}
            </span>
          ))}
          {patterns.length > 3 && (
            <span className="text-[10px] text-[#697386]">+{patterns.length - 3}</span>
          )}
          {patterns.length === 0 && <span className="italic text-[10px]">sem palavras</span>}
        </div>
      );
    }
    case "send_text": {
      const text = (data.text as string) || "";
      return <div className="line-clamp-2 italic">"{text || "vazio"}"</div>;
    }
    case "branch": {
      const cond = (data.condition as string) || "";
      return <div className="font-mono text-[10px] line-clamp-2">{cond || "sem condição"}</div>;
    }
    case "wait": {
      const s = (data.duration_seconds as number) || 0;
      const human = s >= 3600 ? `${Math.round(s / 3600)}h` : s >= 60 ? `${Math.round(s / 60)}min` : `${s}s`;
      return <div>Pausar {human}</div>;
    }
    case "set_var": {
      const key = (data.key as string) || "?";
      const value = String(data.value ?? "");
      return (
        <div className="font-mono text-[10px] line-clamp-1">
          {key} = "{value}"
        </div>
      );
    }
    case "trigger_manual":
      return <div>Disparo via botão</div>;
    case "trigger_cron":
      return <div className="font-mono text-[10px]">{(data.cron_expr as string) || "* * * * *"}</div>;
    case "trigger_event":
      return <div className="font-mono text-[10px]">evt: {(data.event_key as string) || "?"}</div>;
    case "trigger_intent": {
      const intents = (data.intents as string[]) || [];
      return <div>Intenções: {intents.join(", ") || "—"}</div>;
    }
    case "llm_step": {
      const prompt = (data.system_prompt as string) || "";
      return <div className="line-clamp-2 italic">{prompt || "sem prompt"}</div>;
    }
    case "knowledge_lookup":
      return <div>Buscar: {(data.query as string) || "—"}</div>;
    case "call_api":
      return (
        <div className="font-mono text-[10px] line-clamp-1">
          {(data.method as string) || "POST"} {(data.url as string) || "—"}
        </div>
      );
    case "tier_pay": {
      const cents = (data.valor_cents as number) || 0;
      return <div>R$ {(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>;
    }
    case "handoff_human":
      return <div>Fila: {(data.queue as string) || "padrão"}</div>;
    default:
      return null;
  }
}

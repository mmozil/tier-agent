import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";

import {
  NODE_CATALOG,
  categoryLabel,
  type NodeCategory,
  type NodeKindMeta,
} from "@/lib/playbookSchema";

interface Props {
  onDragStart: (e: React.DragEvent, meta: NodeKindMeta) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const CATEGORIES: NodeCategory[] = ["trigger", "action", "flow", "integration"];

export default function NodePalette({ onDragStart, collapsed, onToggleCollapse }: Props) {
  const [query, setQuery] = useState("");

  if (collapsed) {
    return (
      <div
        className="w-[48px] shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-2 gap-1 h-full"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif' }}
      >
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="Expandir paleta"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-7 h-px bg-slate-200 my-1" />
        {NODE_CATALOG.filter((m) => m.available).slice(0, 12).map((meta) => {
          const Icon = meta.icon;
          return (
            <button
              key={meta.kind}
              draggable
              onDragStart={(e) => onDragStart(e, meta)}
              title={meta.label}
              className="w-8 h-8 inline-flex items-center justify-center rounded-md cursor-grab active:cursor-grabbing hover:bg-slate-100 transition-colors"
              style={{ color: meta.color }}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  const q = query.trim().toLowerCase();

  return (
    <div
      className="w-[240px] shrink-0 bg-white border-r border-slate-200 overflow-y-auto h-full flex flex-col"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#003083]" />
            <h3 className="text-[13px] font-semibold text-[#1a2c44]">Nós</h3>
          </div>
          <button
            onClick={onToggleCollapse}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Recolher paleta"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nó..."
            className="w-full h-7 pl-8 pr-3 text-[12px] rounded-md bg-slate-50 text-slate-700 placeholder:text-slate-400 outline-none focus:bg-white focus:shadow-[0_0_0_2px_#003083]/15 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {CATEGORIES.map((cat) => {
          const items = NODE_CATALOG.filter(
            (n) =>
              n.category === cat &&
              (q === "" || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)),
          );
          if (!items.length) return null;
          return (
            <div key={cat} className="px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#697386] mb-1.5 px-1">
                {categoryLabel(cat)}
              </div>
              <div className="space-y-1">
                {items.map((meta) => (
                  <PaletteItem key={meta.kind} meta={meta} onDragStart={onDragStart} />
                ))}
              </div>
            </div>
          );
        })}

        {q && NODE_CATALOG.filter((n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)).length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-[#697386]">
            Nenhum nó encontrado pra "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

function PaletteItem({
  meta,
  onDragStart,
}: {
  meta: NodeKindMeta;
  onDragStart: (e: React.DragEvent, meta: NodeKindMeta) => void;
}) {
  const Icon = meta.icon;
  const draggable = meta.available;
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => draggable && onDragStart(e, meta)}
      className={`group relative flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-all ${
        draggable
          ? "cursor-grab active:cursor-grabbing hover:bg-slate-50 hover:shadow-[0_0_0_1px_rgb(226,232,240)] active:scale-[0.98]"
          : "cursor-not-allowed opacity-50"
      }`}
      title={meta.description}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105"
        style={{
          backgroundColor: `${meta.color}14`,
          boxShadow: `0 0 0 1px ${meta.color}26`,
        }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-[#1a2c44] truncate leading-tight">{meta.label}</div>
        <div className="text-[10px] text-[#697386] leading-tight mt-0.5 line-clamp-2">
          {meta.description}
        </div>
      </div>
      {!meta.available && (
        <span className="absolute top-1.5 right-1.5 text-[9px] text-[#697386] bg-slate-100 px-1 py-0.5 rounded font-medium">
          em breve
        </span>
      )}
    </div>
  );
}

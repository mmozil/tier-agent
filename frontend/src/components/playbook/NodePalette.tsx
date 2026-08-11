import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";

import { FC } from "@/components/ds/fc";
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

// Superfície da paleta — casa com o painel de config e com o resto do admin.
const SURFACE = "bg-white dark:bg-[#0f1216]";

export default function NodePalette({ onDragStart, collapsed, onToggleCollapse }: Props) {
  const [query, setQuery] = useState("");

  if (collapsed) {
    // Recolhida: TODOS os nós disponíveis continuam alcançáveis (a coluna rola).
    // Antes havia um .slice(0, 12) que sumia com 5 nós sem nenhum aviso.
    return (
      <div className={`w-[48px] shrink-0 ${SURFACE} border-r ${FC.hair} flex flex-col items-center py-2 gap-1 h-full`}>
        <button
          onClick={onToggleCollapse}
          className={`w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-[8px] ${FC.mut} hover:text-[#262626] dark:hover:text-white ${FC.hover} transition-colors`}
          title="Expandir paleta"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className={`w-7 h-px ${FC.hairBg} my-1 shrink-0`} />
        <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll flex flex-col items-center gap-1">
          {NODE_CATALOG.filter((m) => m.available).map((meta) => {
            const Icon = meta.icon;
            return (
              <button
                key={meta.kind}
                draggable
                onDragStart={(e) => onDragStart(e, meta)}
                title={meta.label}
                className={`w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-[8px] cursor-grab active:cursor-grabbing ${FC.hover} transition-colors`}
                style={{ color: meta.color }}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const q = query.trim().toLowerCase();

  return (
    <div className={`w-[240px] shrink-0 ${SURFACE} border-r ${FC.hair} overflow-y-auto h-full flex flex-col`}>
      {/* Header */}
      <div className={`px-4 pt-3 pb-2.5 border-b ${FC.hair} sticky top-0 ${SURFACE} z-10`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#003083] dark:text-[#5b9bff]" />
            <h3 className={`text-[13px] font-semibold ${FC.ink}`}>Nós</h3>
          </div>
          <button
            onClick={onToggleCollapse}
            className={`w-6 h-6 inline-flex items-center justify-center rounded-[7px] ${FC.mut} hover:text-[#262626] dark:hover:text-white ${FC.hover} transition-colors`}
            title="Recolher paleta"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${FC.mut} pointer-events-none`} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nó…"
            // ⚠️ placeholder precisa das classes escritas por extenso: interpolar um
            // token multi-classe (`placeholder:${FC.mut}`) prefixa só a primeira e o
            // `dark:` vaza pro texto inteiro do input.
            className={`w-full h-8 pl-8 pr-3 text-[12px] rounded-[10px] bg-black/[0.035] dark:bg-white/[0.05] ${FC.ink} placeholder:text-[#262626]/40 dark:placeholder:text-[#6b7280] outline-none transition-shadow focus:shadow-[0_0_0_2px_#003083] dark:focus:shadow-[0_0_0_2px_#5b9bff]`}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll py-2">
        {CATEGORIES.map((cat) => {
          const items = NODE_CATALOG.filter(
            (n) =>
              n.category === cat &&
              (q === "" || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)),
          );
          if (!items.length) return null;
          return (
            <div key={cat} className="px-3 py-2">
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${FC.mut} mb-1.5 px-1`}>
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

        {q &&
          NODE_CATALOG.filter((n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
            .length === 0 && (
            <div className={`px-4 py-8 text-center text-[12px] ${FC.sub}`}>Nenhum nó encontrado pra "{query}"</div>
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
      className={`group relative flex items-start gap-2.5 px-2.5 py-2 rounded-[10px] transition-all ${
        draggable
          ? `cursor-grab active:cursor-grabbing ${FC.hover} active:scale-[0.98]`
          : "cursor-not-allowed opacity-50"
      }`}
      title={meta.description}
    >
      <div
        className="w-7 h-7 rounded-[7px] flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105"
        style={{ backgroundColor: `${meta.color}14`, boxShadow: `inset 0 0 0 1px ${meta.color}26` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[12px] font-medium truncate leading-tight ${FC.ink}`}>{meta.label}</div>
        <div className={`text-[10px] leading-tight mt-0.5 line-clamp-2 ${FC.sub}`}>{meta.description}</div>
      </div>
      {!meta.available && (
        <span
          className={`absolute top-1.5 right-1.5 text-[9px] px-1 py-0.5 rounded font-medium bg-black/[0.05] dark:bg-white/[0.07] ${FC.mut}`}
        >
          em breve
        </span>
      )}
    </div>
  );
}

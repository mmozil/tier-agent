import { NODE_CATALOG, categoryLabel, type NodeCategory, type NodeKindMeta } from "@/lib/playbookSchema";

interface Props {
  onDragStart: (e: React.DragEvent, meta: NodeKindMeta) => void;
}

const CATEGORIES: NodeCategory[] = ["trigger", "action", "flow", "integration"];

export default function NodePalette({ onDragStart }: Props) {
  return (
    <div
      className="w-[220px] shrink-0 bg-white border-r border-slate-200 overflow-y-auto h-full"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-semibold text-[#1a2c44]">Nós</h3>
        <p className="text-[11px] text-[#697386] mt-0.5">Arraste pro canvas →</p>
      </div>

      {CATEGORIES.map((cat) => {
        const items = NODE_CATALOG.filter((n) => n.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="px-3 py-3 border-b border-slate-100 last:border-b-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#697386] mb-2 px-1">
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
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
        draggable
          ? "cursor-grab active:cursor-grabbing hover:bg-slate-50"
          : "cursor-not-allowed opacity-50"
      }`}
      title={meta.description}
    >
      <div
        className="w-6 h-6 rounded flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${meta.color}1f` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-[#1a2c44] truncate">{meta.label}</div>
      </div>
      {!meta.available && (
        <span className="text-[9px] text-[#697386] bg-slate-100 px-1 py-0.5 rounded">
          em breve
        </span>
      )}
    </div>
  );
}

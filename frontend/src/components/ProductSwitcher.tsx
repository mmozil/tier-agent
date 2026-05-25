import { useState, useRef, useEffect } from "react";
import { Grid3x3, ExternalLink } from "lucide-react";

const PRODUTOS = [
  { key: "agent", label: "Tier Agent", url: "https://agent.tier.finance", color: "#7c3aed" },
  { key: "app", label: "Tier Personal", url: "https://app.tier.finance", color: "#003083" },
  { key: "erp", label: "Tier Empresas", url: "https://erp.tier.finance", color: "#003083" },
  { key: "emissor", label: "Tier Emissor", url: "https://emissor.tier.finance", color: "#10b981" },
  { key: "pay", label: "Tier Pay", url: "https://pay.tier.finance", color: "#10b981" },
  { key: "investimentos", label: "Tier Investimentos", url: "https://investimentos.tier.finance", color: "#0ea5e9" },
];

interface Props {
  current?: string;
  alignLeft?: boolean;
}

export default function ProductSwitcher({ current = "agent", alignLeft = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700"
        title="Mudar de produto"
      >
        <Grid3x3 className="w-4 h-4" />
      </button>
      {open && (
        <div
          className={`absolute ${alignLeft ? "left-0" : "right-0"} mt-2 w-[280px] bg-white rounded-lg shadow-lg border border-slate-200 py-1.5 z-50`}
        >
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500 font-medium">
            Produtos Tier
          </div>
          {PRODUTOS.map((p) => (
            <a
              key={p.key}
              href={p.url}
              className={`flex items-center justify-between px-3 py-2 text-[13px] hover:bg-slate-50 ${
                p.key === current ? "bg-slate-50 font-medium" : ""
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-slate-800">{p.label}</span>
              </span>
              {p.key === current ? (
                <span className="text-[10px] text-slate-400">atual</span>
              ) : (
                <ExternalLink className="w-3 h-3 text-slate-400" />
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

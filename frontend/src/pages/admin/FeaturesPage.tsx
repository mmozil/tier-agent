import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

interface Flag {
  id: number;
  escopo: string;
  escopo_id: number | null;
  key: string;
  value: string | null;
  enabled: boolean;
}

interface KnownFlag {
  key: string;
  description: string;
}

export default function FeaturesPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [known, setKnown] = useState<KnownFlag[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [f, k] = await Promise.all([
        api.get<Flag[]>("/feature-flags"),
        api.get<{ flags: KnownFlag[] }>("/feature-flags/known"),
      ]);
      setFlags(f.data);
      setKnown(k.data.flags);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function getFlag(key: string): Flag | undefined {
    return flags.find((f) => f.key === key && f.escopo === "global");
  }

  async function toggle(key: string, enabled: boolean) {
    try {
      await api.post("/feature-flags", { escopo: "global", escopo_id: null, key, enabled, value: enabled ? "true" : "false" });
      load();
    } catch {
      toast.error("Erro ao salvar");
    }
  }

  return (
    <div>
      <h1 className="text-[22px] font-medium text-slate-900 mb-1">Feature Flags</h1>
      <p className="text-[13px] text-slate-500 mb-6">
        Liga/desliga capacidades do agente sem deploy. Escopo global = aplica em todos os tenants.
      </p>

      {loading && <div className="text-[13px] text-slate-400">Carregando...</div>}

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {known.map((kf) => {
          const f = getFlag(kf.key);
          const enabled = f?.enabled ?? false;
          return (
            <div key={kf.key} className="flex items-center justify-between px-5 py-3">
              <div>
                <div className="text-[13px] font-medium text-slate-900 font-mono">{kf.key}</div>
                <div className="text-[12px] text-slate-500 mt-0.5">{kf.description}</div>
              </div>
              <button
                onClick={() => toggle(kf.key, !enabled)}
                className={`relative w-11 h-6 rounded-full transition ${enabled ? "bg-tier" : "bg-slate-300"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    enabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

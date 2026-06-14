import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ToggleLeft } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, EmptyHint, SkeletonBar } from "@/components/ds/fc";

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
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Feature Flags</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>
              Liga/desliga capacidades do agente sem deploy. Escopo global = aplica em todos os tenants.
            </p>
          </div>
        </Row>

        <Row last>
          <div className="p-6">
            {/* Loading: skeleton ecoa a forma das linhas de flag (não spinner no vazio) */}
            {loading ? (
              <div className={`border ${FC.hair} rounded-lg divide-y ${FC.hair} overflow-hidden`}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5">
                    <div className="space-y-2">
                      <SkeletonBar className="h-3.5 w-40" />
                      <SkeletonBar className="h-3 w-56" />
                    </div>
                    <SkeletonBar className="h-6 w-11 rounded-full" />
                  </div>
                ))}
              </div>
            ) : known.length === 0 ? (
              <EmptyHint icon={ToggleLeft} text="Nenhuma feature flag disponível ainda." />
            ) : (
              <div className={`border ${FC.hair} rounded-lg divide-y ${FC.hair} overflow-hidden`}>
                {known.map((kf) => {
                  const f = getFlag(kf.key);
                  const enabled = f?.enabled ?? false;
                  return (
                    <div key={kf.key} className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        {/* key é identificador técnico → mantém mono */}
                        <div className={`text-[13px] font-medium font-mono ${FC.ink}`}>{kf.key}</div>
                        <div className={`text-[12px] mt-0.5 ${FC.sub}`}>{kf.description}</div>
                      </div>
                      <button
                        onClick={() => toggle(kf.key, !enabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? "bg-[#003083] dark:bg-[#5b9bff]" : "bg-[#262626]/20 dark:bg-white/20"}`}
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
            )}
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

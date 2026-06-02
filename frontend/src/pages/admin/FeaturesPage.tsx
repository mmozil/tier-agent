import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { api } from "@/lib/api";
import { FC, PageFrame, Row } from "@/components/ds/fc";

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
            {loading && <div className={`text-[13px] mb-3 ${FC.mut}`}>Carregando...</div>}
            <div className={`border ${FC.hair} rounded-lg divide-y ${FC.hair} overflow-hidden`}>
              {known.map((kf) => {
                const f = getFlag(kf.key);
                const enabled = f?.enabled ?? false;
                return (
                  <div key={kf.key} className="flex items-center justify-between px-5 py-3.5">
                    <div>
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
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

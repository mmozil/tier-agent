import { useEffect, useState } from "react";

import { api } from "@/lib/api";

/** Pílula online/offline — só aparece pra atendente (membro). O dono não entra
 * no rodízio, então pra ele o componente não renderiza nada. */
export default function OnlineToggle() {
  const [isMember, setIsMember] = useState(false);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ member_id: number | null }>("/team/me")
      .then(({ data }) => setIsMember(!!data.member_id))
      .catch(() => {});
  }, []);

  async function toggle() {
    setLoading(true);
    const next = !online;
    try {
      await api.post("/team/online", { online: next });
      setOnline(next);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }

  if (!isMember) return null;

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={online ? "Você está recebendo conversas" : "Você não está no rodízio"}
      className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium transition-colors ${
        online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
      {online ? "Online" : "Offline"}
    </button>
  );
}

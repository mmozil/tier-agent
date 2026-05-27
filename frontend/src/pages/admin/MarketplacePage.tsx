import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Loader2, Sparkles, Star, Workflow } from "lucide-react";

import { api } from "@/lib/api";

interface MarketplaceItem {
  id: number;
  nome: string;
  public_label: string | null;
  public_description: string | null;
  nodes_count: number;
  marketplace_downloads: number;
  marketplace_rating: number | null;
  published_at: string | null;
}

interface Agent {
  id: number;
  nome: string;
}

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<{ tplId: number | null; agentId: number }>({
    tplId: null,
    agentId: 0,
  });

  async function load() {
    setLoading(true);
    try {
      const [it, ag] = await Promise.all([
        api.get<MarketplaceItem[]>("/playbooks/marketplace"),
        api.get<Agent[]>("/agents"),
      ]);
      setItems(it.data);
      setAgents(ag.data);
      if (ag.data.length > 0) {
        setImporting((prev) => ({ ...prev, agentId: ag.data[0].id }));
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar marketplace");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function importTpl(item: MarketplaceItem) {
    if (!importing.agentId) {
      toast.error("Crie um agente primeiro");
      return;
    }
    setImporting({ tplId: item.id, agentId: importing.agentId });
    try {
      const { data } = await api.post<{ id: number }>(
        `/playbooks/marketplace/${item.id}/import`,
        { agent_id: importing.agentId },
      );
      toast.success("Importado!");
      navigate(`/admin/playbooks/${data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao importar");
    } finally {
      setImporting({ tplId: null, agentId: importing.agentId });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mt-6 mb-2">
        <h1 className="text-[28px] font-bold text-[#30313d]">Marketplace</h1>
        {agents.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-[#697386]">Importar pra:</label>
            <select
              value={importing.agentId}
              onChange={(e) =>
                setImporting({ ...importing, agentId: Number(e.target.value) })
              }
              className="h-7 px-3 text-[13px] rounded-md bg-white outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083]"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        Templates de playbook publicados pela comunidade Tier. Importe pro seu workspace e adapte.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#f4f7fa] rounded-lg p-12 text-center">
          <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
            <Sparkles className="w-6 h-6 text-[#003083]" />
          </div>
          <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">
            Marketplace ainda vazio
          </h3>
          <p className="text-[13px] text-[#697386]">
            Seja o primeiro a publicar um playbook! No editor → botão "Publicar no marketplace".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((it) => (
            <div
              key={it.id}
              className="bg-white rounded-md p-5 shadow-[0_0_0_1px_rgb(226,232,240)] hover:shadow-[0_0_0_1px_rgb(180,190,210)] transition-shadow flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] flex items-center justify-center">
                  <Workflow className="w-[18px] h-[18px] text-[#003083]" />
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                  <Download className="w-3 h-3" />
                  {it.marketplace_downloads}
                </span>
              </div>
              <div className="text-[14px] font-semibold text-[#1a2c44] mb-1">
                {it.public_label || it.nome}
              </div>
              {it.public_description && (
                <p className="text-[12px] text-[#697386] leading-relaxed mb-3 line-clamp-3 flex-1">
                  {it.public_description}
                </p>
              )}
              <div className="flex items-center justify-between text-[11px] text-[#697386] mb-3">
                <span>{it.nodes_count} nós</span>
                {it.marketplace_rating && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-500" />
                    {it.marketplace_rating.toFixed(1)}
                  </span>
                )}
              </div>
              <button
                onClick={() => importTpl(it)}
                disabled={importing.tplId === it.id || agents.length === 0}
                className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
              >
                {importing.tplId === it.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                Importar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Loader2, Store, Star, Workflow } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button, EmptyHint, SKEL } from "@/components/ds/fc";

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
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[500] fc-crisp tracking-[-0.1px] leading-7 ${FC.ink}`}>Marketplace</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.dim}`}>
                Templates de playbook publicados pela comunidade Tier. Importe pro seu workspace e adapte.
              </p>
            </div>
            {agents.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <label className={`text-[12px] ${FC.sub}`}>Importar pra:</label>
                <select
                  value={importing.agentId}
                  onChange={(e) => setImporting({ ...importing, agentId: Number(e.target.value) })}
                  className={`h-8 px-2.5 text-[13px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`}
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
        </Row>

        {loading ? (
          <Row last>
            <HairCells cols={3} gridLines>
              {/* Skeleton ecoa o grid de cards de template (ícone + título + descrição + botão). */}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-6 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-9 h-9 rounded-md ${SKEL}`} />
                    <div className={`h-5 w-10 ${SKEL}`} />
                  </div>
                  <div className={`h-3.5 w-3/4 mb-2 ${SKEL}`} />
                  <div className={`h-3 w-full mb-1.5 ${SKEL}`} />
                  <div className={`h-3 w-5/6 mb-3 ${SKEL}`} />
                  <div className={`h-3 w-1/2 mb-3 ${SKEL}`} />
                  <div className={`h-7 w-full ${SKEL}`} />
                </div>
              ))}
            </HairCells>
          </Row>
        ) : items.length === 0 ? (
          <Row last>
            <div className="py-12">
              <EmptyHint
                icon={Store}
                text='Marketplace ainda vazio. Seja o primeiro a publicar um playbook — no editor, use o botão "Publicar no marketplace".'
                ctaLabel="Abrir playbooks"
                ctaTo="/admin/playbooks"
              />
            </div>
          </Row>
        ) : (
          <Row>
            <HairCells cols={3} gridLines>
              {items.map((it) => (
                <div key={it.id} className="p-6 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-md bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.12] flex items-center justify-center">
                      <Workflow className="w-[18px] h-[18px] text-[#003083] dark:text-[#5b9bff]" />
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#262626]/[0.06] ${FC.sub}`}>
                      <Download className="w-3 h-3" />
                      {it.marketplace_downloads}
                    </span>
                  </div>
                  <div className={`text-[14px] font-medium mb-1 ${FC.ink}`}>{it.public_label || it.nome}</div>
                  {it.public_description && (
                    <p className={`text-[12px] leading-relaxed mb-3 line-clamp-3 flex-1 ${FC.sub}`}>{it.public_description}</p>
                  )}
                  <div className={`flex items-center justify-between text-[11px] mb-3 ${FC.sub}`}>
                    <span>{it.nodes_count} nós</span>
                    {it.marketplace_rating && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="w-3 h-3 text-[#F5A300]" />
                        {it.marketplace_rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => importTpl(it)}
                    disabled={importing.tplId === it.id || agents.length === 0}
                    className="w-full"
                  >
                    {importing.tplId === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    Importar
                  </Button>
                </div>
              ))}
            </HairCells>
          </Row>
        )}
      </PageFrame>
    </div>
  );
}

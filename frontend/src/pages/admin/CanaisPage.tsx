import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, MessageSquare, RefreshCw, Trash2, X } from "lucide-react";

import { api } from "@/lib/api";

interface Agent {
  id: number;
  nome: string;
}

interface Connector {
  id: number;
  agent_id: number;
  kind: string;
  enabled: boolean;
  config_summary: {
    instance_id?: string;
    phone?: string;
    status?: string;
  };
  last_event_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  connected: "text-emerald-700",
  pending: "text-amber-600",
  disconnected: "text-slate-400",
  unknown: "text-slate-400",
};

export default function CanaisPage() {
  const [conns, setConns] = useState<Connector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [qrModal, setQrModal] = useState<{ connId: number; qr: string; status: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        api.get<Connector[]>("/connectors"),
        api.get<Agent[]>("/agents"),
      ]);
      setConns(c.data);
      setAgents(a.data);
      if (!selectedAgent && a.data.length > 0) setSelectedAgent(a.data[0].id);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function provisionWhatsApp() {
    if (!selectedAgent) {
      toast.error("Escolha um agente");
      return;
    }
    setProvisioning(true);
    try {
      const { data } = await api.post<Connector>("/connectors/whatsapp/provision", {
        agent_id: selectedAgent,
      });
      toast.success("Instância criada — escaneie o QR");
      setShowProvision(false);
      // Imediatamente abre modal QR
      await openQR(data.id);
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Erro ao provisionar");
    } finally {
      setProvisioning(false);
    }
  }

  async function openQR(connId: number) {
    try {
      const { data } = await api.post(`/connectors/${connId}/connect`);
      setQrModal({ connId, qr: data.qr_code || "", status: data.status });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao conectar");
    }
  }

  async function refreshStatus(connId: number) {
    try {
      const { data } = await api.get(`/connectors/${connId}/status`);
      if (qrModal?.connId === connId) {
        setQrModal({ ...qrModal, qr: data.qr_code || qrModal.qr, status: data.status });
        if (data.status === "connected") {
          toast.success("WhatsApp conectado!");
          setQrModal(null);
          load();
        }
      }
    } catch {
      // silent
    }
  }

  // Poll status quando modal aberto
  useEffect(() => {
    if (!qrModal) return;
    const id = setInterval(() => refreshStatus(qrModal.connId), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrModal?.connId]);

  async function onDelete(id: number) {
    if (!confirm("Remover este canal?")) return;
    try {
      await api.delete(`/connectors/${id}`);
      toast.success("Canal removido");
      load();
    } catch {
      toast.error("Erro ao remover");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-medium tracking-tight text-slate-900">Canais</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Conecte WhatsApp, Telegram, Email e outros canais aos seus agentes.
          </p>
        </div>
        <button
          onClick={() => setShowProvision(true)}
          className="h-6 px-2 bg-tier hover:bg-tier-dark text-white text-[12px] rounded-md inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Conectar WhatsApp
        </button>
      </div>

      {showProvision && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          <h2 className="text-[14px] font-medium text-slate-900">Conectar WhatsApp</h2>
          <label className="block">
            <span className="text-[12px] text-slate-700">Vincular ao agente</span>
            <select
              value={selectedAgent || ""}
              onChange={(e) => setSelectedAgent(Number(e.target.value))}
              className="mt-1 w-full h-7 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-slate-500">
            Cria uma instância isolada do WhatsApp pra esse agente. Você vai escanear um QR code com
            seu celular pra parear.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowProvision(false)}
              className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md"
            >
              Cancelar
            </button>
            <button
              onClick={provisionWhatsApp}
              disabled={provisioning}
              className="h-6 px-2 bg-tier text-white text-[12px] rounded-md hover:bg-tier-dark disabled:opacity-50 inline-flex items-center gap-1"
            >
              {provisioning ? "Criando..." : "Criar e conectar"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Canal</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Agente</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Telefone</th>
              <th className="text-left text-[12px] font-medium text-slate-600 px-4 py-2.5">Status</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && conns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-slate-400">
                  Nenhum canal conectado. Clique em "Conectar WhatsApp".
                </td>
              </tr>
            )}
            {conns.map((c) => {
              const status = c.config_summary?.status || "unknown";
              return (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-slate-900 inline-flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    {c.kind}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700">
                    {agents.find((a) => a.id === c.agent_id)?.nome || `Agente #${c.agent_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700 font-mono">
                    {c.config_summary?.phone || "—"}
                  </td>
                  <td className={`px-4 py-2.5 text-[13px] ${STATUS_COLOR[status] || "text-slate-500"}`}>
                    ● {status}
                  </td>
                  <td className="px-2 py-2.5 flex items-center gap-1">
                    {status !== "connected" && (
                      <button
                        onClick={() => openQR(c.id)}
                        className="p-1.5 hover:bg-slate-50 text-slate-500 hover:text-tier rounded"
                        title="Reabrir QR"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(c.id)}
                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded"
                      title="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[18px] font-medium text-slate-900">Escaneie o QR</h2>
                <p className="text-[13px] text-slate-500 mt-1">
                  WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho
                </p>
              </div>
              <button
                onClick={() => setQrModal(null)}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 rounded-lg p-6 flex items-center justify-center min-h-[280px]">
              {qrModal.qr ? (
                <img
                  src={
                    qrModal.qr.startsWith("data:")
                      ? qrModal.qr
                      : `data:image/png;base64,${qrModal.qr}`
                  }
                  alt="QR Code"
                  className="w-64 h-64"
                />
              ) : (
                <div className="text-[13px] text-slate-400">Gerando QR...</div>
              )}
            </div>

            <div className="mt-4 text-center text-[12px] text-slate-500">
              Status: <span className="font-medium">{qrModal.status}</span> · auto-refresh a cada 4s
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

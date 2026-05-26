import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, QrCode, Trash2, X, Unplug } from "lucide-react";

import { api } from "@/lib/api";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

const STATUS_META: Record<
  string,
  { color: string; bg: string; label: string; tip: string }
> = {
  connected: {
    color: "bg-emerald-500",
    bg: "bg-emerald-50",
    label: "Conectado",
    tip: "Pareado e recebendo mensagens",
  },
  qr: {
    color: "bg-amber-500",
    bg: "bg-amber-50",
    label: "Aguardando pareamento",
    tip: "Escaneie o QR Code com seu WhatsApp",
  },
  pending: {
    color: "bg-amber-500",
    bg: "bg-amber-50",
    label: "Pendente",
    tip: "Instância criada, aguardando QR Code",
  },
  connecting: {
    color: "bg-amber-500",
    bg: "bg-amber-50",
    label: "Conectando",
    tip: "Estabelecendo conexão",
  },
  disconnected: {
    color: "bg-slate-300",
    bg: "bg-slate-50",
    label: "Desconectado",
    tip: "Conexão encerrada",
  },
  unknown: {
    color: "bg-slate-300",
    bg: "bg-slate-50",
    label: "Desconhecido",
    tip: "Sem resposta da plataforma",
  },
};

function formatPhone(p: string | undefined | null): string {
  if (!p || p === "—") return "—";
  // remove tudo que não é dígito
  const d = p.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return p;
}

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
          <h1 className="text-[28px] font-bold text-[#30313d]">Canais</h1>
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
              <th className="text-right text-[12px] font-medium text-slate-600 px-4 py-2.5 w-[180px]">Ações</th>
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
              const meta = STATUS_META[status] || STATUS_META.unknown;
              return (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-slate-900">
                    <div className="inline-flex items-center gap-2">
                      <WhatsAppIcon className="w-4 h-4" />
                      WhatsApp
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700">
                    {agents.find((a) => a.id === c.agent_id)?.nome || `Agente #${c.agent_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-700 font-mono">
                    {formatPhone(c.config_summary?.phone)}
                  </td>
                  <td className="px-4 py-2.5 text-[13px]">
                    <span className="group relative inline-flex items-center gap-1.5 cursor-help">
                      <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                      <span className="text-slate-700">{meta.label}</span>
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-900 text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-10 shadow-lg"
                        role="tooltip"
                      >
                        {meta.tip}
                        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-900" />
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      {status !== "connected" ? (
                        <button
                          onClick={() => openQR(c.id)}
                          className="h-6 px-2 bg-tier hover:bg-tier-dark text-white text-[12px] rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <QrCode className="w-3 h-3 shrink-0" /> Escanear QR
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            if (!confirm("Desconectar este WhatsApp?")) return;
                            try {
                              await api.post(`/connectors/${c.id}/disconnect`);
                              toast.success("Desconectado");
                              load();
                            } catch {
                              toast.error("Erro ao desconectar");
                            }
                          }}
                          className="h-6 px-2 text-[12px] text-slate-600 hover:bg-slate-100 rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                          title="Desconectar"
                        >
                          <Unplug className="w-3 h-3 shrink-0" /> Desconectar
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(c.id)}
                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded"
                        title="Remover canal permanentemente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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

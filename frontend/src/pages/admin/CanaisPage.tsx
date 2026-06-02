import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, QrCode, Trash2, X, Unplug, Check, Loader2, Smartphone } from "lucide-react";

import { api } from "@/lib/api";
import ConnectWhatsAppCloud from "@/components/ConnectWhatsAppCloud";
import { FC, PageFrame, Row, Button } from "@/components/ds/fc";

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

const STATUS_META: Record<string, { color: string; label: string; tip: string }> = {
  connected: { color: "bg-[#0a8f5a]", label: "Conectado", tip: "Pareado e recebendo mensagens" },
  qr: { color: "bg-[#F5A300]", label: "Aguardando pareamento", tip: "Escaneie o QR Code com seu WhatsApp" },
  pending: { color: "bg-[#F5A300]", label: "Pendente", tip: "Instância criada, aguardando QR Code" },
  connecting: { color: "bg-[#F5A300]", label: "Conectando", tip: "Estabelecendo conexão" },
  disconnected: { color: "bg-[#262626]/25", label: "Desconectado", tip: "Conexão encerrada" },
  unknown: { color: "bg-[#262626]/25", label: "Desconhecido", tip: "Sem resposta da plataforma" },
};

function formatPhone(p: string | undefined | null): string {
  if (!p || p === "—") return "—";
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
  config_summary: { instance_id?: string; phone?: string; status?: string };
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
      const [c, a] = await Promise.all([api.get<Connector[]>("/connectors"), api.get<Agent[]>("/agents")]);
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
      const { data } = await api.post<Connector>("/connectors/whatsapp/provision", { agent_id: selectedAgent });
      toast.success("Instância criada — escaneie o QR");
      setShowProvision(false);
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
        if (data.status === "connected" && qrModal.status !== "connected") {
          setQrModal({ ...qrModal, status: "connected" });
          toast.success("WhatsApp conectado!");
          setTimeout(() => {
            setQrModal(null);
            load();
          }, 1400);
        } else if (data.status !== "connected") {
          setQrModal({ ...qrModal, qr: data.qr_code || qrModal.qr, status: data.status });
        }
      }
    } catch {
      // silent
    }
  }

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

  const th = `text-left text-[11px] font-semibold uppercase tracking-wider px-6 py-2.5 ${FC.mut}`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="flex items-start justify-between gap-4 p-6">
            <div>
              <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Canais</h2>
              <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Conecte WhatsApp, Telegram, Email e outros canais aos seus agentes.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {selectedAgent ? (
                <ConnectWhatsAppCloud agentId={selectedAgent} onConnected={load} />
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => toast.error("Crie um agente primeiro para conectar um canal.")}
                  title="Crie um agente primeiro para conectar um canal"
                  className="opacity-60 whitespace-nowrap"
                >
                  Conectar WhatsApp Oficial
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  if (!selectedAgent) {
                    toast.error("Crie um agente primeiro para conectar um canal.");
                    return;
                  }
                  setShowProvision(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" /> Conectar WhatsApp
              </Button>
            </div>
          </div>
        </Row>

        {showProvision && (
          <Row>
            <div className="p-6 space-y-4">
              <h3 className={`text-[16px] font-[450] tracking-[-0.1px] ${FC.ink}`}>Conectar WhatsApp</h3>
              <label className="block">
                <span className={`text-[12px] ${FC.sub}`}>Vincular ao agente</span>
                <select
                  value={selectedAgent || ""}
                  onChange={(e) => setSelectedAgent(Number(e.target.value))}
                  className={`mt-1 w-full h-9 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              </label>
              <p className={`text-[12px] ${FC.sub}`}>
                Cria uma instância isolada do WhatsApp pra esse agente. Você vai escanear um QR code com seu celular pra parear.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowProvision(false)}>Cancelar</Button>
                <Button variant="primary" onClick={provisionWhatsApp} disabled={provisioning}>{provisioning ? "Criando..." : "Criar e conectar"}</Button>
              </div>
            </div>
          </Row>
        )}

        <Row last>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${FC.hair}`}>
                  <th className={th}>Canal</th>
                  <th className={th}>Agente</th>
                  <th className={th}>Telefone</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right w-[180px]`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className={`px-6 py-6 text-center text-[13px] ${FC.mut}`}>Carregando...</td></tr>
                )}
                {!loading && conns.length === 0 && (
                  <tr><td colSpan={5} className={`px-6 py-6 text-center text-[13px] ${FC.mut}`}>
                    {agents.length === 0 ? "Crie um agente primeiro (menu Agentes) para conectar um canal." : 'Nenhum canal conectado. Clique em "Conectar WhatsApp".'}
                  </td></tr>
                )}
                {conns.map((c) => {
                  const status = c.config_summary?.status || "unknown";
                  const meta = STATUS_META[status] || STATUS_META.unknown;
                  return (
                    <tr key={c.id} className={`border-b ${FC.hair} last:border-0 ${FC.hover}`}>
                      <td className={`px-6 py-2.5 text-[13px] font-medium ${FC.ink}`}>
                        <div className="inline-flex items-center gap-2"><WhatsAppIcon className="w-4 h-4" /> WhatsApp</div>
                      </td>
                      <td className={`px-6 py-2.5 text-[13px] ${FC.sub}`}>{agents.find((a) => a.id === c.agent_id)?.nome || `Agente #${c.agent_id}`}</td>
                      <td className={`px-6 py-2.5 text-[13px] font-mono ${FC.sub}`}>{formatPhone(c.config_summary?.phone)}</td>
                      <td className="px-6 py-2.5 text-[13px]">
                        <span className="inline-flex items-center gap-1.5" title={meta.tip}>
                          <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                          <span className={FC.sub}>{meta.label}</span>
                        </span>
                      </td>
                      <td className="px-6 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          {status !== "connected" ? (
                            <Button variant="primary" size="sm" onClick={() => openQR(c.id)} className="whitespace-nowrap">
                              <QrCode className="w-3 h-3 shrink-0" /> Escanear QR
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              title="Desconectar"
                              className="whitespace-nowrap"
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
                            >
                              <Unplug className="w-3 h-3 shrink-0" /> Desconectar
                            </Button>
                          )}
                          <button onClick={() => onDelete(c.id)} className={`p-1.5 rounded-md ${FC.mut} hover:text-[#E5484D] hover:bg-[#E5484D]/[0.08]`} title="Remover canal permanentemente">
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
        </Row>
      </PageFrame>

      {/* QR Modal (mantido — só tokens FC) */}
      {qrModal &&
        (() => {
          const isConnected = qrModal.status === "connected";
          const isConnecting = qrModal.status === "connecting";
          const qrSrc = qrModal.qr ? (qrModal.qr.startsWith("data:") ? qrModal.qr : `data:image/png;base64,${qrModal.qr}`) : "";
          const steps = [
            "Abra o WhatsApp no seu celular",
            "Toque em Configurações → Aparelhos conectados",
            "Toque em Conectar um aparelho",
            "Aponte a câmera para o código ao lado",
          ];
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
              <div className={`w-full max-w-[760px] overflow-hidden rounded-2xl bg-white dark:bg-[#0c0e12] shadow-2xl border ${FC.hair}`}>
                <div className={`flex items-center gap-3 border-b ${FC.hair} px-6 py-4`}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#25D366]/10"><WhatsAppIcon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <h2 className={`text-[15px] font-medium leading-tight ${FC.ink}`}>Conectar WhatsApp</h2>
                    <p className={`text-[12px] ${FC.sub}`}>Pareie escaneando o código — leva segundos</p>
                  </div>
                  <button onClick={() => setQrModal(null)} className={`rounded-md p-1.5 ${FC.mut} ${FC.hover}`}><X className="h-4 w-4" /></button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_280px]">
                  <div className="order-2 px-6 py-6 sm:order-1">
                    <div className={`mb-4 inline-flex items-center gap-1.5 rounded-full bg-[#262626]/[0.06] px-2.5 py-1 text-[11px] font-medium ${FC.sub}`}>
                      <Smartphone className="h-3 w-3" /> No seu celular
                    </div>
                    <ol className="space-y-3">
                      {steps.map((s, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003083]/10 text-[11px] font-semibold text-[#003083] dark:text-[#5b9bff]">{i + 1}</span>
                          <span className={`text-[13px] leading-snug ${FC.ink}`}>{s}</span>
                        </li>
                      ))}
                    </ol>
                    <div className={`mt-6 flex items-center gap-2 border-t ${FC.hair} pt-4`}>
                      {isConnected ? (
                        <>
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0a8f5a]"><Check className="h-3 w-3 text-white" strokeWidth={3} /></span>
                          <span className="text-[13px] font-medium text-[#0a8f5a]">Conectado com sucesso!</span>
                        </>
                      ) : isConnecting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-[#003083] dark:text-[#5b9bff]" />
                          <span className={`text-[13px] font-medium ${FC.ink}`}>Conectando…</span>
                        </>
                      ) : (
                        <>
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F5A300] opacity-60" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#F5A300]" />
                          </span>
                          <span className={`text-[13px] font-medium ${FC.ink}`}>Aguardando leitura</span>
                          <span className={`ml-auto text-[11px] ${FC.mut}`}>atualiza sozinho</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`order-1 flex items-center justify-center border-b ${FC.hair} bg-[#F9F9F9] dark:bg-[#16191f] p-6 sm:order-2 sm:border-b-0 sm:border-l`}>
                    <div className="relative">
                      <div className={`relative rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#EDEDED]`}>
                        <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-tl-lg border-l-2 border-t-2 border-[#003083]/40" />
                        <span className="pointer-events-none absolute right-1 top-1 h-4 w-4 rounded-tr-lg border-r-2 border-t-2 border-[#003083]/40" />
                        <span className="pointer-events-none absolute bottom-1 left-1 h-4 w-4 rounded-bl-lg border-b-2 border-l-2 border-[#003083]/40" />
                        <span className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 rounded-br-lg border-b-2 border-r-2 border-[#003083]/40" />
                        <div className="relative h-[208px] w-[208px] overflow-hidden rounded-lg">
                          {qrSrc ? (
                            <img src={qrSrc} alt="QR Code WhatsApp" className={`h-[208px] w-[208px] transition-all duration-300 ${isConnected || isConnecting ? "scale-95 opacity-20 blur-sm" : ""}`} />
                          ) : (
                            <div className={`flex h-[208px] w-[208px] flex-col items-center justify-center gap-2 ${FC.mut}`}>
                              <Loader2 className="h-5 w-5 animate-spin" />
                              <span className="text-[12px]">Gerando código…</span>
                            </div>
                          )}
                          {isConnected && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0a8f5a] shadow-lg"><Check className="h-7 w-7 text-white" strokeWidth={3} /></span>
                            </div>
                          )}
                          {isConnecting && (
                            <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#003083] dark:text-[#5b9bff]" /></div>
                          )}
                        </div>
                      </div>
                      <p className={`mt-3 text-center text-[11px] ${FC.mut}`}>O código se renova automaticamente</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

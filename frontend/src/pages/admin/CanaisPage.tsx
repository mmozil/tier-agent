import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, QrCode, Trash2, X, Unplug, Check, Loader2, Smartphone, Bot, Copy, ChevronRight } from "lucide-react";

import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { WhatsAppIcon, ChannelLogo, CHANNEL_META } from "@/components/icons/channelIcons";
import ConnectWhatsAppCloud from "@/components/ConnectWhatsAppCloud";
import { FC, PageFrame, PageHero, Row, Select, Button, EmptyHint, SkeletonBar, iconBtn } from "@/components/ds/fc";

const STATUS_META: Record<string, { color: string; label: string; tip: string }> = {
  connected: { color: "bg-[#0a8f5a]", label: "Conectado", tip: "Pareado e recebendo mensagens" },
  qr: { color: "bg-[#F5A300]", label: "Aguardando pareamento", tip: "Escaneie o QR Code com seu WhatsApp" },
  pending: { color: "bg-[#F5A300]", label: "Pendente", tip: "Instância criada, aguardando QR Code" },
  connecting: { color: "bg-[#F5A300]", label: "Conectando", tip: "Estabelecendo conexão" },
  disconnected: { color: "bg-[#262626]/25", label: "Desconectado", tip: "Conexão encerrada" },
  unknown: { color: "bg-[#262626]/25", label: "Desconhecido", tip: "Sem resposta da plataforma" },
};

interface Agent {
  id: number;
  nome: string;
  persona?: string | null;
  template_kind?: string | null;
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
    tipo?: string;
    phone_number_id?: string;
    waba_id?: string;
    oficial?: boolean;
    transporte?: string;
    host?: string;
    webhook?: string;
    pareamento?: string;
    janela?: string;
    tem_token?: boolean;
  };
  last_event_at: string | null;
}

// CodeField — valor técnico no estilo Firecrawl: rótulo + caixa de código (mono,
// fundo sutil) com botão de copiar. Pra IDs, hosts, webhooks, tokens.
function CodeField({ label, value, full }: { label: string; value: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className={`text-[11px] uppercase tracking-[0.06em] mb-1 ${FC.sub}`}>{label}</div>
      <div className={`group/code flex items-center gap-2 h-8 px-3 rounded-[10px] border ${FC.hair} bg-[#F9F9F9] dark:bg-[#16191f]`}>
        <code className={`font-mono text-[12px] truncate flex-1 ${FC.ink}`}>{value}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="Copiar"
          className={`shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-[10px] ${FC.mut} hover:text-[#262626] dark:hover:text-white transition-all active:scale-[0.98]`}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[#0a8f5a]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// Rótulo amigável do tipo de canal (fallback se o backend não mandar `tipo`)
function channelType(kind: string): string {
  if (kind === "whatsapp") return "WhatsApp (Baileys)";
  if (kind === "whatsapp_cloud") return "WhatsApp Cloud API (oficial)";
  if (kind === "telegram") return "Telegram";
  if (kind === "email") return "E-mail";
  return kind;
}

// ChannelCard — cartão de canal no seletor "Conectar canal" (logo + nome + descrição).
function ChannelCard({
  icon: Icon,
  name,
  desc,
  onClick,
  disabled = false,
  badge,
  loading = false,
}: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  desc: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`group relative flex items-center gap-3 rounded-xl border ${FC.hair} p-3.5 text-left transition-all ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-[#d8d8d8] dark:hover:border-[#33373e] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] active:scale-[0.99]"
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border ${FC.hair} bg-white dark:bg-[#14171c]`}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-[#1877F2]" /> : <Icon className="w-6 h-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`text-[13.5px] font-medium truncate ${FC.ink}`}>{name}</span>
          {badge && (
            <span className="shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-[#003083]/[0.08] text-[#003083] dark:text-[#5b9bff] uppercase tracking-wide">
              {badge}
            </span>
          )}
          {disabled && (
            <span className={`shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-[#262626]/[0.06] dark:bg-white/[0.08] uppercase tracking-wide ${FC.mut}`}>
              em breve
            </span>
          )}
        </span>
        <span className={`block text-[12px] mt-0.5 truncate ${FC.sub}`}>{desc}</span>
      </span>
      {!disabled && (
        <ChevronRight className={`w-4 h-4 shrink-0 ${FC.mut} opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0`} />
      )}
    </button>
  );
}

export default function CanaisPage() {
  const [conns, setConns] = useState<Connector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [qrModal, setQrModal] = useState<{ connId: number; qr: string; status: string } | null>(null);
  const [detail, setDetail] = useState<Connector | null>(null);
  const [showSlack, setShowSlack] = useState(false);
  const [slackForm, setSlackForm] = useState({ bot_token: "", signing_secret: "" });
  const [slackConnecting, setSlackConnecting] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState<string | null>(null);
  const [showDiscord, setShowDiscord] = useState(false);
  const [discordToken, setDiscordToken] = useState("");
  const [discordConnecting, setDiscordConnecting] = useState(false);
  const [discordResult, setDiscordResult] = useState<{ invite_url?: string; bot_username?: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);

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

  async function connectSlack() {
    if (!selectedAgent) { toast.error("Escolha um agente"); return; }
    if (!slackForm.bot_token.trim()) { toast.error("Cole o Bot Token (xoxb-...)"); return; }
    if (!slackForm.signing_secret.trim()) { toast.error("Cole o Signing Secret (autentica os eventos do Slack)"); return; }
    setSlackConnecting(true);
    try {
      const { data } = await api.post<{ id: number; webhook_url?: string }>("/connectors", {
        agent_id: selectedAgent,
        kind: "slack",
        config: { bot_token: slackForm.bot_token.trim(), signing_secret: slackForm.signing_secret.trim() },
      });
      setSlackWebhook(data.webhook_url || null);
      toast.success("Slack conectado — configure o webhook abaixo.");
      setSlackForm({ bot_token: "", signing_secret: "" });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao conectar o Slack");
    } finally {
      setSlackConnecting(false);
    }
  }

  async function connectDiscord() {
    if (!selectedAgent) { toast.error("Escolha um agente"); return; }
    if (!discordToken.trim()) { toast.error("Cole o Bot Token do Discord"); return; }
    setDiscordConnecting(true);
    try {
      const { data } = await api.post<{ id: number; invite_url?: string; bot_username?: string }>("/connectors", {
        agent_id: selectedAgent,
        kind: "discord",
        config: { bot_token: discordToken.trim() },
      });
      setDiscordResult({ invite_url: data.invite_url, bot_username: data.bot_username });
      toast.success("Discord conectado — adicione o bot ao servidor abaixo.");
      setDiscordToken("");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao conectar o Discord");
    } finally {
      setDiscordConnecting(false);
    }
  }

  // Abre o fluxo de um canal a partir do seletor (fecha o modal, valida agente).
  function pickChannel(open: () => void) {
    if (!selectedAgent) {
      toast.error("Escolha um agente");
      return;
    }
    setShowPicker(false);
    open();
  }

  const agentName = (id: number) => agents.find((a) => a.id === id)?.nome || `Agente #${id}`;
  const inputCls = `w-full h-9 px-3 text-[14px] rounded-[10px] bg-white dark:bg-[#14171c] border ${FC.hair} outline-none focus:shadow-[0_0_0_2px_#003083]`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Canais"
          subtitle="Conecte WhatsApp (oficial ou Baileys) e outros canais aos seus agentes. Cada canal fica vinculado a um agente que responde automaticamente."
          right={
            <Button
              variant="primary"
              onClick={() => {
                if (agents.length === 0) {
                  toast.error("Crie um agente primeiro para conectar um canal.");
                  return;
                }
                setShowPicker(true);
              }}
            >
              <Plus className="w-4 h-4" /> Conectar canal
            </Button>
          }
        />

        {showProvision && (
          <Row>
            <div className="p-6 space-y-4 max-w-[560px]">
              <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${FC.ink}`}>Conectar WhatsApp (Baileys)</h3>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Vincular ao agente</span>
                <Select
                  value={selectedAgent}
                  onChange={(v) => setSelectedAgent(v)}
                  options={agents.map((a) => ({ value: a.id, label: a.nome }))}
                  placeholder="Escolha um agente"
                />
              </label>
              <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
                Cria uma instância isolada do WhatsApp pra esse agente. Você vai escanear um QR code com seu celular pra parear.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowProvision(false)}>Cancelar</Button>
                <Button variant="primary" onClick={provisionWhatsApp} disabled={provisioning}>{provisioning ? "Criando..." : "Criar e conectar"}</Button>
              </div>
            </div>
          </Row>
        )}

        {showSlack && (
          <Row>
            <div className="p-6 space-y-4 max-w-[620px]">
              <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${FC.ink}`}>Conectar Slack</h3>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Vincular ao agente</span>
                <Select value={selectedAgent} onChange={(v) => setSelectedAgent(v)} options={agents.map((a) => ({ value: a.id, label: a.nome }))} placeholder="Escolha um agente" />
              </label>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Bot Token</span>
                <input type="password" value={slackForm.bot_token} onChange={(e) => setSlackForm({ ...slackForm, bot_token: e.target.value })} placeholder="xoxb-..." className={`${inputCls} font-mono`} />
              </label>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Signing Secret <span className="text-red-500">*</span></span>
                <input type="password" value={slackForm.signing_secret} onChange={(e) => setSlackForm({ ...slackForm, signing_secret: e.target.value })} placeholder="signing secret do Slack App" className={`${inputCls} font-mono`} />
              </label>
              <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
                Em <b>api.slack.com/apps</b> crie um app, adicione os <b>Bot Token Scopes</b> (chat:write, im:history, channels:history), instale no workspace e copie o <b>Bot User OAuth Token</b> (xoxb-) + o <b>Signing Secret</b>.
              </p>
              {slackWebhook ? (
                <div className={`rounded-[10px] border ${FC.hair} p-3.5 bg-[#0a8f5a]/[0.04]`}>
                  <p className={`text-[13px] font-medium ${FC.ink}`}>Conectado ✓ — último passo</p>
                  <p className={`text-[12px] mt-1 ${FC.sub}`}>No Slack App → <b>Event Subscriptions</b> → ative, cole este <b>Request URL</b> e assine <b>message.channels</b> + <b>message.im</b>:</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className={`flex-1 text-[11.5px] font-mono break-all px-2 py-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] ${FC.ink}`}>{slackWebhook}</code>
                    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(slackWebhook); toast.success("Copiado"); }}>Copiar</Button>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button variant="primary" onClick={() => { setShowSlack(false); setSlackWebhook(null); }}>Concluir</Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowSlack(false)}>Cancelar</Button>
                  <Button variant="primary" onClick={connectSlack} disabled={slackConnecting}>{slackConnecting ? "Validando..." : "Conectar"}</Button>
                </div>
              )}
            </div>
          </Row>
        )}

        {showDiscord && (
          <Row>
            <div className="p-6 space-y-4 max-w-[620px]">
              <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${FC.ink}`}>Conectar Discord</h3>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Vincular ao agente</span>
                <Select value={selectedAgent} onChange={(v) => setSelectedAgent(v)} options={agents.map((a) => ({ value: a.id, label: a.nome }))} placeholder="Escolha um agente" />
              </label>
              <label className="block">
                <span className={`text-[12px] block mb-1 ${FC.sub}`}>Bot Token</span>
                <input type="password" value={discordToken} onChange={(e) => setDiscordToken(e.target.value)} placeholder="token do bot" className={`${inputCls} font-mono`} />
              </label>
              <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
                Em <b>discord.com/developers/applications</b> crie um app → <b>Bot</b> → ative o <b>Message Content Intent</b> (obrigatório) e copie o <b>Bot Token</b>. O agente responde a DMs e, em canais de servidor, quando for <b>@mencionado</b>.
              </p>
              {discordResult ? (
                <div className={`rounded-[10px] border ${FC.hair} p-3.5 bg-[#5865F2]/[0.05]`}>
                  <p className={`text-[13px] font-medium ${FC.ink}`}>Conectado ✓{discordResult.bot_username ? ` — ${discordResult.bot_username}` : ""}</p>
                  <p className={`text-[12px] mt-1 ${FC.sub}`}>Último passo: adicione o bot ao seu servidor. Ele fica online em ~20s. Confirme que o <b>Message Content Intent</b> está ativado no portal.</p>
                  <div className="mt-3 flex justify-end gap-2">
                    {discordResult.invite_url && (
                      <a href={discordResult.invite_url} target="_blank" rel="noreferrer">
                        <Button variant="secondary">Adicionar bot ao servidor</Button>
                      </a>
                    )}
                    <Button variant="primary" onClick={() => { setShowDiscord(false); setDiscordResult(null); }}>Concluir</Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowDiscord(false)}>Cancelar</Button>
                  <Button variant="primary" onClick={connectDiscord} disabled={discordConnecting}>{discordConnecting ? "Validando..." : "Conectar"}</Button>
                </div>
              )}
            </div>
          </Row>
        )}

        <Row last>
          {loading ? (
            <div className={`divide-y ${FC.hair}`}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3.5 px-6 py-3.5">
                  <SkeletonBar className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <SkeletonBar className="h-3.5 w-32" />
                    <SkeletonBar className="h-3 w-44" />
                  </div>
                  <SkeletonBar className="h-3 w-20" />
                  <SkeletonBar className="h-7 w-24 rounded-md" />
                </div>
              ))}
            </div>
          ) : conns.length === 0 ? (
            agents.length === 0 ? (
              <EmptyHint icon={Bot} text="Crie um agente primeiro para conectar um canal." ctaLabel="Criar agente" ctaTo="/admin/agentes" className="py-16" />
            ) : (
              <EmptyHint icon={Smartphone} text='Nenhum canal conectado. Clique em "Conectar canal" para escolher WhatsApp, Slack ou Discord.' className="py-16" />
            )
          ) : (
            <div className={`divide-y ${FC.hair}`}>
              {conns.map((c) => {
                const status = c.config_summary?.status || "unknown";
                const meta = STATUS_META[status] || STATUS_META.unknown;
                const isCloud = c.kind === "whatsapp_cloud";
                const isWa = c.kind === "whatsapp" || c.kind === "whatsapp_cloud";
                const cm = CHANNEL_META[c.kind];
                const cs = (c.config_summary || {}) as unknown as Record<string, string | undefined>;
                const tipoLabel = c.config_summary?.tipo || channelType(c.kind);
                // Linha secundária: WhatsApp → telefone; demais → bot/workspace ou descrição.
                const secondary = isWa
                  ? formatPhone(cs.phone)
                  : cs.bot || cs.team || cm?.short || channelType(c.kind);
                return (
                  <div
                    key={c.id}
                    onClick={() => setDetail(c)}
                    className={`flex items-center gap-3.5 px-6 py-3.5 cursor-pointer ${FC.hover}`}
                    title="Ver detalhes do canal"
                  >
                    {/* Logo da marca do canal */}
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                      <ChannelLogo kind={c.kind} className="w-6 h-6" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[14px] font-medium truncate ${FC.ink}`}>{agentName(c.agent_id)}</span>
                        {isCloud ? (
                          <span className="shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-[#003083]/[0.08] text-[#003083] dark:text-[#5b9bff] uppercase tracking-wide">Oficial</span>
                        ) : (
                          <span className={`shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-[#262626]/[0.06] dark:bg-white/[0.08] uppercase tracking-wide ${FC.mut}`}>
                            {c.kind === "whatsapp" ? "Baileys" : cm?.name || c.kind}
                          </span>
                        )}
                      </div>
                      <div className={`flex items-center gap-2 mt-0.5 text-[13px] ${FC.sub}`}>
                        <span className="tabular-nums truncate">{secondary}</span>
                      </div>
                    </div>

                    {/* Status */}
                    <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 w-[180px]" title={meta.tip}>
                      <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                      <span className={`text-[13px] ${FC.sub}`}>{meta.label}</span>
                    </span>

                    {/* Ações */}
                    <div className="flex items-center justify-end gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {c.kind === "whatsapp" && status !== "connected" && (
                        <Button variant="primary" size="sm" onClick={() => openQR(c.id)} className="whitespace-nowrap">
                          <QrCode className="w-3 h-3 shrink-0" /> Escanear QR
                        </Button>
                      )}
                      {status === "connected" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          title="Desconectar"
                          className="whitespace-nowrap"
                          onClick={async () => {
                            if (!confirm(`Desconectar este canal (${tipoLabel})?`)) return;
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
                      <button onClick={() => onDelete(c.id)} className={`${iconBtn} hover:!text-[#E5484D] hover:!bg-[#E5484D]/[0.08]`} title="Remover canal permanentemente">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Row>
      </PageFrame>

      {/* Seletor de canais */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setShowPicker(false)}>
          <div className={`w-full max-w-[640px] max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0c0e12] shadow-2xl border ${FC.hair}`} onClick={(e) => e.stopPropagation()}>
            <div className={`flex items-center gap-3 border-b ${FC.hair} px-7 py-5`}>
              <div className="flex-1 min-w-0">
                <h2 className={`text-[16px] font-medium leading-tight ${FC.ink}`}>Conectar um canal</h2>
                <p className={`text-[12px] mt-0.5 ${FC.sub}`}>Escolha por onde o agente vai conversar</p>
              </div>
              <button onClick={() => setShowPicker(false)} className={iconBtn}><X className="h-4 w-4" /></button>
            </div>
            <div className="px-7 py-6 space-y-6">
              <label className="block">
                <span className={`text-[12px] block mb-1.5 ${FC.sub}`}>Vincular ao agente</span>
                <Select
                  value={selectedAgent}
                  onChange={(v) => setSelectedAgent(v)}
                  options={agents.map((a) => ({ value: a.id, label: a.nome }))}
                  placeholder="Escolha um agente"
                />
              </label>

              <div>
                <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2.5 ${FC.mut}`}>Disponíveis</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ConnectWhatsAppCloud
                    agentId={selectedAgent ?? 0}
                    onConnected={() => { setShowPicker(false); load(); }}
                    render={({ connect, loading }) => (
                      <ChannelCard
                        icon={CHANNEL_META.whatsapp_cloud.Icon}
                        name={CHANNEL_META.whatsapp_cloud.name}
                        desc={CHANNEL_META.whatsapp_cloud.short}
                        badge="Meta"
                        loading={loading}
                        onClick={() => {
                          if (!selectedAgent) { toast.error("Escolha um agente"); return; }
                          setShowPicker(false);
                          connect();
                        }}
                      />
                    )}
                  />
                  <ChannelCard
                    icon={CHANNEL_META.whatsapp.Icon}
                    name={CHANNEL_META.whatsapp.name}
                    desc={CHANNEL_META.whatsapp.short}
                    badge="QR"
                    onClick={() => pickChannel(() => setShowProvision(true))}
                  />
                  <ChannelCard
                    icon={CHANNEL_META.slack.Icon}
                    name={CHANNEL_META.slack.name}
                    desc={CHANNEL_META.slack.short}
                    onClick={() => pickChannel(() => { setSlackWebhook(null); setShowSlack(true); })}
                  />
                  <ChannelCard
                    icon={CHANNEL_META.discord.Icon}
                    name={CHANNEL_META.discord.name}
                    desc={CHANNEL_META.discord.short}
                    onClick={() => pickChannel(() => { setDiscordResult(null); setShowDiscord(true); })}
                  />
                </div>
              </div>

              <div>
                <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2.5 ${FC.mut}`}>Em breve</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ChannelCard icon={CHANNEL_META.telegram.Icon} name={CHANNEL_META.telegram.name} desc={CHANNEL_META.telegram.short} disabled />
                  <ChannelCard icon={CHANNEL_META.instagram.Icon} name={CHANNEL_META.instagram.name} desc={CHANNEL_META.instagram.short} disabled />
                  <ChannelCard icon={CHANNEL_META.email.Icon} name={CHANNEL_META.email.name} desc={CHANNEL_META.email.short} disabled />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Modal */}
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
                  <div className="flex h-9 w-9 items-center justify-center"><WhatsAppIcon className="h-7 w-7" /></div>
                  <div className="flex-1 min-w-0">
                    <h2 className={`text-[15px] font-medium leading-tight ${FC.ink}`}>Conectar WhatsApp</h2>
                    <p className={`text-[12px] ${FC.sub}`}>Pareie escaneando o código — leva segundos</p>
                  </div>
                  <button onClick={() => setQrModal(null)} className={iconBtn}><X className="h-4 w-4" /></button>
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
                          <span className={`ml-auto text-[11px] ${FC.sub}`}>atualiza sozinho</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`order-1 flex items-center justify-center border-b ${FC.hair} bg-[#F9F9F9] dark:bg-[#16191f] p-6 sm:order-2 sm:border-b-0 sm:border-l`}>
                    <div className="relative">
                      <div className={`relative rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#EDEDED]`}>
                        <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-tl-lg border-l-2 border-t-2 border-[#262626]/20 dark:border-white/20" />
                        <span className="pointer-events-none absolute right-1 top-1 h-4 w-4 rounded-tr-lg border-r-2 border-t-2 border-[#262626]/20 dark:border-white/20" />
                        <span className="pointer-events-none absolute bottom-1 left-1 h-4 w-4 rounded-bl-lg border-b-2 border-l-2 border-[#262626]/20 dark:border-white/20" />
                        <span className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 rounded-br-lg border-b-2 border-r-2 border-[#262626]/20 dark:border-white/20" />
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
                      <p className={`mt-3 text-center text-[11px] ${FC.sub}`}>O código se renova automaticamente</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Modal de detalhes do canal */}
      {detail &&
        (() => {
          const ag = agents.find((a) => a.id === detail.agent_id);
          const cs = detail.config_summary || {};
          const st = cs.status || "unknown";
          const m = STATUS_META[st] || STATUS_META.unknown;
          const isCloud = detail.kind === "whatsapp_cloud";
          const isWa = detail.kind === "whatsapp" || detail.kind === "whatsapp_cloud";
          const cmD = CHANNEL_META[detail.kind];
          const csx = cs as unknown as Record<string, string | undefined>;
          const comoFunciona = isCloud
            ? "Canal oficial via Meta Cloud API. Mensagens chegam pelo webhook da Meta e o agente responde com o token (System User). Não usa QR — conecta via Login Facebook (Embedded Signup)."
            : detail.kind === "whatsapp"
            ? "Canal via Baileys (WhatsApp Web). Pareado por QR Code; o número fica vinculado como um aparelho. Passa pelo Tier Engine (whats.tier.finance)."
            : detail.kind === "slack"
            ? "Canal Slack via Events API. As mensagens chegam por webhook autenticado (HMAC) e o agente responde com o Bot Token no seu workspace."
            : detail.kind === "discord"
            ? "Canal Discord via Gateway (websocket). O bot responde a DMs e, em canais de servidor, quando é @mencionado. Requer o Message Content Intent ativo no portal."
            : "Canal conectado ao agente.";
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDetail(null)}>
              <div className={`w-full max-w-[560px] overflow-hidden rounded-2xl bg-white dark:bg-[#0c0e12] shadow-2xl border ${FC.hair}`} onClick={(e) => e.stopPropagation()}>
                <div className={`flex items-center gap-3 border-b ${FC.hair} px-6 py-4`}>
                  <div className="flex h-9 w-9 items-center justify-center"><ChannelLogo kind={detail.kind} className="h-7 w-7" /></div>
                  <div className="flex-1 min-w-0">
                    <h2 className={`text-[15px] font-medium leading-tight truncate ${FC.ink}`}>{ag?.nome || `Agente #${detail.agent_id}`}</h2>
                    <p className={`text-[12px] ${FC.sub}`}>{cs.tipo || channelType(detail.kind)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 mr-1" title={m.tip}>
                    <span className={`w-2 h-2 rounded-full ${m.color}`} /><span className={`text-[12px] ${FC.sub}`}>{m.label}</span>
                  </span>
                  <button onClick={() => setDetail(null)} className={iconBtn}><X className="h-4 w-4" /></button>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {/* Conexão */}
                  <div>
                    <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2 ${FC.ink}`}>Conexão</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                      <div>
                        <div className={`text-[11px] ${FC.sub}`}>{isWa ? "Telefone" : "Conta"}</div>
                        <div className={`tabular-nums ${FC.ink}`}>{isWa ? formatPhone(cs.phone) : csx.bot || csx.team || "—"}</div>
                      </div>
                      <div>
                        <div className={`text-[11px] ${FC.sub}`}>Tipo</div>
                        <div className="flex items-center gap-1.5">
                          <span className={FC.ink}>{isWa ? (isCloud ? "Oficial" : "Não-oficial") : cmD?.name || detail.kind}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isCloud ? "bg-[#003083]/[0.08] text-[#003083]" : "bg-[#262626]/[0.06] " + FC.mut}`}>{isWa ? (isCloud ? "Meta Cloud API" : "Baileys") : cs.transporte || "Bot"}</span>
                        </div>
                      </div>
                      <div>
                        <div className={`text-[11px] ${FC.sub}`}>Status</div>
                        <div className="inline-flex items-center gap-1.5" title={m.tip}><span className={`w-2 h-2 rounded-full ${m.color}`} /><span className={FC.ink}>{m.label}</span></div>
                      </div>
                      <div><div className={`text-[11px] ${FC.sub}`}>Último evento</div><div className={`tabular-nums ${FC.ink}`}>{detail.last_event_at ? new Date(detail.last_event_at).toLocaleString("pt-BR") : "—"}</div></div>
                    </div>
                  </div>

                  {/* Técnico */}
                  <div>
                    <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2 ${FC.ink}`}>Detalhes técnicos</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                      <div className="col-span-2"><div className={`text-[11px] ${FC.sub}`}>Transporte</div><div className={FC.sub}>{cs.transporte || channelType(detail.kind)}</div></div>
                      {cs.host && <CodeField label="Host" value={cs.host} />}
                      {cs.pareamento && <div><div className={`text-[11px] ${FC.sub}`}>Pareamento</div><div className={`text-[12px] ${FC.sub}`}>{cs.pareamento}</div></div>}
                      {isCloud ? (
                        <>
                          <CodeField label="Phone Number ID" value={cs.phone_number_id || "—"} />
                          <CodeField label="WABA ID" value={cs.waba_id || "—"} />
                          <div><div className={`text-[11px] ${FC.sub}`}>Token</div><div className={FC.sub}>{cs.tem_token ? "✓ configurado" : "—"}</div></div>
                          {cs.janela && <div className="col-span-2"><div className={`text-[11px] ${FC.sub}`}>Janela de mensagem</div><div className={`text-[12px] ${FC.sub}`}>{cs.janela}</div></div>}
                        </>
                      ) : detail.kind === "whatsapp" ? (
                        <CodeField label="Instância (Engine)" value={cs.instance_id || "—"} full />
                      ) : null}
                      {cs.webhook && <CodeField label="Webhook de entrada" value={cs.webhook} full />}
                    </div>
                  </div>

                  {/* Vínculo + como funciona */}
                  <div>
                    <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2 ${FC.ink}`}>Agente vinculado</div>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className={FC.ink}>{ag?.nome || `Agente #${detail.agent_id}`}</span>
                      <a href="/admin/agentes" className="text-[12px] text-[#003083] hover:underline">Ver / editar instruções →</a>
                    </div>
                    <p className={`text-[12px] leading-snug mt-2 ${FC.sub}`}>{comoFunciona}</p>
                  </div>
                </div>
                <div className={`flex items-center justify-end gap-2 border-t ${FC.hair} px-6 py-4`}>
                  {detail.kind === "whatsapp" && st !== "connected" && (
                    <Button variant="primary" size="sm" onClick={() => { setDetail(null); openQR(detail.id); }}><QrCode className="w-3 h-3" /> Escanear QR</Button>
                  )}
                  {st === "connected" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        if (!confirm("Desconectar este canal?")) return;
                        try {
                          await api.post(`/connectors/${detail.id}/disconnect`);
                          toast.success("Desconectado");
                          setDetail(null);
                          load();
                        } catch {
                          toast.error("Erro ao desconectar");
                        }
                      }}
                    >
                      <Unplug className="w-3 h-3" /> Desconectar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

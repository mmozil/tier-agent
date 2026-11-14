import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { FC, PRIMARY_SHADOW } from "@/components/ds/fc";
import { WhatsAppIcon } from "@/components/icons/channelIcons";

/**
 * Ligações pelo WhatsApp oficial (14/11/2026) — a família liga e a equipe atende pelo navegador.
 *
 * O painel sonda `/ligacoes/ativas` (o servidor diz o intervalo no corpo: 3 s com o recurso ligado na
 * conta, 60 s sem). Tocando → cartão com «Atender» e «Recusar». Atender monta a conexão de voz (WebRTC)
 * com a OFERTA que a Meta mandou, envia a RESPOSTA ao servidor (pre_accept + accept na Meta) e só
 * então abre o microfone — a Meta pede que a voz da empresa não saia antes do «accept».
 *
 * GRAVAÇÃO: o servidor diz quem grava. Padrão = o NAVEGADOR, SEM aviso falado (decisão do dono, 14/11:
 * a voz da Meta saiu). Grava em ESTÉREO — esquerda = família, direita = atendente — e ao desligar sobe o
 * arquivo; o servidor guarda, põe na conversa e manda ao CRM (histórico do card + «Ligações QA»).
 * Conta com `ligacoes_gravacao_meta` = 1: a Meta grava (com a voz dela) e aqui não se grava nada.
 */

type Chamada = {
  ctx: AudioContext;
  micGain: GainNode;
  merger: ChannelMergerNode;
  gravador: MediaRecorder | null;
  pedacos: Blob[];
  remotoLigado: boolean;
};

type Ligacao = {
  id: number;
  conversation_id?: number | null;
  contato?: string | null;
  contato_nome?: string | null;
  estado: "tocando" | "atendendo" | "em_curso" | string;
  direcao: string;
  criada_em: string;
  atendida_em?: string | null;
  atendida_por?: string | null;
  minha: boolean;
  sdp_oferta?: string | null;
};

type EmCurso = { id: number; nome: string; numero: string; desde: number };

// Spring canônico do Animate UI (o mesmo do AdminLayout).
const SPRING = { type: "spring", stiffness: 350, damping: 35 } as const;

const PACOTE = (
  Array.from(document.scripts)
    .map((x) => x.src)
    .find((x) => /\/assets\/index-[^/]+\.js/.test(x)) || "dev"
)
  .split("/")
  .pop();

/** Passo a passo da gravação para o log do servidor (não atrapalha nada se falhar). */
function diag(id: number, etapa: string, detalhe = "") {
  api.post(`/ligacoes/${id}/diag`, { etapa, detalhe: `${detalhe} · ${PACOTE}`.slice(0, 400) }).catch(() => {});
}

function formatarNumero(n?: string | null): string {
  const d = (n || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return n || "";
}

function iniciais(nome: string): string {
  const p = nome.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function tempo(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Espera a coleta de candidatos terminar (a Meta não aceita candidatos depois — a resposta vai inteira). */
function esperarIce(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((ok) => {
    const fim = () => {
      pc.removeEventListener("icegatheringstatechange", aoMudar);
      ok();
    };
    const aoMudar = () => {
      if (pc.iceGatheringState === "complete") fim();
    };
    pc.addEventListener("icegatheringstatechange", aoMudar);
    setTimeout(fim, ms);
  });
}

/** Toque curto (dois bipes) gerado no navegador — sem arquivo de som. */
function tocarBipe(ctx: AudioContext) {
  const agora = ctx.currentTime;
  for (const ini of [0, 0.25]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, agora + ini);
    g.gain.exponentialRampToValueAtTime(0.08, agora + ini + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, agora + ini + 0.18);
    osc.connect(g).connect(ctx.destination);
    osc.start(agora + ini);
    osc.stop(agora + ini + 0.2);
  }
}

// Botões no padrão do painel (animate-ui): 32 px, raio 10, texto 12 médio.
const BTN = "h-8 px-3 flex-1 rounded-[10px] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] outline-none focus-visible:ring-[3px] focus-visible:ring-[#003083]/30 disabled:opacity-50 disabled:pointer-events-none";
const BTN_CONTORNO = `${BTN} border ${FC.hair} bg-white dark:bg-[#14171c] ${FC.ink} hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`;
const BTN_PRIMARIO = `${BTN} text-white bg-[#003083] hover:bg-[#002a73] dark:bg-[#5b9bff] dark:text-[#0c0e12] dark:hover:bg-[#7eb0ff] ${PRIMARY_SHADOW}`;
const BTN_PERIGO = `${BTN} text-white bg-[#e5484d] hover:bg-[#d93d42]`;

export default function LigacoesWhatsApp() {
  const [tocando, setTocando] = useState<Ligacao | null>(null);
  const [emCurso, setEmCurso] = useState<EmCurso | null>(null);
  const [atendendo, setAtendendo] = useState(false);
  const [mudo, setMudo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const somRef = useRef<AudioContext | null>(null);
  const emCursoRef = useRef<EmCurso | null>(null);
  const recusadasRef = useRef<Set<number>>(new Set());
  const chamadaRef = useRef<Chamada | null>(null);
  const mudoRef = useRef(false);
  emCursoRef.current = emCurso;
  mudoRef.current = mudo;

  const subirGravacao = useCallback(async (ligacaoId: number, pedacos: Blob[], mime: string) => {
    const blob = new Blob(pedacos, { type: mime || "audio/webm" });
    diag(ligacaoId, "parou", `pedacos=${pedacos.length} bytes=${blob.size}`);
    if (blob.size < 2000) return; // nada útil gravado
    const fd = new FormData();
    fd.append("arquivo", blob, `ligacao-${ligacaoId}.webm`);
    try {
      await api.post(`/ligacoes/${ligacaoId}/gravacao`, fd);
      toast.success("Gravação salva — vai para o CRM");
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      diag(ligacaoId, "envio_falhou", `${e?.response?.status || ""} ${typeof d === "string" ? d : e?.message || ""}`);
      toast.error(typeof d === "string" ? d : "Não consegui salvar a gravação");
    }
  }, []);

  const limpar = useCallback(() => {
    const ch = chamadaRef.current;
    const atual = emCursoRef.current;
    chamadaRef.current = null;
    if (atual) {
      diag(atual.id, "encerrando", `chamada=${!!ch} gravador=${ch?.gravador?.state || "nenhum"} pedacos=${ch?.pedacos.length ?? 0}`);
    }
    if (ch?.gravador && ch.gravador.state !== "inactive" && atual) {
      const g = ch.gravador;
      const id = atual.id;
      g.onstop = () => {
        subirGravacao(id, ch.pedacos, g.mimeType);
        ch.ctx.close().catch(() => {});
      };
      g.stop();
    } else {
      ch?.ctx.close().catch(() => {});
    }
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setEmCurso(null);
    setMudo(false);
    setGravando(false);
  }, [subirGravacao]);

  // Sondagem — o servidor dita o intervalo.
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;
    const rodar = async () => {
      let proxima = 15000;
      try {
        const r = await api.get<{ intervalo_s: number; ligacoes: Ligacao[] }>("/ligacoes/ativas");
        const seg = Number(r.data?.intervalo_s) || 15;
        proxima = (document.visibilityState === "visible" ? seg : Math.max(seg, 10)) * 1000;
        const lista = r.data?.ligacoes || [];
        const toca = lista.find((l) => l.estado === "tocando" && !recusadasRef.current.has(l.id)) || null;
        // Mesmo id: mantém o objeto (o toque não recomeça a cada sondagem).
        if (vivo) setTocando((antes) => (antes && toca && antes.id === toca.id ? antes : toca));
        const atual = emCursoRef.current;
        if (atual && !lista.some((l) => l.id === atual.id)) {
          // A família desligou (ou a Meta encerrou): fecha a voz deste lado.
          limpar();
          toast("Ligação encerrada");
        }
      } catch {
        proxima = 30000; // sem sessão / servidor fora: não insiste
      }
      if (vivo) timer = setTimeout(rodar, proxima);
    };
    rodar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [limpar]);

  // Toque enquanto houver ligação tocando e ninguém deste navegador atendendo.
  const tocandoId = tocando?.id;
  const temEmCurso = !!emCurso;
  useEffect(() => {
    if (!tocandoId || atendendo || temEmCurso) return;
    let ctx = somRef.current;
    try {
      if (!ctx) {
        ctx = new AudioContext();
        somRef.current = ctx;
      }
      ctx.resume().catch(() => {});
      tocarBipe(ctx);
    } catch {
      return;
    }
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && somRef.current) tocarBipe(somRef.current);
    }, 2000);
    return () => clearInterval(t);
  }, [tocandoId, atendendo, temEmCurso]);

  // A atualização automática do painel nunca recarrega com ligação tocando ou em andamento.
  useEffect(() => {
    (window as any).__tierLigacaoAtiva = !!(tocando || emCurso || atendendo);
  }, [tocando, emCurso, atendendo]);

  // Relógio da ligação.
  useEffect(() => {
    if (!emCurso) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [emCurso]);

  // Fechar a aba no meio da ligação: pede confirmação (a voz cai junto com a aba).
  useEffect(() => {
    if (!emCurso) return;
    const sair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", sair);
    return () => window.removeEventListener("beforeunload", sair);
  }, [emCurso]);

  const nomeDe = (l: Ligacao) => l.contato_nome || formatarNumero(l.contato) || "Contato";

  const atender = async () => {
    const l = tocando;
    if (!l?.sdp_oferta || atendendo) return;
    setAtendendo(true);
    let mic: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let ch: Chamada | null = null;
    try {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        toast.error("Libere o microfone do navegador para atender");
        return;
      }
      // Grafo de áudio: microfone (com porta) → vai para a ligação e para o canal DIREITO da gravação;
      // a voz da família → canal ESQUERDO.
      const ctx = new AudioContext();
      const micGain = ctx.createGain();
      micGain.gain.value = 0; // fechado até o «accept»
      ctx.createMediaStreamSource(mic).connect(micGain);
      const paraLigacao = ctx.createMediaStreamDestination();
      micGain.connect(paraLigacao);
      const merger = ctx.createChannelMerger(2);
      micGain.connect(merger, 0, 1);
      ch = { ctx, micGain, merger, gravador: null, pedacos: [], remotoLigado: false };
      const chAtual = ch;

      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const trilha = paraLigacao.stream.getAudioTracks()[0];
      trilha.enabled = false; // só fala depois do «accept» da Meta
      pc.addTrack(trilha, paraLigacao.stream);
      pc.ontrack = (e) => {
        const remoto = e.streams[0] || new MediaStream([e.track]);
        if (audioRef.current) {
          // O Chrome só entrega o áudio remoto ao grafo se ele também tocar num <audio>.
          audioRef.current.srcObject = remoto;
          audioRef.current.play().catch(() => {});
        }
        if (!chAtual.remotoLigado) {
          chAtual.remotoLigado = true;
          ctx.createMediaStreamSource(remoto).connect(merger, 0, 0);
        }
      };
      // A conexão é lida pela constante — a variável `pc` é zerada ao fim do atender.
      const conexao = pc;
      conexao.onconnectionstatechange = () => {
        const st = conexao.connectionState;
        if (st === "failed" || st === "closed") {
          const atual = emCursoRef.current;
          if (atual && pcRef.current === conexao) {
            diag(atual.id, "conexao", st);
            api.post(`/ligacoes/${atual.id}/encerrar`).catch(() => {});
            limpar();
            if (st === "failed") toast.error("A conexão de voz caiu");
          }
        }
      };
      await pc.setRemoteDescription({ type: "offer", sdp: l.sdp_oferta });
      const resposta = await pc.createAnswer();
      await pc.setLocalDescription(resposta);
      await esperarIce(pc, 2500);
      const sdp = pc.localDescription?.sdp || resposta.sdp || "";
      const { data: resp } = await api.post<{ ok: boolean; gravacao?: string }>(`/ligacoes/${l.id}/atender`, {
        sdp,
      });
      trilha.enabled = true;
      await ctx.resume().catch(() => {});
      pcRef.current = pc;
      micRef.current = mic;
      chamadaRef.current = ch;
      setEmCurso({ id: l.id, nome: nomeDe(l), numero: formatarNumero(l.contato), desde: Date.now() });
      setTocando(null);
      micGain.gain.value = mudoRef.current ? 0 : 1;

      if (resp?.gravacao === "meta") {
        // A Meta grava (com a voz de aviso dela): aqui não se grava nada.
        diag(l.id, "atendida", "gravacao=meta");
      } else {
        const destino = ctx.createMediaStreamDestination();
        merger.connect(destino);
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const g = new MediaRecorder(destino.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
        g.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) chAtual.pedacos.push(ev.data);
        };
        g.start(1000);
        chAtual.gravador = g;
        diag(l.id, "gravando", `navegador mime=${mime} ctx=${ctx.state}`);
      }
      setGravando(true);
      pc = null;
      mic = null;
      ch = null;
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui atender a ligação");
    } finally {
      // Deu errado no meio: nada fica aberto.
      pc?.close();
      mic?.getTracks().forEach((t) => t.stop());
      ch?.ctx.close().catch(() => {});
      setAtendendo(false);
    }
  };

  const recusar = async () => {
    const l = tocando;
    if (!l) return;
    recusadasRef.current.add(l.id);
    setTocando(null);
    try {
      await api.post(`/ligacoes/${l.id}/recusar`);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui recusar");
    }
  };

  const desligar = async () => {
    const atual = emCurso;
    limpar();
    if (atual) await api.post(`/ligacoes/${atual.id}/encerrar`).catch(() => {});
  };

  const alternarMudo = () => {
    const novo = !mudo;
    if (chamadaRef.current) chamadaRef.current.micGain.gain.value = novo ? 0 : 1;
    setMudo(novo);
  };

  const pessoa = emCurso
    ? { nome: emCurso.nome, numero: emCurso.numero }
    : tocando
      ? { nome: nomeDe(tocando), numero: tocando.contato_nome ? formatarNumero(tocando.contato) : "" }
      : null;

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      <AnimatePresence>
        {pessoa && (
          <motion.div
            key={emCurso ? `em-${emCurso.id}` : `toca-${tocando?.id}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={SPRING}
            role={emCurso ? "status" : "alertdialog"}
            aria-label={emCurso ? "Ligação em andamento" : "Ligação recebida no WhatsApp"}
            className={`fixed right-5 bottom-5 z-[80] w-[340px] rounded-2xl border ${FC.hair} bg-white dark:bg-[#14171c] shadow-[0_12px_32px_rgba(0,0,0,0.12)] p-4`}
          >
            <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] ${FC.mut}`}>
              <WhatsAppIcon className="w-3.5 h-3.5" />
              {emCurso ? "Em ligação" : "Ligação no WhatsApp"}
              {emCurso && gravando && (
                <span className="ml-auto inline-flex items-center gap-1.5 normal-case tracking-normal text-[#e5484d]">
                  <span className="relative inline-flex w-1.5 h-1.5">
                    <span className="absolute inset-0 rounded-full bg-[#e5484d] animate-ping opacity-60 motion-reduce:animate-none" />
                    <span className="relative w-1.5 h-1.5 rounded-full bg-[#e5484d]" />
                  </span>
                  Gravando
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <span className="relative shrink-0">
                {!emCurso && (
                  <span className="absolute -inset-1 rounded-full bg-[#003083]/15 dark:bg-[#5b9bff]/20 animate-ping motion-reduce:animate-none" />
                )}
                <span
                  className={`relative w-10 h-10 rounded-full inline-flex items-center justify-center text-[13px] font-medium bg-[#262626]/[0.06] dark:bg-white/[0.08] ${FC.ink}`}
                >
                  {iniciais(pessoa.nome) || <Phone className="w-4 h-4" />}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-medium truncate ${FC.ink}`}>{pessoa.nome}</div>
                <div className={`text-[12px] tabular-nums ${FC.sub}`}>
                  {emCurso
                    ? `${tempo(Math.max(0, Math.floor((agora - emCurso.desde) / 1000)))}${mudo ? " · mudo" : ""}`
                    : pessoa.numero || "Tocando…"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {emCurso ? (
                <>
                  <button type="button" onClick={alternarMudo} className={BTN_CONTORNO}>
                    {mudo ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    {mudo ? "Ativar som" : "Mudo"}
                  </button>
                  <button type="button" onClick={desligar} className={BTN_PERIGO}>
                    <PhoneOff className="w-3.5 h-3.5" /> Desligar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={recusar} disabled={atendendo} className={`${BTN_CONTORNO} !text-[#e5484d]`}>
                    <PhoneOff className="w-3.5 h-3.5" /> Recusar
                  </button>
                  <button type="button" onClick={atender} disabled={atendendo} className={BTN_PRIMARIO}>
                    <Phone className="w-3.5 h-3.5" /> {atendendo ? "Conectando…" : "Atender"}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

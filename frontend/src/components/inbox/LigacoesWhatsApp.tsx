import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";

/**
 * Ligações pelo WhatsApp oficial (14/11/2026) — a família liga e a equipe atende pelo navegador.
 *
 * O painel sonda `/ligacoes/ativas` (o servidor diz o intervalo no corpo: 3 s com o recurso ligado na
 * conta, 60 s sem — cabeçalho próprio não passaria pelo CORS). Tocando → cartão com «Atender» e «Recusar». Atender monta a conexão de voz (WebRTC)
 * com a OFERTA que a Meta mandou, envia a RESPOSTA ao servidor (pre_accept + accept na Meta) e só
 * então abre o microfone — a Meta pede que a voz da empresa não saia antes do «accept».
 *
 * GRAVAÇÃO (14/11/2026, sem Meta): ao atender toca um AVISO («esta ligação será gravada…») para as
 * duas pontas e só depois abre o microfone. O navegador grava em ESTÉREO — esquerda = família,
 * direita = atendente (com o aviso) — e ao desligar sobe o arquivo; o servidor guarda e manda para a
 * página «Ligações QA» do CRM (transcrição + nota pelo roteiro).
 * Sem o aviso carregado, NÃO grava: gravar sem avisar não é opção.
 */

const AVISO_URL = "/aviso-gravacao-ligacao-1.mp3";

type Chamada = {
  ctx: AudioContext;
  micGain: GainNode;
  saida: GainNode;
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

type EmCurso = { id: number; nome: string; desde: number };

function formatarNumero(n?: string | null): string {
  const d = (n || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return n || "";
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

export default function LigacoesWhatsApp() {
  const [tocando, setTocando] = useState<Ligacao | null>(null);
  const [emCurso, setEmCurso] = useState<EmCurso | null>(null);
  const [atendendo, setAtendendo] = useState(false);
  const [mudo, setMudo] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const somRef = useRef<AudioContext | null>(null);
  const emCursoRef = useRef<EmCurso | null>(null);
  const recusadasRef = useRef<Set<number>>(new Set());
  const chamadaRef = useRef<Chamada | null>(null);
  const avisoRef = useRef<ArrayBuffer | null>(null);
  const mudoRef = useRef(false);
  emCursoRef.current = emCurso;
  mudoRef.current = mudo;

  // O aviso vem antes: baixado uma vez, decodificado a cada ligação.
  useEffect(() => {
    fetch(AVISO_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => {
        avisoRef.current = b;
      })
      .catch(() => {});
  }, []);

  const subirGravacao = useCallback(async (ligacaoId: number, pedacos: Blob[], mime: string) => {
    const blob = new Blob(pedacos, { type: mime || "audio/webm" });
    if (blob.size < 2000) return; // nada útil gravado
    const fd = new FormData();
    fd.append("arquivo", blob, `ligacao-${ligacaoId}.webm`);
    try {
      await api.post(`/ligacoes/${ligacaoId}/gravacao`, fd);
      toast.success("Gravação salva — vai para Ligações QA");
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui salvar a gravação");
    }
  }, []);

  const limpar = useCallback(() => {
    const ch = chamadaRef.current;
    const atual = emCursoRef.current;
    chamadaRef.current = null;
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
    setAvisando(false);
    setGravando(false);
  }, [subirGravacao]);

  // Sondagem — o servidor dita o intervalo pelo cabeçalho.
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
      // Grafo de áudio da ligação: microfone (com porta) + aviso → «saida» → vai para a ligação e para o
      // canal direito da gravação; a voz da família → canal esquerdo.
      const ctx = new AudioContext();
      const micGain = ctx.createGain();
      micGain.gain.value = 0; // fechado até o aviso terminar
      ctx.createMediaStreamSource(mic).connect(micGain);
      const saida = ctx.createGain();
      micGain.connect(saida);
      const paraLigacao = ctx.createMediaStreamDestination();
      saida.connect(paraLigacao);
      const merger = ctx.createChannelMerger(2);
      saida.connect(merger, 0, 1);
      ch = { ctx, micGain, saida, merger, gravador: null, pedacos: [], remotoLigado: false };
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
      pc.onconnectionstatechange = () => {
        if (pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
          const atual = emCursoRef.current;
          if (atual) {
            api.post(`/ligacoes/${atual.id}/encerrar`).catch(() => {});
            limpar();
            if (pc.connectionState === "failed") toast.error("A conexão de voz caiu");
          }
        }
      };
      await pc.setRemoteDescription({ type: "offer", sdp: l.sdp_oferta });
      const resposta = await pc.createAnswer();
      await pc.setLocalDescription(resposta);
      await esperarIce(pc, 2500);
      const sdp = pc.localDescription?.sdp || resposta.sdp || "";
      await api.post(`/ligacoes/${l.id}/atender`, { sdp });
      trilha.enabled = true;
      await ctx.resume().catch(() => {});
      pcRef.current = pc;
      micRef.current = mic;
      chamadaRef.current = ch;
      setEmCurso({ id: l.id, nome: nomeDe(l), desde: Date.now() });
      setTocando(null);

      // Aviso → só então grava e abre o microfone. Sem aviso: atende sem gravar.
      let aviso: AudioBuffer | null = null;
      try {
        aviso = avisoRef.current ? await ctx.decodeAudioData(avisoRef.current.slice(0)) : null;
      } catch {
        aviso = null;
      }
      const abrirMicrofone = () => {
        micGain.gain.value = mudoRef.current ? 0 : 1;
        setAvisando(false);
      };
      if (aviso) {
        const gravDestino = ctx.createMediaStreamDestination();
        merger.connect(gravDestino);
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const g = new MediaRecorder(gravDestino.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
        g.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) chAtual.pedacos.push(ev.data);
        };
        g.start(1000);
        chAtual.gravador = g;
        setGravando(true);
        const fonte = ctx.createBufferSource();
        fonte.buffer = aviso;
        fonte.connect(saida); // a família ouve e fica na gravação
        fonte.connect(ctx.destination); // o atendente ouve também
        setAvisando(true);
        fonte.onended = abrirMicrofone;
        fonte.start();
      } else {
        toast("Aviso de gravação indisponível — esta ligação não será gravada");
        abrirMicrofone();
      }
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
    // A porta é o ganho do microfone (a trilha que sai carrega também o aviso).
    if (chamadaRef.current && !avisando) chamadaRef.current.micGain.gain.value = novo ? 0 : 1;
    setMudo(novo);
  };

  const cartao =
    "fixed right-5 bottom-5 z-[80] w-[320px] rounded-2xl border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#14171c] shadow-[0_12px_32px_rgba(0,0,0,0.14)] p-4";

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      {emCurso ? (
        <div className={cartao} role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-[#25D366]/15 text-[#128C4B] dark:text-[#4ade80] inline-flex items-center justify-center">
              <Phone className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{emCurso.nome}</div>
              <div className="text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0]">
                Em ligação · {tempo(Math.max(0, Math.floor((agora - emCurso.desde) / 1000)))}
                {mudo ? " · mudo" : ""}
              </div>
              {(avisando || gravando) && (
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-[#e5484d]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#e5484d]" />
                  {avisando ? "Avisando que a ligação é gravada…" : "Gravando"}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={alternarMudo}
              className="flex-1 h-8 rounded-[10px] border border-[#EDEDED] dark:border-[#23272e] text-[13px] text-[#262626] dark:text-[#e6e8eb] inline-flex items-center justify-center gap-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            >
              {mudo ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />} {mudo ? "Ativar som" : "Mudo"}
            </button>
            <button
              type="button"
              onClick={desligar}
              className="flex-1 h-8 rounded-[10px] bg-[#e5484d] hover:bg-[#d93d42] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5"
            >
              <PhoneOff className="w-4 h-4" /> Desligar
            </button>
          </div>
        </div>
      ) : tocando ? (
        <div className={cartao} role="alertdialog" aria-label="Ligação recebida no WhatsApp">
          <div className="flex items-center gap-3">
            <span className="relative w-10 h-10 rounded-full bg-[#25D366]/15 text-[#128C4B] dark:text-[#4ade80] inline-flex items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-[#25D366]/25 animate-ping" />
              <Phone className="w-5 h-5 relative" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0]">Ligação no WhatsApp</div>
              <div className="text-[14px] font-medium text-[#262626] dark:text-[#e6e8eb] truncate">{nomeDe(tocando)}</div>
              {tocando.contato_nome && (
                <div className="text-[12px] text-[#262626]/40 dark:text-[#6b7280]">{formatarNumero(tocando.contato)}</div>
              )}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={recusar}
              disabled={atendendo}
              className="flex-1 h-8 rounded-[10px] border border-[#EDEDED] dark:border-[#23272e] text-[13px] text-[#e5484d] inline-flex items-center justify-center gap-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
            >
              <PhoneOff className="w-4 h-4" /> Recusar
            </button>
            <button
              type="button"
              onClick={atender}
              disabled={atendendo}
              className="flex-1 h-8 rounded-[10px] bg-[#128C4B] hover:bg-[#0f7a41] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Phone className="w-4 h-4" /> {atendendo ? "Conectando…" : "Atender"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

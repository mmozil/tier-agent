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
  respostaAplicada: boolean;
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

type EmCurso = {
  id: number;
  nome: string;
  numero: string;
  /** null enquanto «chamando» (a empresa ligou e o contato ainda não atendeu). */
  desde: number | null;
  fase: "chamando" | "em_curso";
  saida: boolean;
};

/** Quem chama: a conversa do Agent ou o telefone vindo do CRM. */
export type DestinoLigacao = { conversation_id?: number; telefone?: string; nome?: string };

/** Qualquer tela pede a ligação com `window.dispatchEvent(new CustomEvent("tier:ligar", { detail }))`. */
export function pedirLigacao(destino: DestinoLigacao) {
  window.dispatchEvent(new CustomEvent<DestinoLigacao>("tier:ligar", { detail: destino }));
}

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

function numeroComPais(tel?: string): string {
  const d = (tel || "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
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
  const ocupadoRef = useRef(false);
  // `?ligar=1&telefone=…&nome=…` — o «Ligar» do card no CRM/ERP chega aqui (Atendimento, dentro da moldura,
  // ou o Agent direto). A ligação só sai com UM clique: o navegador só libera o microfone depois de um gesto.
  const [prontoPara, setProntoPara] = useState<DestinoLigacao | null>(() => {
    const q = new URLSearchParams(window.location.search);
    const tel = (q.get("telefone") || "").replace(/\D/g, "");
    return q.get("ligar") === "1" && tel.length >= 10 ? { telefone: tel, nome: q.get("nome") || undefined } : null;
  });
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
        const toca =
          lista.find((l) => l.estado === "tocando" && l.direcao === "entrada" && !recusadasRef.current.has(l.id)) ||
          null;
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

  /** Grafo de áudio + conexão (os dois sentidos usam o mesmo): microfone (com porta) → vai para a ligação e
   *  para o canal DIREITO da gravação; a voz do contato → canal ESQUERDO. */
  const montarChamada = (mic: MediaStream) => {
    const ctx = new AudioContext();
    const micGain = ctx.createGain();
    micGain.gain.value = 0; // fechado até o contato estar na linha
    ctx.createMediaStreamSource(mic).connect(micGain);
    const paraLigacao = ctx.createMediaStreamDestination();
    micGain.connect(paraLigacao);
    const merger = ctx.createChannelMerger(2);
    micGain.connect(merger, 0, 1);
    const ch: Chamada = { ctx, micGain, merger, gravador: null, pedacos: [], remotoLigado: false, respostaAplicada: false };
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const trilha = paraLigacao.stream.getAudioTracks()[0];
    pc.addTrack(trilha, paraLigacao.stream);
    pc.ontrack = (e) => {
      const remoto = e.streams[0] || new MediaStream([e.track]);
      if (audioRef.current) {
        // O Chrome só entrega o áudio remoto ao grafo se ele também tocar num <audio>.
        audioRef.current.srcObject = remoto;
        audioRef.current.play().catch(() => {});
      }
      if (!ch.remotoLigado) {
        ch.remotoLigado = true;
        ctx.createMediaStreamSource(remoto).connect(merger, 0, 0);
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed") {
        const atual = emCursoRef.current;
        if (atual && pcRef.current === pc) {
          diag(atual.id, "conexao", st);
          api.post(`/ligacoes/${atual.id}/encerrar`).catch(() => {});
          limpar();
          if (st === "failed") toast.error("A conexão de voz caiu");
        }
      }
    };
    return { ch, pc, trilha };
  };

  const comecarGravacao = (ch: Chamada, id: number) => {
    const destino = ch.ctx.createMediaStreamDestination();
    ch.merger.connect(destino);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const g = new MediaRecorder(destino.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
    g.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) ch.pedacos.push(ev.data);
    };
    g.start(1000);
    ch.gravador = g;
    setGravando(true);
    diag(id, "gravando", `navegador mime=${mime} ctx=${ch.ctx.state}`);
  };

  const atender = async () => {
    const l = tocando;
    if (!l?.sdp_oferta || atendendo || emCursoRef.current) return;
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
      const montada = montarChamada(mic);
      ch = montada.ch;
      pc = montada.pc;
      const trilha = montada.trilha;
      trilha.enabled = false; // só fala depois do «accept» da Meta
      await pc.setRemoteDescription({ type: "offer", sdp: l.sdp_oferta });
      const resposta = await pc.createAnswer();
      await pc.setLocalDescription(resposta);
      await esperarIce(pc, 2500);
      const sdp = pc.localDescription?.sdp || resposta.sdp || "";
      const { data: resp } = await api.post<{ ok: boolean; gravacao?: string }>(`/ligacoes/${l.id}/atender`, {
        sdp,
      });
      trilha.enabled = true;
      await ch.ctx.resume().catch(() => {});
      pcRef.current = pc;
      micRef.current = mic;
      chamadaRef.current = ch;
      setEmCurso({
        id: l.id,
        nome: nomeDe(l),
        numero: formatarNumero(l.contato),
        desde: Date.now(),
        fase: "em_curso",
        saida: false,
      });
      setTocando(null);
      ch.micGain.gain.value = mudoRef.current ? 0 : 1;
      if (resp?.gravacao === "meta") {
        // A Meta grava (com a voz de aviso dela): aqui não se grava nada.
        diag(l.id, "atendida", "gravacao=meta");
        setGravando(true);
      } else {
        comecarGravacao(ch, l.id);
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

  /** A EMPRESA liga pelo WhatsApp (14/11/2026): oferta daqui, a Meta toca no celular do contato, a resposta
   *  chega pelo servidor (GET /ligacoes/{id}). */
  const ligarPara = useCallback(
    async (destino: DestinoLigacao) => {
      if (emCursoRef.current || ocupadoRef.current) {
        toast("Já existe uma ligação em andamento");
        return;
      }
      ocupadoRef.current = true;
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
          toast.error("Libere o microfone do navegador para ligar");
          return;
        }
        const montada = montarChamada(mic);
        ch = montada.ch;
        pc = montada.pc;
        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        await esperarIce(pc, 2500);
        const sdp = pc.localDescription?.sdp || oferta.sdp || "";
        const { data } = await api.post<{ id: number; nome?: string | null; numero: string }>("/ligacoes/ligar", {
          sdp,
          ...destino,
        });
        await ch.ctx.resume().catch(() => {});
        pcRef.current = pc;
        micRef.current = mic;
        chamadaRef.current = ch;
        setEmCurso({
          id: data.id,
          nome: data.nome || destino.nome || formatarNumero(data.numero),
          numero: formatarNumero(data.numero),
          desde: null,
          fase: "chamando",
          saida: true,
        });
        pc = null;
        mic = null;
        ch = null;
      } catch (e: any) {
        const d = e?.response?.data?.detail;
        if (typeof d === "string" && d.startsWith("sem_permissao")) {
          toast(
            (t) => (
              <span className="text-[13px]">
                O contato ainda não autorizou ligação pelo WhatsApp.{" "}
                <button
                  type="button"
                  className="underline font-medium"
                  onClick={async () => {
                    toast.dismiss(t.id);
                    try {
                      await api.post("/ligacoes/pedir-permissao", destino);
                      toast.success("Pedido de permissão enviado na conversa — quando ele aceitar, ligue de novo");
                    } catch (err: any) {
                      const m = err?.response?.data?.detail;
                      toast.error(typeof m === "string" ? m : "Não consegui pedir a permissão", { duration: 8000 });
                    }
                  }}
                >
                  Pedir permissão
                </button>
              </span>
            ),
            { duration: 12000 },
          );
        } else {
          toast.error(typeof d === "string" ? d : "Não consegui ligar", { duration: 8000 });
        }
      } finally {
        pc?.close();
        mic?.getTracks().forEach((t) => t.stop());
        ch?.ctx.close().catch(() => {});
        ocupadoRef.current = false;
        setAtendendo(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Pedido de ligação vindo de qualquer tela (botão «Ligar» da conversa, página /admin/ligar do CRM).
  useEffect(() => {
    const ouvir = (ev: Event) => ligarPara((ev as CustomEvent<DestinoLigacao>).detail || {});
    window.addEventListener("tier:ligar", ouvir);
    return () => window.removeEventListener("tier:ligar", ouvir);
  }, [ligarPara]);

  // Ligação que a EMPRESA fez: acompanha a resposta do contato e o estado.
  const saidaId = emCurso?.saida ? emCurso.id : null;
  useEffect(() => {
    if (!saidaId) return;
    let vivo = true;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get<{ estado: string; sdp_resposta?: string | null }>(`/ligacoes/${saidaId}`);
        if (!vivo) return;
        const ch = chamadaRef.current;
        if (data.sdp_resposta && ch && !ch.respostaAplicada && pcRef.current) {
          ch.respostaAplicada = true;
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: data.sdp_resposta }).catch((err) => {
            diag(saidaId, "resposta_falhou", String(err?.message || err));
          });
        }
        if (data.estado === "em_curso" && emCursoRef.current?.fase === "chamando" && ch) {
          ch.micGain.gain.value = mudoRef.current ? 0 : 1;
          comecarGravacao(ch, saidaId);
          setEmCurso((prev) => (prev ? { ...prev, fase: "em_curso", desde: Date.now() } : prev));
        }
        if (["encerrada", "perdida", "recusada", "falhou"].includes(data.estado)) {
          const antes = emCursoRef.current?.fase;
          limpar();
          if (antes === "chamando") {
            toast(data.estado === "recusada" ? "O contato recusou a ligação" : "O contato não atendeu");
          } else {
            toast("Ligação encerrada");
          }
        }
      } catch {
        /* segue tentando */
      }
    }, 1000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [saidaId, limpar]);

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
  const proposta = !pessoa && !atendendo ? prontoPara : null;

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      <AnimatePresence>
        {proposta && (
          <motion.div
            key="proposta"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={SPRING}
            role="dialog"
            aria-label="Ligar pelo WhatsApp"
            className={`fixed right-5 bottom-5 z-[80] w-[340px] rounded-2xl border ${FC.hair} bg-white dark:bg-[#14171c] shadow-[0_12px_32px_rgba(0,0,0,0.12)] p-4`}
          >
            <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] ${FC.mut}`}>
              <WhatsAppIcon className="w-3.5 h-3.5" /> Ligar pelo WhatsApp
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`w-10 h-10 rounded-full inline-flex items-center justify-center text-[13px] font-medium bg-[#262626]/[0.06] dark:bg-white/[0.08] ${FC.ink}`}
              >
                {iniciais(proposta.nome || "") || <Phone className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-medium truncate ${FC.ink}`}>
                  {proposta.nome || formatarNumero(numeroComPais(proposta.telefone))}
                </div>
                {proposta.nome && (
                  <div className={`text-[12px] tabular-nums ${FC.sub}`}>{formatarNumero(numeroComPais(proposta.telefone))}</div>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setProntoPara(null)} className={BTN_CONTORNO}>
                Agora não
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = proposta;
                  setProntoPara(null);
                  ligarPara(d);
                }}
                className={BTN_PRIMARIO}
              >
                <Phone className="w-3.5 h-3.5" /> Ligar
              </button>
            </div>
          </motion.div>
        )}
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
              {emCurso ? (emCurso.fase === "chamando" ? "Chamando pelo WhatsApp" : "Em ligação") : "Ligação no WhatsApp"}
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
                {(!emCurso || emCurso.fase === "chamando") && (
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
                    ? emCurso.desde === null
                      ? `Chamando… ${emCurso.numero}`
                      : `${tempo(Math.max(0, Math.floor((agora - emCurso.desde) / 1000)))}${mudo ? " · mudo" : ""}`
                    : pessoa.numero || "Tocando…"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {emCurso?.fase === "chamando" ? (
                <button type="button" onClick={desligar} className={BTN_PERIGO}>
                  <PhoneOff className="w-3.5 h-3.5" /> Desligar
                </button>
              ) : emCurso ? (
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

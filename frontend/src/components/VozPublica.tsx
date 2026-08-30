/**
 * Tela de voz do link público — a esfera de pó ocupando a tela, uma barra
 * embaixo e nada mais.
 *
 * O ciclo copia um agente de voz que funciona (ChatGPT Voice / CallOverlay):
 *
 *   DESLIGADA (mic 100% off — a página NASCE assim; 1 toque na esfera arma)
 *     → SENTINELA (só wake word "oi tier") → ESCUTANDO (VAD: 1,3s envia)
 *     → PENSANDO (mic OFF; filler só se >2,5s) → FALANDO (áudio INTOCÁVEL)
 *     → fim do áudio → ESCUTANDO de novo (follow-up ~20s, SEM wake word)
 *     → 20s sem fala → SENTINELA (segue ARMADA — o toque foi o consentimento).
 *
 * 🚨 Decisão do dono: entrar com o microfone ligado é gambiarra. O gesto de
 * armar é UM toque — e é ele que também destrava o autoplay do Chrome.
 *
 * Três regras duras, aprendidas a ferro:
 *
 * 1. **NENHUMA transição de estado aborta o áudio da resposta.** Só "Sair" ou
 *    uma nova pergunta explícita do usuário cortam a Dora no meio.
 *
 * 2. **O efeito do reconhecimento monta UMA vez.** Callbacks entram por ref
 *    (padrão latest-ref) — na versão anterior o `onEnviar` inline do pai
 *    remontava o efeito a cada resposta, o cleanup derrubava a escuta e a
 *    tela caía pra sentinela no meio da conversa (follow-up morto).
 *
 * 3. **Estado do mic SEMPRE visível.** Falha de permissão/start não pode ser
 *    silenciosa: vira o CTA "toque para ativar o microfone" na tela.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Importado como asset pra o Vite carimbar o hash do conteudo no nome. Em
// public/ o arquivo tinha nome fixo e o nginx serve .js com `immutable`: o
// navegador segurava a versao velha por 7 dias e purge de CDN nao resolvia.
import urlDoViz from "@/lib/optimus-viz.js?url";
// Falas curtas ja sintetizadas na voz da Dora. Tocam do disco, sem ida ao
// servidor.
import somAguarde from "@/assets/voz/aguarde.mp3";
import somPoisNao from "@/assets/voz/pois-nao.mp3";
// Wake word, invocação e validação de turno: lógica PURA, testada com
// transcripts simulados (sem microfone) — os casos-limite moram lá.
import { detectarChamada, falaValida } from "@/lib/voz-fala";

type Viz = {
  simulate: (b: boolean) => void;
  setLevel: (v: number) => void;
  mount: (host: string | HTMLElement, id: string) => { destroy?: () => void };
  attachMic: () => Promise<unknown>;
  attachAnalyser?: (a: AnalyserNode) => unknown;
  setMood?: (m: string) => void;
  list: () => unknown[];
};

declare global {
  interface Window {
    OptimusViz?: Viz;
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  }
}

/**
 * A fase é UMA só (não estado×escuta — o par independente criava corridas):
 *   desligada — mic fechado; o status vira CTA clicável
 *   sentinela — mic aberto esperando "oi {nome}" (wake word estrita)
 *   escutando — tudo que você fala vai pro agente (VAD fecha o turno)
 *   pensando  — turno enviado; mic OFF (sem eco)
 *   falando   — resposta tocando; mic OFF; áudio intocável
 */
type Fase = "desligada" | "sentinela" | "escutando" | "pensando" | "falando";

/* Quanto de silêncio o agente aguenta antes de avisar "só um momento".

   🚨 2500 era o PIOR valor possível, e era o que estava aqui.
   Medido em produção: o servidor devolve a resposta entre 2,0s e 3,1s. Ou seja,
   o aviso caía EXATAMENTE em cima da resposta — e como resposta não atropela
   filler (e não deve mesmo), ela ficava esperando o aviso terminar. O filler,
   que existe pra encurtar a espera, estava ALONGANDO ela em ~1,5s.
   Foi o que o dono descreveu: "ela fala ok, vou, aí trava, e começa a responder
   sem terminar de falar o que já começou".

   Em 1200 ele passou a tocar em TODA pergunta, e o dono foi direto: "em todas
   as perguntas ela fala 'só um minuto que já te respondo' e depois vem a
   resposta — esse UX ficou muito ruim". Ele tem razão, e o comentário logo
   abaixo já dizia o certo: **paraquedas, nunca protocolo**. Um aviso que sempre
   acontece não é aviso, é um passo a mais entre a pergunta e a resposta.

   Em 3500 ele volta a ser exceção: a resposta chega em 2,0–3,1s, então no turno
   normal ele NÃO toca. Só aparece quando algo de fato travou — que é quando
   ouvir "só um momento" ajuda em vez de atrapalhar. */
const PACIENCIA_MS = 3500;

// Fim de fala automático: este silêncio depois da última palavra fecha o turno
// e envia — SEM apertar nada. Curto demais corta pausa de respiração; longo
// demais vira "ele demora pra entender que terminei".
const VAD_SILENCIO_MS = 1300;
// ...mas quando o próprio navegador fecha a frase (`isFinal`) e ela tem corpo,
// esperar o silêncio inteiro é esperar por nada. Medido: corta ~0,85s por turno.
const VAD_APOS_FINAL_MS = 450;

// Depois da resposta, a escuta REABRE sozinha por esta janela (follow-up sem
// wake word — é o turn-taking do ChatGPT Voice). Sem fala, volta pra sentinela.
const FOLLOWUP_MS = 20000;

// Carrega a biblioteca uma vez só, mesmo com StrictMode remontando.
let promessaViz: Promise<Viz | null> | null = null;
function carregarViz(): Promise<Viz | null> {
  if (window.OptimusViz) return Promise.resolve(window.OptimusViz);
  if (promessaViz) return promessaViz;
  promessaViz = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = urlDoViz;
    s.async = true;
    s.onload = () => resolve(window.OptimusViz ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return promessaViz;
}

/**
 * Escolhe a MELHOR voz pt-BR do aparelho em vez da primeira da lista.
 * A primeira costuma ser a SAPI antiga do Windows, que soa robótica.
 */
function melhorVoz(): SpeechSynthesisVoice | null {
  const todas = speechSynthesis.getVoices().filter((v) => /pt[-_]BR/i.test(v.lang));
  if (!todas.length) return null;
  const nota = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 100;
    if (/online/.test(n)) s += 60;
    if (/google/.test(n)) s += 50;
    if (/luciana|francisca|thalita|brenda|antonio|ant[oô]nio/.test(n)) s += 30;
    if (!v.localService) s += 20;
    if (/microsoft (daniel|maria)\b/.test(n)) s -= 25;
    return s;
  };
  return [...todas].sort((a, b) => nota(b) - nota(a))[0] ?? null;
}

export default function VozPublica({
  agente,
  titulo,
  pensando,
  ultimaResposta,
  comecarEscutando = false,
  falaLimpa = null,
  onEnviar,
  onVerConversa,
}: {
  agente: string;
  titulo: string;
  pensando: boolean;
  /** `id` muda a cada resposta — duas iguais seguidas precisam falar de novo. */
  ultimaResposta: { texto: string; id: number; audioUrls?: string[] } | null;
  /** Chegou pelo BOTÃO (pedido explícito) e não por abrir o link. */
  comecarEscutando?: boolean;
  /** O que a pessoa disse, já pontuado pelo servidor. `id` muda a cada turno. */
  falaLimpa?: { texto: string; id: number } | null;
  onEnviar: (texto: string) => void;
  onVerConversa: () => void;
}) {
  const [fase, setFase] = useState<Fase>("desligada");
  const faseRef = useRef<Fase>("desligada");
  const [linha, setLinha] = useState<{ texto: string; cls: string }>({ texto: "", cls: "" });
  const [texto, setTexto] = useState("");
  const [micBloqueado, setMicBloqueado] = useState(false);
  const [precisaToque, setPrecisaToque] = useState(false);

  const vizRef = useRef<Viz | null>(null);
  const recRef = useRef<any>(null);
  const houveGesto = useRef(false);

  // Como as pessoas chamam de verdade: a PRIMEIRA palavra do nome ("oi tier").
  const nomeCurto = (agente.split(/\s+/)[0] || agente).toLowerCase();

  // ── latest-refs: o efeito do reconhecimento monta UMA vez e lê daqui ────
  const onEnviarRef = useRef(onEnviar);
  useEffect(() => {
    onEnviarRef.current = onEnviar;
  });
  const agenteRef = useRef(agente);
  useEffect(() => {
    agenteRef.current = agente;
  });

  // A lista de vozes carrega assincrona no Chrome: aquece pra melhorVoz() ter o
  // que ler quando o fallback do navegador for necessário.
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.getVoices();
    const aquece = () => speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", aquece);
    return () => speechSynthesis.removeEventListener("voiceschanged", aquece);
  }, []);

  // ── a esfera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let inst: { destroy?: () => void } | null = null;
    let vivo = true;
    carregarViz().then((v) => {
      if (!vivo || !v) return;
      vizRef.current = v;
      v.simulate(false);
      inst = v.mount("#esfera-voz", "po");
      v.setLevel(0);
    });
    return () => {
      vivo = false;
      inst?.destroy?.();
    };
  }, []);

  // ── envelope da esfera (fallback quando não há analyser) ──────────────
  const nivel = useRef(0);
  const alvo = useRef(0);
  const quadro = useRef(0);

  const pararEnvelope = useCallback(() => {
    cancelAnimationFrame(quadro.current);
    quadro.current = 0;
    nivel.current = 0;
    alvo.current = 0;
    vizRef.current?.setLevel(0);
  }, []);

  const rodarEnvelope = useCallback(() => {
    if (quadro.current) return;
    const passo = () => {
      const sobe = alvo.current > nivel.current;
      nivel.current += (alvo.current - nivel.current) * (sobe ? 0.5 : 0.09);
      alvo.current *= 0.9;
      vizRef.current?.setLevel(Math.max(0, Math.min(1, nivel.current)));
      quadro.current = requestAnimationFrame(passo);
    };
    passo();
  }, []);

  /** Muda a fase e ajusta a esfera. NUNCA toca no áudio em curso. */
  const ligarMicAnalyserRef = useRef<(() => Promise<void>) | null>(null);
  const mudarFase = useCallback(
    (f: Fase) => {
      faseRef.current = f;
      setFase(f);
      const v = vizRef.current;
      if (!v) return;
      // assinatura visual por estado (deriva/cintilação/contração/redemoinho)
      v.setMood?.(f === "desligada" ? "calma" : f);
      if (f === "pensando") {
        v.simulate(false);
        pararEnvelope();
        v.setLevel(0.3); // energia interna leve; contração+redemoinho vêm do humor
      } else if (f === "sentinela" || f === "escutando") {
        v.simulate(false);
        pararEnvelope();
        v.setLevel(0);
        // A voz de quem fala move a esfera — a menos que esta máquina já tenha
        // provado que não aguenta as duas capturas (ver `vigia`).
        if (!vigia.current.desistiu) {
          vigia.current.energiaDesde = 0;
          vigia.current.ouviuAlgo = Date.now();
          void ligarMicAnalyserRef.current?.();
        }
        // 🚨 NÃO abrir uma segunda captura do microfone aqui.
        //
        // O `getUserMedia` do analisador e o SpeechRecognition disputam o mesmo
        // microfone. No Windows o analisador ganha e o RECONHECIMENTO FICA SEM
        // ÁUDIO — sem erro, sem log. O sintoma é cruel: a esfera reage à voz
        // (o analisador tem o mic) e a pessoa jura que está sendo ouvida,
        // enquanto nenhuma palavra vira transcrição. Medido: dez "oi tier"
        // seguidos sem nenhuma reação.
        //
        // O próprio arquivo já avisava disso na função do analisador. Escutar é
        // a função da tela; ver a voz é enfeite. Quando os dois não cabem, quem
        // fica é a escuta.
        //
        // A esfera continua viva pelo envelope da resposta — que é o momento em
        // que ela realmente precisa se mexer.
      } else if (f !== "falando") {
        v.simulate(false);
        pararEnvelope();
        v.setLevel(0);
      }
    },
    [pararEnvelope],
  );

  // ── áudio da resposta (Dora) ──────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxAudio = useRef<AudioContext | null>(null);
  const fonte = useRef<MediaElementAudioSourceNode | null>(null);
  const anDora = useRef<AnalyserNode | null>(null);

  /**
   * Destrava o áudio DENTRO de gesto do usuário. Um AudioContext criado fora
   * de clique nasce `suspended` — e com createMediaElementSource isso é
   * SILÊNCIO TOTAL, não som baixo.
   */
  const destravarAudio = useCallback(async () => {
    try {
      const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      if (!ctxAudio.current) ctxAudio.current = new AC();
      if (ctxAudio.current.state === "suspended") await ctxAudio.current.resume();
    } catch {
      /* sem Web Audio: o áudio toca direto, só perde a onda na esfera */
    }
  }, []);

  // ── análise REAL da voz do usuário (mic → AnalyserNode) ───────────────
  // ⚠️ Gotcha conhecido: SpeechRecognition + getUserMedia = duas capturas
  // simultâneas já travaram a interface no Windows uma vez (viz.attachMic).
  // Por isso: UMA stream só, aberta uma vez, no MESMO AudioContext do
  // playback, e falha vira fallback silencioso — a escuta nunca depende disto.
  const micStream = useRef<MediaStream | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const ligarMicAnalyser = useCallback(async () => {
    try {
      await destravarAudio();
      const ac = ctxAudio.current;
      if (!ac || ac.state !== "running") return;
      if (!micAnalyser.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // a fase pode ter mudado enquanto o prompt de permissão estava aberto
        if (faseRef.current !== "sentinela" && faseRef.current !== "escutando") {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        micStream.current = stream;
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.6;
        src.connect(an); // NÃO liga no destination — sem eco no alto-falante
        micAnalyser.current = an;
      }
      vizRef.current?.attachAnalyser?.(micAnalyser.current);
    } catch {
      /* sem análise do mic: a esfera segue no envelope */
    }
  }, [destravarAudio]);
  useEffect(() => {
    ligarMicAnalyserRef.current = ligarMicAnalyser;
  });

  /* O VIGIA. Roda só enquanto a tela escuta.
     A pergunta que ele responde é uma só: "está entrando som e NÃO está saindo
     transcrição?". Se sim por 3s, a segunda captura roubou o microfone do
     reconhecimento — que é a falha conhecida, e é silenciosa por natureza:
     nenhum erro é disparado, o áudio simplesmente não chega. */
  useEffect(() => {
    if (fase !== "escutando" && fase !== "sentinela") return;
    if (vigia.current.desistiu) return;
    const id = window.setInterval(() => {
      const an = micAnalyser.current;
      if (!an) return;
      const buf = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(buf);
      let soma = 0;
      for (let i = 0; i < buf.length; i++) soma += buf[i];
      const energia = soma / buf.length / 255;

      const v = vigia.current;
      if (energia < 0.05) {
        v.energiaDesde = 0; // silêncio não acusa ninguém
        return;
      }
      if (!v.energiaDesde) v.energiaDesde = Date.now();
      const falandoHa = Date.now() - v.energiaDesde;
      const mudoHa = Date.now() - v.ouviuAlgo;
      if (falandoHa > 3000 && mudoHa > 3000) {
        v.desistiu = true;
        soltarMic();
        vizRef.current?.setLevel(0);
        // Escutar é a função da tela; ver a voz é enfeite. Quando os dois não
        // cabem, quem fica é a escuta.
        console.warn("[voz] o analisador estava roubando o microfone do reconhecimento — desliguei");
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [fase]);

  /** Solta o microfone de verdade (indicador do navegador apaga). */
  const soltarMic = useCallback(() => {
    try {
      micStream.current?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* ignora */
    }
    micStream.current = null;
    micAnalyser.current = null;
  }, []);
  useEffect(() => soltarMic, [soltarMic]);

  // Primeiro gesto em QUALQUER lugar da página destrava o áudio — é o que
  // salva o fluxo zero-clique quando o Chrome segura autoplay.
  useEffect(() => {
    const unlock = () => {
      houveGesto.current = true;
      void destravarAudio();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [destravarAudio]);

  /**
   * Toca as falas em sequência, baixando cada uma inteira antes de tocar.
   * 🚨 Não usar <audio src> em chunked cross-origin sem Content-Length: o
   * play() é aceito e não sai som. Fetch → blob same-origin toca sempre.
   * Se o autoplay for BLOQUEADO (zero-clique real), não perde a resposta:
   * `aoPrecisarGesto` vira o CTA "toque para ouvir".
   */
  const filaRef = useRef<{ cancelar: boolean }>({ cancelar: false });

  const tocarFalas = useCallback(
    async (
      urls: string[],
      aoTerminar: () => void,
      aoFalhar: () => void,
      aoPrecisarGesto?: (urls: string[]) => void,
    ) => {
      filaRef.current.cancelar = true; // corta SÓ uma fala anterior (nova pergunta explícita)
      const meu = { cancelar: false };
      filaRef.current = meu;

      const baixar = (u: string) =>
        fetch(u, { mode: "cors" })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .catch(() => null);

      let proxima = baixar(urls[0]);
      let tocouAlguma = false;
      let autoplayNegado = false;

      for (let i = 0; i < urls.length; i++) {
        const blob = await proxima;
        if (meu.cancelar) return;
        proxima = i + 1 < urls.length ? baixar(urls[i + 1]) : Promise.resolve(null);
        if (!blob) continue;

        const ok = await new Promise<boolean>((resolve) => {
          const src = URL.createObjectURL(blob);
          let el = audioRef.current;
          if (!el) {
            el = new Audio();
            audioRef.current = el;
          }
          el.src = src;

          const ac = ctxAudio.current;
          const v = vizRef.current;
          if (ac && ac.state === "running" && v) {
            if (!fonte.current) {
              try {
                fonte.current = ac.createMediaElementSource(el);
                const an = ac.createAnalyser();
                an.fftSize = 8192;
                an.smoothingTimeConstant = 0.5;
                fonte.current.connect(an);
                an.connect(ac.destination);
                anDora.current = an;
              } catch {
                fonte.current = null;
              }
            }
            // Re-liga SEMPRE: o setLevel das outras fases desconecta o
            // analyser do viz — sem isto a esfera ficava surda à voz da Dora
            // da 2ª resposta em diante.
            if (anDora.current) v.attachAnalyser?.(anDora.current);
          }
          if (!fonte.current) rodarEnvelope();

          const limpar = () => URL.revokeObjectURL(src);
          el.onended = () => {
            limpar();
            resolve(true);
          };
          el.onerror = () => {
            limpar();
            resolve(false);
          };
          el.ontimeupdate = () => {
            if (!fonte.current) alvo.current = 0.45 + Math.random() * 0.35;
          };
          el.play().catch((e) => {
            if (e?.name === "NotAllowedError") autoplayNegado = true;
            limpar();
            resolve(false);
          });
        });

        if (meu.cancelar) return;
        if (ok) tocouAlguma = true;
      }

      if (meu.cancelar) return;
      if (tocouAlguma) aoTerminar();
      else if (autoplayNegado && aoPrecisarGesto) aoPrecisarGesto(urls);
      else aoFalhar();
    },
    [rodarEnvelope],
  );

  /** Toca uma fala curta pré-gravada (filler / pois não). Só ELA é cortável. */
  const curtaRef = useRef<HTMLAudioElement | null>(null);
  /** Se a fala curta está no ar agora, e o que roda quando ela terminar. */
  const curtaTocando = useRef(false);
  const aoFimDaCurta = useRef<(() => void) | null>(null);
  const tocarCurta = useCallback(
    (src: string) => {
      try {
        if (!curtaRef.current) curtaRef.current = new Audio();
        const el = curtaRef.current;
        el.src = src;
        el.currentTime = 0;
        rodarEnvelope();
        el.ontimeupdate = () => {
          alvo.current = 0.45 + Math.random() * 0.3;
        };
        curtaTocando.current = true;
        const soltar = () => {
          curtaTocando.current = false;
          const proxima = aoFimDaCurta.current;
          aoFimDaCurta.current = null;
          proxima?.();
        };
        el.onended = soltar;
        el.onerror = soltar;   // sem áudio, a resposta não pode ficar presa
        void el.play().catch(() => {
          soltar();            // autoplay barrado: segue sem o filler
        });
      } catch {
        /* sem audio curto: so nao ha aviso sonoro */
      }
    },
    [rodarEnvelope],
  );

  /* 🚨 CORTAR o filler no meio é o que faz a conversa soar picotada: ela começa
     "só um momento, já te..." e a resposta entra por cima, engolindo o resto.
     Duas falas ao mesmo tempo não somam — atropelam.

     Quem chega depois ESPERA. O filler é curto (~1,5s) e já está no ar; a
     resposta entra quando ele acaba. Custa menos de dois segundos e é a
     diferença entre uma frase e um tropeço. */
  const pararCurta = useCallback(() => {
    // Só interrompe se ela NÃO estiver no ar — se estiver, deixa terminar.
    if (!curtaTocando.current) {
      try {
        curtaRef.current?.pause();
      } catch {
        /* ignora */
      }
    }
  }, []);

  /** Roda `fn` agora, ou quando o filler terminar de falar. */
  const depoisDaCurta = useCallback((fn: () => void) => {
    if (!curtaTocando.current) {
      fn();
      return;
    }
    aoFimDaCurta.current = fn;
  }, []);

  /** Fala pelo navegador (fallback quando o servidor não deu áudio). */
  const falarTexto = useCallback(
    (txt: string, aoFim: () => void) => {
      vizRef.current?.simulate(false);
      if (!("speechSynthesis" in window)) {
        setTimeout(aoFim, 2600);
        return;
      }
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "pt-BR";
      u.rate = 1.04;
      const voz = melhorVoz();
      if (voz) u.voice = voz;
      u.onstart = () => rodarEnvelope();
      u.onboundary = (ev: SpeechSynthesisEvent) => {
        const tam = ev.charLength || 4;
        alvo.current = Math.min(0.95, 0.42 + tam / 16);
      };
      const fim = () => {
        pararEnvelope();
        aoFim();
      };
      u.onend = fim;
      u.onerror = fim;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
    [rodarEnvelope, pararEnvelope],
  );

  // ── escuta: vontade × realidade (um dono só pro liga/desliga) ─────────
  const rodando = useRef(false);
  const querEscutar = useRef(false);
  const reinicio = useRef<number | null>(null);

  const sincronizar = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (querEscutar.current && !rodando.current) {
      try {
        rec.continuous = true;
        rec.start();
      } catch {
        /* ja estava rodando: o onstart corrige a flag */
      }
    } else if (!querEscutar.current && rodando.current) {
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
    }
  }, []);

  // VAD + follow-up: buffers e timers
  const bufFinal = useRef("");
  const interimAtual = useRef("");
  const vadTimer = useRef<number | null>(null);
  const followTimer = useRef<number | null>(null);

  const limparVad = useCallback(() => {
    if (vadTimer.current) {
      window.clearTimeout(vadTimer.current);
      vadTimer.current = null;
    }
    bufFinal.current = "";
    interimAtual.current = "";
  }, []);

  const cancelarFollowUp = useCallback(() => {
    if (followTimer.current) {
      window.clearTimeout(followTimer.current);
      followTimer.current = null;
    }
  }, []);

  const armarFollowUp = useCallback(() => {
    cancelarFollowUp();
    followTimer.current = window.setTimeout(() => {
      followTimer.current = null;
      // 20s de escuta sem nenhum turno → volta a exigir a chamada
      if (faseRef.current === "escutando") {
        sentinelaDoGesto.current = false; // decaiu sozinha: só a chamada acorda
        mudarFase("sentinela");
        setLinha({ texto: "", cls: "" });
      }
    }, FOLLOWUP_MS);
  }, [cancelarFollowUp, mudarFase]);

  /** Escuta reaberta DEPOIS da resposta: follow-up sem wake word. */
  const voltarAEscutar = useCallback(() => {
    // Sair da tela ou mic mutado no meio: respeita.
    if (faseRef.current === "desligada") return;
    mudarFase("escutando");
    armarFollowUp();
  }, [mudarFase, armarFollowUp]);

  /** Um texto do usuário (voz ou campo) entra no agente. */
  const receber = useCallback(
    (txt: string) => {
      const { chamou, pergunta } = detectarChamada(txt, agenteRef.current, false);
      if (chamou && !pergunta) {
        // Chamou pelo nome e não perguntou: responde curto e fica ouvindo.
        setLinha({ texto: "Pois não?", cls: "resposta" });
        tocarCurta(somPoisNao);
        window.setTimeout(voltarAEscutar, 900);
        return;
      }
      cancelarFollowUp();
      mudarFase("pensando");
      onEnviarRef.current(pergunta || txt);
    },
    [tocarCurta, voltarAEscutar, cancelarFollowUp, mudarFase],
  );
  const receberRef = useRef(receber);
  useEffect(() => {
    receberRef.current = receber;
  });

  // ── o reconhecimento — monta UMA vez ──────────────────────────────────
  useEffect(() => {
    const SR = (window.SpeechRecognition || window.webkitSpeechRecognition) as any;
    if (!SR) {
      setMicBloqueado(true);
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;

    /** FIM DE FALA AUTOMÁTICO: o silêncio fecha o turno e envia — sem clique. */
    const fecharTurno = () => {
      vadTimer.current = null;
      const turno = `${bufFinal.current} ${interimAtual.current}`.replace(/\s+/g, " ").trim();
      bufFinal.current = "";
      interimAtual.current = "";
      if (!falaValida(turno)) {
        setLinha({ texto: "", cls: "" });
        armarFollowUp(); // ruído não vira LLM; a janela de follow-up volta a contar
        return;
      }
      try {
        rec.abort(); // zera o buffer do navegador (isFinal atrasado ≠ 2º envio)
      } catch {
        /* ignora */
      }
      setLinha({ texto: turno, cls: "" });
      receberRef.current(turno);
    };

    rec.onstart = () => {
      rodando.current = true;
    };
    rec.onresult = (ev: any) => {
      let parcial = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        else parcial += ev.results[i][0].transcript;
      }

      const f = faseRef.current;
      vigia.current.ouviuAlgo = Date.now(); // veio transcrição: não há inanição
      if (f === "escutando") {
        cancelarFollowUp(); // tem fala acontecendo — o follow-up não expira no meio
        if (final) bufFinal.current = `${bufFinal.current} ${final}`.trim();
        interimAtual.current = parcial;
        const mostrado = `${bufFinal.current} ${parcial}`.replace(/\s+/g, " ").trim();
        if (mostrado) setLinha({ texto: mostrado, cls: "parcial" });
        if (vadTimer.current) window.clearTimeout(vadTimer.current);
        /* 🚨 Esperar sempre os mesmos 1,3s é jogar fora a única informação boa
           que o navegador dá de graça: o `isFinal`.

           Ele significa "o Chrome decidiu que a frase acabou" — o mesmo juízo
           que o timer tenta imitar, só que feito com o áudio na mão em vez de
           por cronômetro. Quando ele chega numa frase que já tem corpo (3+
           palavras), esperar mais 1,3s é esperar por nada.

           Não dá pra usar analisador de energia aqui: uma segunda captura do
           microfone STARVA o SpeechRecognition no Windows (já aconteceu, e o
           sintoma é a esfera reagindo à voz sem transcrever nada). Então a
           única leitura de fim de fala que sobra é esta. */
        const fechou = final.trim().length > 0;
        const temCorpo = mostrado.split(/\s+/).length >= 3;
        const espera = fechou && temCorpo ? VAD_APOS_FINAL_MS : VAD_SILENCIO_MS;
        if (mostrado) vadTimer.current = window.setTimeout(fecharTurno, espera);
        return;
      }

      if (f === "sentinela") {
        // Só a CHAMADA acorda (wake word estrita — fundo que menciona o agente
        // não dispara LLM). O status na tela diz como chamar.
        const ouvido = (final || parcial).trim();
        if (!ouvido) return;
        // Depois do GESTO, uma frase inteira também abre — não só a chamada.
        // Quem tocou e falou já pediu. Palavra solta segue sendo ruído.
        const fraseDeVerdade =
          sentinelaDoGesto.current && final.trim().split(/\s+/).length >= 2;
        if (!fraseDeVerdade && !detectarChamada(ouvido, agenteRef.current, true).chamou) return;
        sentinelaDoGesto.current = false;
        void destravarAudio(); // melhor esforço: sem gesto o Chrome pode segurar o som
        bufFinal.current = "";
        interimAtual.current = "";
        mudarFase("escutando");
        try {
          rec.abort(); // zera o trecho; onend religa já em escutando
        } catch {
          /* ignora */
        }
        receberRef.current(ouvido);
      }
      // pensando/falando/desligada: mic deveria estar off — descarta eco.
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        querEscutar.current = false;
        setMicBloqueado(true);
        mudarFase("desligada");
        return; // o status na tela vira o CTA — nunca falha em silêncio
      }
      // erro transitório (ex: network): mostra e deixa o onend religar
      setLinha({ texto: `microfone: ${e.error}`, cls: "parcial" });
      window.setTimeout(() => setLinha((l) => (l.texto.startsWith("microfone:") ? { texto: "", cls: "" } : l)), 2400);
    };
    rec.onend = () => {
      rodando.current = false;
      // O Chrome encerra sozinho após ~1min de silêncio. Se ainda queremos
      // escutar, volta — com um respiro pra não virar laço apertado.
      if (querEscutar.current) {
        if (reinicio.current) window.clearTimeout(reinicio.current);
        reinicio.current = window.setTimeout(sincronizar, 300);
      }
    };
    recRef.current = rec;

    // 🚨 O MIC NASCE 100% DESLIGADO — decisão do dono ("entrar com o microfone
    // ativo é gambiarra"). Nada de permissão/getUserMedia no load: UM toque na
    // esfera (ou no mic) ARMA a sentinela — e esse mesmo gesto destrava o
    // autoplay do Chrome. Instanciar o SR aqui não abre microfone (só .start()).

    return () => {
      faseRef.current = "desligada";
      querEscutar.current = false;
      if (reinicio.current) window.clearTimeout(reinicio.current);
      if (vadTimer.current) window.clearTimeout(vadTimer.current);
      if (followTimer.current) window.clearTimeout(followTimer.current);
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
      recRef.current = null;
    };
    // monta UMA vez de propósito — tudo que muda entra por ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ditado: escreve no CAMPO ao vivo (rec separado; suspende a escuta) ──
  const recDitado = useRef<any>(null);
  const [ditando, setDitando] = useState(false);
  const baseDitado = useRef("");
  const finaisDitado = useRef("");

  const toggleDitado = useCallback(() => {
    houveGesto.current = true;
    void destravarAudio();
    if (ditando) {
      try {
        recDitado.current?.stop(); // stop (não abort): entrega o trecho pendente
      } catch {
        /* ignora */
      }
      return;
    }
    const SR = (window.SpeechRecognition || window.webkitSpeechRecognition) as any;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;
    baseDitado.current = texto.trim() ? `${texto.trim()} ` : "";
    finaisDitado.current = "";
    rec.onresult = (ev: any) => {
      let parcial = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        else parcial += ev.results[i][0].transcript;
      }
      if (final) finaisDitado.current = `${finaisDitado.current}${final} `;
      setTexto(`${baseDitado.current}${finaisDitado.current}${parcial}`.replace(/\s+/g, " ").trimStart());
    };
    rec.onend = () => setDitando(false);
    rec.onerror = () => setDitando(false);
    recDitado.current = rec;
    try {
      rec.start();
      setDitando(true);
    } catch {
      setDitando(false);
    }
  }, [ditando, texto, destravarAudio]);

  useEffect(
    () => () => {
      try {
        recDitado.current?.abort();
      } catch {
        /* ignora */
      }
    },
    [],
  );

  // ── mic ON só em sentinela/escutando (e nunca durante o ditado) ───────
  useEffect(() => {
    const querMic = (fase === "sentinela" || fase === "escutando") && !ditando;
    querEscutar.current = querMic;
    if (!querMic) limparVad();
    sincronizar();
  }, [fase, ditando, sincronizar, limparVad]);

  // ── filler "só um momento": paraquedas, nunca protocolo ───────────────
  useEffect(() => {
    if (fase !== "pensando") return;
    const id = window.setTimeout(() => {
      if (faseRef.current === "pensando") tocarCurta(somAguarde);
    }, PACIENCIA_MS);
    return () => window.clearTimeout(id);
  }, [fase, tocarCurta]);

  // pai confirma o pensando (caminho do campo de texto da tela de conversa)
  useEffect(() => {
    if (pensando && faseRef.current !== "pensando") mudarFase("pensando");
    if (!pensando && faseRef.current === "pensando") {
      // resposta não veio (erro no POST)? não deixa a fase presa com mic off
      const id = window.setTimeout(() => {
        if (faseRef.current === "pensando") voltarAEscutar();
      }, 800);
      return () => window.clearTimeout(id);
    }
  }, [pensando, mudarFase, voltarAEscutar]);

  // ── a resposta chegou: FALANDO (áudio intocável até o fim) ────────────
  const respostaTexto = ultimaResposta?.texto ?? "";
  const respostaId = ultimaResposta?.id ?? 0;
  const pendenteRef = useRef<{ urls: string[]; texto: string } | null>(null);

  useEffect(() => {
    if (!respostaTexto) return;
    // O texto aparece JÁ — só o áudio espera. Ver a resposta enquanto a frase
    // curta termina é o comportamento certo: o olho não precisa esperar o ouvido.
    setLinha({ texto: respostaTexto, cls: "resposta" });
    pararCurta();
    setPrecisaToque(false);

    /* 🚨 Se a fala curta está no ar, a resposta ESPERA ela acabar. Entrar por
       cima é o que fazia a conversa soar picotada: "só um momento, já te—" e a
       resposta engolindo o resto. O filler dura ~1,5s e já começou; atravessá-lo
       economiza um segundo e custa a frase inteira. */
    depoisDaCurta(() => {
      mudarFase("falando");
      const urls = ultimaResposta?.audioUrls ?? [];
      if (urls.length) {
        vizRef.current?.simulate(false);
        void tocarFalas(
          urls,
          () => {
            vizRef.current?.setLevel(0);
            voltarAEscutar(); // fim do áudio → escuta reabre (follow-up)
          },
          () => falarTexto(respostaTexto, voltarAEscutar),
          (pend) => {
            // autoplay bloqueado (zero-clique real): não perde a resposta
            pendenteRef.current = { urls: pend, texto: respostaTexto };
            setPrecisaToque(true);
          },
        );
        return;
      }
      falarTexto(respostaTexto, voltarAEscutar);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostaId]);

  const tocarPendente = useCallback(() => {
    const p = pendenteRef.current;
    if (!p) return;
    setPrecisaToque(false);
    houveGesto.current = true;
    void destravarAudio();
    mudarFase("falando");
    void tocarFalas(
      p.urls,
      () => {
        vizRef.current?.setLevel(0);
        voltarAEscutar();
      },
      () => falarTexto(p.texto, voltarAEscutar),
    );
  }, [destravarAudio, tocarFalas, falarTexto, voltarAEscutar, mudarFase]);

  useEffect(() => pararEnvelope, [pararEnvelope]);

  /* 🚨 Nem toda sentinela vale o mesmo.
     A que nasce de um TOQUE na esfera: a pessoa acabou de gesticular e está
     com a boca aberta pra falar — exigir a senha depois do gesto é pedir duas
     vezes a mesma coisa. Foi exatamente o teste do dono ("toquei nele, falei, e
     ele não responde"): ele disse a PERGUNTA, não a chamada, e a frase foi
     descartada em silêncio.
     A que a conversa DECAI depois do follow-up: podem ter passado minutos com o
     mic aberto, e aí a chamada é o que separa conversa de ruído de sala. */
  const sentinelaDoGesto = useRef(false);

  /* 🚨 O MICROFONE NO DESENHO, E A REDE DE SEGURANÇA QUE ELE EXIGE.
     Havia um motivo para o analisador estar desligado durante a escuta: em
     alguma máquina Windows a segunda captura do microfone STARVOU o
     SpeechRecognition — a esfera reagia à voz e nada virava transcrição, sem
     erro e sem log. Dez "oi tier" seguidos sem nenhuma reação.
     Mas desligado, a esfera fica PARADA justamente quando a pessoa fala, que é
     quando ela deveria estar viva ("nem parece que está se mexendo").
     Então volta a ligar, com um vigia: se houver energia de áudio por 3s
     seguidos e o reconhecimento não tiver produzido NADA nesse tempo, é a
     inanição acontecendo — solta o analisador, marca a máquina como incompatível
     pelo resto da sessão, e a escuta continua. Escutar ganha de ver. */
  const vigia = useRef({ energiaDesde: 0, ouviuAlgo: 0, desistiu: false });

  // ── controles ─────────────────────────────────────────────────────────
  /* 🚨 A tela mostrava o texto CRU do navegador — minúsculo, sem vírgula nem
     ponto. O dono mandou o print: "eu gostaria de saber se vocês têm integração
     com o Mercado Livre", tudo corrido. Feio, e é a única coisa que ele vê
     enquanto espera.

     O servidor já devolve a versão pontuada; aqui ela substitui o que está na
     tela. Só enquanto a linha ainda é a fala dele (`parcial`/vazia) — se a
     resposta já entrou, reescrever por cima seria apagar o que ele está lendo. */
  const ultimaLimpa = useRef(0);
  useEffect(() => {
    if (!falaLimpa || falaLimpa.id === ultimaLimpa.current) return;
    ultimaLimpa.current = falaLimpa.id;
    setLinha((l) => (l.cls === "resposta" ? l : { texto: falaLimpa.texto, cls: "" }));
  }, [falaLimpa]);

  /** O gesto de ARMAR: liga a sentinela (wake word) e destrava o áudio. */
  const armarSentinela = useCallback(() => {
    houveGesto.current = true;
    setMicBloqueado(false);
    void destravarAudio();
    sentinelaDoGesto.current = true;
    mudarFase("sentinela");
    setLinha({ texto: "", cls: "" });
  }, [destravarAudio, mudarFase]);

  /* 🚨 ENTRAR NA TELA DE VOZ JÁ ARMA A ESCUTA.
     Antes era preciso um segundo toque, NA ESFERA, e nada dizia isso. O usuário
     abria, falava, e a esfera até se mexia — porque o analisador segue o som
     ambiente — mas o reconhecimento nunca tinha começado. Interface que se mexe
     sem fazer nada é pior que interface parada: parece viva.

     O clique no botão que trouxe a pessoa até aqui JÁ É o gesto do usuário que o
     Chrome exige para liberar áudio e microfone. Exigir outro era pedir duas
     vezes a mesma coisa.

     A decisão de o mic não nascer ligado no CARREGAMENTO da página continua de
     pé — ela vale para quem só abriu o link, não para quem entrou na tela de voz
     de propósito. */
  /* 🚨 CARREGAR O LINK NÃO LIGA NADA. A fase nasce "desligada": microfone
     fechado, sem indicador de gravação no navegador, sem escuta.

     Só duas coisas ligam, e as duas são um pedido explícito:
       · o BOTÃO de conversa por voz  → entra ESCUTANDO (o clique é a chamada)
       · um toque na esfera           → arma a SENTINELA, que espera "oi {nome}"

     Eu já armei microfone na carga da página três vezes nesta sessão, e as três
     estavam erradas. Quem abre um link pode só estar olhando — abrir o mic dele
     sem pedir é o que o dono chamou de gambiarra, e ele tem razão: o navegador
     acende o ponto de gravação e a pessoa não pediu nada. */
  const jaArmou = useRef(false);
  useEffect(() => {
    if (jaArmou.current || !comecarEscutando) return;
    jaArmou.current = true;
    houveGesto.current = true;
    setMicBloqueado(false);
    void destravarAudio();
    mudarFase("escutando");
    setLinha({ texto: "", cls: "" });
  }, [comecarEscutando, destravarAudio, mudarFase]);

  /** Muta o mic (NÃO toca no áudio que estiver tocando). */
  const desligarEscuta = useCallback(() => {
    cancelarFollowUp();
    limparVad();
    soltarMic(); // solta a captura de verdade: o indicador do navegador apaga
    // se estiver falando, deixa falar — só o mic desliga
    if (faseRef.current !== "falando" && faseRef.current !== "pensando") {
      setLinha({ texto: "", cls: "" });
    }
    mudarFase("desligada");
  }, [cancelarFollowUp, limparVad, mudarFase, soltarMic]);

  const escutaLigada = fase !== "desligada";

  const enviarTexto = useCallback(() => {
    const v = texto.trim();
    if (!v) return;
    houveGesto.current = true;
    void destravarAudio();
    if (ditando) {
      try {
        recDitado.current?.stop();
      } catch {
        /* ignora */
      }
    }
    setTexto("");
    setLinha({ texto: v, cls: "" });
    receber(v);
  }, [texto, destravarAudio, receber, ditando]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvoEl = e.target as HTMLElement | null;
      if (e.code === "Space" && alvoEl?.tagName !== "INPUT") {
        e.preventDefault();
        if (escutaLigada) desligarEscuta();
        else armarSentinela();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escutaLigada, armarSentinela, desligarEscuta]);

  // ── UI ────────────────────────────────────────────────────────────────
  const corPonto =
    fase === "escutando" || fase === "falando"
      ? "bg-white shadow-[0_0_12px_rgba(255,255,255,0.75)]"
      : fase === "pensando"
        ? "bg-[#8e8e93] animate-pulse"
        : fase === "sentinela"
          ? "bg-[#8e8e93]"
          : "bg-[#2c2c2e]";

  // Estado do mic SEMPRE visível — e clicável quando é um convite à ação.
  // A página abre desarmada: a dica deixa ÓBVIO que um toque liga.
  const status: { texto: string; acao: (() => void) | null } = precisaToque
    ? { texto: "toque para ouvir a resposta", acao: tocarPendente }
    : fase === "desligada"
      ? micBloqueado
        ? { texto: "microfone bloqueado — toque para tentar de novo", acao: armarSentinela }
        : // 🚨 O rótulo diz as DUAS saídas, porque são duas mesmo: tocar a
          // esfera põe o agente à escuta da chamada, e o botão de voz entra
          // direto na conversa. Dizer só uma esconde metade da tela.
          { texto: `toque na esfera e diga "oi ${nomeCurto}"`, acao: armarSentinela }
      : fase === "sentinela"
        ? { texto: `diga "oi ${nomeCurto}"`, acao: null }
        : fase === "escutando"
          ? { texto: "escutando — pode falar", acao: null }
          : fase === "pensando"
            ? { texto: "pensando…", acao: null }
            : { texto: "respondendo…", acao: null };

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-[#f2f2f7] select-none">
      <span
        className={`fixed top-[22px] left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full z-30 transition-all ${corPonto}`}
      />

      <div className="flex-1 min-h-0 grid place-items-center px-4 pt-6">
        {/* A animacao vai no PAI. No proprio elemento, o visualizador media a
            caixa durante o scale(.88) e o canvas ficava 12% ampliado pra sempre.
            Desarmada, a PRÓPRIA ESFERA é o botão de começar (1 gesto arma a
            sentinela E destrava o autoplay). */}
        <div
          className={`w-[min(72vmin,560px)] aspect-square voz-entra ${fase === "desligada" ? "cursor-pointer" : ""}`}
          onClick={fase === "desligada" ? armarSentinela : undefined}
          role={fase === "desligada" ? "button" : undefined}
          aria-label={fase === "desligada" ? "Tocar para começar a conversa por voz" : undefined}
        >
          <div id="esfera-voz" className="w-full h-full" />
        </div>
      </div>

      {linha.texto ? (
        <p
          className={`fixed left-0 right-0 bottom-[118px] text-center px-[7vw] z-30 font-light leading-[1.4] tracking-[-0.01em] max-h-[24vh] overflow-hidden text-[clamp(16px,2.1vw,24px)] ${
            linha.cls === "parcial" ? "text-[#8e8e93]" : "text-[#f2f2f7]"
          }`}
        >
          {linha.texto}
        </p>
      ) : null}

      {/* status do mic: SEMPRE visível; vira CTA quando há ação a tomar */}
      <button
        type="button"
        onClick={status.acao ?? undefined}
        disabled={!status.acao}
        className={`fixed left-1/2 -translate-x-1/2 bottom-[88px] z-30 text-[11px] tracking-[0.14em] uppercase transition-colors ${
          status.acao ? "text-[#c7c7cc] underline underline-offset-4 decoration-[#48484a] cursor-pointer" : "text-[#48484a]"
        }`}
      >
        {status.texto}
      </button>

      {/* barra: [+ conversa] [campo] [mic ditado] [círculo branco: escuta/enviar] */}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-[18px] z-40 w-[min(92vw,760px)] h-14 rounded-[28px] bg-[#1c1c1e] flex items-center gap-1.5 pl-2.5 pr-2">
        <button
          type="button"
          onClick={onVerConversa}
          title={`Ver a conversa — ${titulo}`}
          aria-label="Ver a conversa"
          className="shrink-0 h-9 w-9 rounded-full grid place-items-center text-[#f2f2f7] hover:bg-[#2c2c2e] transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && texto.trim()) enviarTexto();
          }}
          placeholder={ditando ? "Pode falar — estou escrevendo…" : "Mensagem"}
          autoComplete="off"
          enterKeyHint="send"
          className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[16px] text-[#f2f2f7] placeholder:text-[#8e8e93] px-1"
        />

        {/* mic de DITADO: fala e o texto vai sendo escrito no campo */}
        <button
          type="button"
          onClick={toggleDitado}
          title={ditando ? "Parar o ditado" : "Ditar por voz (escreve no campo)"}
          aria-label={ditando ? "Parar o ditado" : "Ditar por voz"}
          className={`shrink-0 h-9 w-9 rounded-full grid place-items-center transition-colors ${
            ditando ? "text-[#ff453a] bg-[#2c2c2e] animate-pulse" : "text-[#f2f2f7] hover:bg-[#2c2c2e]"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 18v4" />
          </svg>
        </button>

        {/* círculo branco: com texto vira ↑ enviar; sem texto é o modo de voz
            (waveform) — branco = escuta ligada; escuro = mutado */}
        {texto.trim() ? (
          <button
            type="button"
            onClick={enviarTexto}
            title="Enviar"
            aria-label="Enviar"
            className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-white text-black transition hover:bg-[#e8e8ed]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={escutaLigada ? desligarEscuta : armarSentinela}
            title={escutaLigada ? "Desligar o microfone" : "Conversar por voz"}
            aria-label={escutaLigada ? "Desligar o microfone" : "Conversar por voz"}
            className={`shrink-0 h-9 w-9 rounded-full grid place-items-center transition-colors ${
              escutaLigada ? "bg-white text-black hover:bg-[#e8e8ed]" : "bg-[#3a3a3c] text-[#f2f2f7] hover:bg-[#48484a]"
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 9v6M8 6v12M12 3v18M16 6v12M20 9v6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

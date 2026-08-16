/**
 * Tela de voz do link público — a esfera de pó ocupando a tela, uma barra
 * embaixo e nada mais.
 *
 * Três coisas mandam no comportamento:
 *
 * 1. **Ela ESPERA — não congela e não pulsa.** O giro rápido vem do nível de voz
 *    (`PO_DEADZONE` no `optimus-viz.js`); em repouso só há uma rotação lentíssima
 *    e a superfície fervilha por PARTÍCULA (ruído dessincronizado), nunca a
 *    esfera inteira em fase única — pulso uniforme lê como CSS, não como matéria.
 *
 * 2. **"oi tier" ATIVA a conversa.** A página nasce em SENTINELA (mic aberto só
 *    esperando a chamada — wake word estrita, testada em `lib/voz-fala.ts`).
 *    Detectou, vira CONVERSA: tudo que você fala vai pro agente.
 *
 * 3. **Fim de fala automático (VAD).** Falou e parou ~1,3s → o turno fecha e
 *    envia sozinho, sem apertar nada. Enquanto a Dora fala, o mic desliga
 *    (senão o eco fecharia turno com a fala dela).
 *
 * O `SpeechSynthesis` não expõe o áudio pra análise. O sinal mais fiel que ele
 * dá é o `onboundary`, que avisa a cada palavra pronunciada — é ele que move a
 * esfera, uma palavra de cada vez, e não um gerador de sílabas solto.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Importado como asset pra o Vite carimbar o hash do conteudo no nome. Em
// public/ o arquivo tinha nome fixo e o nginx serve .js com `immutable`: o
// navegador segurava a versao velha por 7 dias e purge de CDN nao resolvia.
import urlDoViz from "@/lib/optimus-viz.js?url";
// Falas curtas ja sintetizadas na voz da Dora. Tocam do disco, sem ida ao
// servidor — e o que faz o agente responder NA HORA em vez de ficar mudo
// enquanto o modelo escreve.
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
  list: () => unknown[];
};

declare global {
  interface Window {
    OptimusViz?: Viz;
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  }
}

type Estado = "repouso" | "ouvindo" | "pensando" | "falando" | "erro";

// A escuta tem três marchas:
//   desligada — mic fechado; só clique religa (desligou é desligou — privacidade)
//   sentinela — mic aberto esperando a CHAMADA ("oi tier"); todo o resto é descartado
//   conversa  — tudo que você fala vai pro agente, com fim de fala automático (VAD)
type Escuta = "desligada" | "sentinela" | "conversa";

// Quanto de silêncio o agente aguenta antes de avisar "só um momento".
// Abaixo disso a resposta vem direto — pra "oi" o aviso era pior que a espera.
const PACIENCIA_MS = 2500;

// Fim de fala automático: este silêncio depois da última palavra fecha o turno
// e envia — SEM apertar nada. Curto demais corta pausa de respiração; longo
// demais vira "ele demora pra entender que terminei". 1,3s é o meio-termo
// (ChatGPT Voice opera nessa faixa).
const VAD_SILENCIO_MS = 1300;

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
 *
 * A primeira costuma ser a SAPI antiga do Windows ("Microsoft Daniel/Maria"),
 * que é justamente a que soa robótica. As neurais têm nome próprio: no Edge vêm
 * como "(Natural)"/"Online", no Chrome/Android como "Google português do
 * Brasil", no macOS/iOS como "Luciana". Vale muito ordenar.
 */
function melhorVoz(): SpeechSynthesisVoice | null {
  const todas = speechSynthesis.getVoices().filter((v) => /pt[-_]BR/i.test(v.lang));
  if (!todas.length) return null;
  const nota = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 100; // Microsoft neural (Edge)
    if (/online/.test(n)) s += 60; // voz de nuvem
    if (/google/.test(n)) s += 50; // Google pt-BR
    if (/luciana|francisca|thalita|brenda|antonio|ant[oô]nio/.test(n)) s += 30;
    if (!v.localService) s += 20; // remota costuma ser melhor que a embarcada
    if (/microsoft (daniel|maria)\b/.test(n)) s -= 25; // SAPI antiga
    return s;
  };
  return [...todas].sort((a, b) => nota(b) - nota(a))[0] ?? null;
}

export default function VozPublica({
  agente,
  titulo,
  pensando,
  ultimaResposta,
  onEnviar,
  onVerConversa,
}: {
  agente: string;
  titulo: string;
  pensando: boolean;
  /** `id` muda a cada resposta — duas iguais seguidas precisam falar de novo. */
  ultimaResposta: { texto: string; id: number; audioUrls?: string[] } | null;
  onEnviar: (texto: string) => void;
  onVerConversa: () => void;
}) {
  const [estado, setEstado] = useState<Estado>("repouso");
  const [linha, setLinha] = useState<{ texto: string; cls: string }>({ texto: "", cls: "" });
  const [texto, setTexto] = useState("");

  const vizRef = useRef<Viz | null>(null);
  const recRef = useRef<any>(null);

  // Como as pessoas chamam de verdade: a PRIMEIRA palavra do nome ("oi tier").
  const nomeCurto = (agente.split(/\s+/)[0] || agente).toLowerCase();

  // A lista de vozes carrega assincrona no Chrome: a 1a chamada volta vazia e
  // cairia na voz padrao (a robotica). Aquece aqui pra melhorVoz() ter o que ler.
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
      v.setLevel(0); // sem voz: quem move e o respiro do proprio visualizador
    });
    return () => {
      vivo = false;
      inst?.destroy?.();
    };
  }, []);

  // ── a esfera acompanha a fala ─────────────────────────────────────────
  // O `SpeechSynthesis` não entrega o áudio pra análise, então o sinal mais
  // fiel disponível é o `onboundary`: ele avisa a CADA palavra pronunciada.
  // Cada palavra vira um pulso, com a força puxada pelo tamanho dela — em vez
  // do gerador de sílabas, que não tinha relação nenhuma com o que era dito.
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
      // ataque rápido, decaimento lento: o desenho de uma sílaba
      const sobe = alvo.current > nivel.current;
      nivel.current += (alvo.current - nivel.current) * (sobe ? 0.5 : 0.09);
      alvo.current *= 0.9;
      vizRef.current?.setLevel(Math.max(0, Math.min(1, nivel.current)));
      quadro.current = requestAnimationFrame(passo);
    };
    passo();
  }, []);

  const aplicarEstado = useCallback(
    (e: Estado) => {
      setEstado(e);
      const v = vizRef.current;
      if (!v) return;
      if (e === "pensando") {
        // pensando não é falar: um respiro fundo e lento, sem sílaba
        v.simulate(false);
        pararEnvelope();
        v.setLevel(0.3);
      } else if (e !== "falando" && e !== "ouvindo") {
        v.simulate(false);
        pararEnvelope();
      }
    },
    [pararEnvelope],
  );

  /**
   * Toca o MP3 do ElevenLabs e liga a esfera no áudio DE VERDADE.
   *
   * Aqui não há aproximação: o áudio passa por um AnalyserNode e o visualizador
   * lê o espectro real, igual faz com o microfone. É a diferença entre a esfera
   * "acompanhar" a fala e a esfera SER a fala.
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxAudio = useRef<AudioContext | null>(null);
  const fonte = useRef<MediaElementAudioSourceNode | null>(null);

  /**
   * Destrava o áudio DENTRO do gesto do usuário.
   *
   * 🚨 Um `AudioContext` criado fora de clique nasce `suspended`. E como
   * `createMediaElementSource` desvia TODO o som do elemento pra dentro do
   * grafo, tocar num contexto suspenso não dá som baixo — dá silêncio total.
   * Era isso que fazia o agente "não responder": o backend devolvia 200, o
   * áudio chegava, e ninguém ouvia nada.
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

  /**
   * Toca as falas em sequencia, baixando cada uma inteira antes de tocar.
   *
   * 🚨 Nao usar <audio src="url em chunked">: o Chrome NAO inicia reproducao
   * progressiva em cross-origin sem Content-Length — o play() e aceito, o
   * evento `playing` nunca dispara e nao sai som. Reproduzido no navegador.
   * Baixando por fetch (que lida com chunked) e tocando de um blob same-origin,
   * toca sempre — e como cada fala e UMA FRASE, a primeira chega em ~1s.
   */
  const filaRef = useRef<{ cancelar: boolean }>({ cancelar: false });

  const tocarFalas = useCallback(
    async (urls: string[], aoTerminar: () => void, aoFalhar: () => void) => {
      filaRef.current.cancelar = true; // corta qualquer fala anterior
      const meu = { cancelar: false };
      filaRef.current = meu;

      const baixar = (u: string) =>
        fetch(u, { mode: "cors" })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .catch(() => null);

      let proxima = baixar(urls[0]);
      let tocouAlguma = false;

      for (let i = 0; i < urls.length; i++) {
        const blob = await proxima;
        if (meu.cancelar) return;
        // ja vai buscando a seguinte enquanto esta toca
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

          // Liga o analisador uma vez so, e SO com o contexto rodando: num
          // contexto suspenso o createMediaElementSource silencia o elemento.
          const ac = ctxAudio.current;
          const v = vizRef.current;
          if (ac && ac.state === "running" && !fonte.current && v) {
            try {
              fonte.current = ac.createMediaElementSource(el);
              const an = ac.createAnalyser();
              an.fftSize = 8192;
              an.smoothingTimeConstant = 0.5;
              fonte.current.connect(an);
              an.connect(ac.destination);
              v.attachAnalyser?.(an);
            } catch {
              fonte.current = null;
            }
          }
          if (!fonte.current) rodarEnvelope();

          const limpar = () => URL.revokeObjectURL(src);
          el.onended = () => { limpar(); resolve(true); };
          el.onerror = () => { limpar(); resolve(false); };
          el.ontimeupdate = () => { if (!fonte.current) alvo.current = 0.45 + Math.random() * 0.35; };
          void el.play().catch(() => { limpar(); resolve(false); });
        });

        if (meu.cancelar) return;
        if (ok) tocouAlguma = true;
      }

      if (meu.cancelar) return;
      if (tocouAlguma) aoTerminar();
      else aoFalhar();
    },
    [rodarEnvelope],
  );

  /** Toca uma fala curta pre-gravada. Instantaneo: vem do disco. */
  const curtaRef = useRef<HTMLAudioElement | null>(null);
  const tocarCurta = useCallback((src: string) => {
    try {
      if (!curtaRef.current) curtaRef.current = new Audio();
      const el = curtaRef.current;
      el.src = src;
      el.currentTime = 0;
      rodarEnvelope();
      el.ontimeupdate = () => { alvo.current = 0.45 + Math.random() * 0.3; };
      void el.play().catch(() => {});
    } catch {
      /* sem audio curto: so nao ha aviso sonoro */
    }
  }, [rodarEnvelope]);

  const pararCurta = useCallback(() => {
    try {
      curtaRef.current?.pause();
    } catch {
      /* ignora */
    }
  }, []);

  /** Fala um texto e faz a esfera seguir palavra a palavra. */
  const falarTexto = useCallback(
    (texto: string) => {
      aplicarEstado("falando");
      vizRef.current?.simulate(false);
      if (!("speechSynthesis" in window)) {
        setTimeout(() => aplicarEstado("repouso"), 2600);
        return;
      }
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "pt-BR";
      u.rate = 1.04;
      const voz = melhorVoz();
      if (voz) u.voice = voz;

      u.onstart = () => rodarEnvelope();
      u.onboundary = (ev: SpeechSynthesisEvent) => {
        // palavra maior = pulso mais forte, igual a sílaba tônica na fala
        const tam = ev.charLength || 4;
        alvo.current = Math.min(0.95, 0.42 + tam / 16);
      };
      const fim = () => {
        pararEnvelope();
        aplicarEstado("repouso");
      };
      u.onend = fim;
      u.onerror = fim;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
    [aplicarEstado, rodarEnvelope, pararEnvelope],
  );

  // 🚨 O "Só um momento" é PARAQUEDAS, não protocolo. Tocando a 400ms ele
  // disparava pra TODA pergunta — um "oi" ganhava "só um momento, já te
  // respondo" e a conversa inteira parecia lenta. Agora só toca se a resposta
  // ainda não chegou depois de PACIENCIA_MS: resposta rápida vem direto, e a
  // esfera em "pensando" já mostra que ele ouviu. Se o filler começou e a
  // resposta chega no meio, `pararCurta()` (no efeito da resposta) corta limpo.
  useEffect(() => {
    if (!pensando) return;
    aplicarEstado("pensando");
    const id = setTimeout(() => tocarCurta(somAguarde), PACIENCIA_MS);
    return () => clearTimeout(id);
  }, [pensando, aplicarEstado, tocarCurta]);

  // ── o agente fala a resposta que chegou ───────────────────────────────
  const respostaTexto = ultimaResposta?.texto ?? "";
  const respostaId = ultimaResposta?.id ?? 0;
  useEffect(() => {
    if (!respostaTexto) return;
    setLinha({ texto: respostaTexto, cls: "resposta" });
    pararCurta(); // a resposta chegou: cala o "um momento"
    const urls = ultimaResposta?.audioUrls ?? [];
    if (urls.length) {
      aplicarEstado("falando");
      vizRef.current?.simulate(false);
      void tocarFalas(
        urls,
        () => { vizRef.current?.setLevel(0); aplicarEstado("repouso"); },
        () => falarTexto(respostaTexto), // sem audio do servidor: voz do navegador
      );
      return;
    }
    falarTexto(respostaTexto);
    return () => speechSynthesis?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostaId]);

  useEffect(() => pararEnvelope, [pararEnvelope]);

  const receber = useCallback(
    (txt: string) => {
      // Modo SOLTO: em conversa o nome vale em qualquer posição (é o "pois
      // não?" de quem chama no meio do papo). A wake word ESTRITA vive na
      // sentinela, dentro do reconhecimento.
      const { chamou, pergunta } = detectarChamada(txt, agente, false);
      if (chamou && !pergunta) {
        // Chamou pelo nome e nao perguntou: responde CURTO e fica pronto pra
        // ouvir. Uma apresentacao longa aqui atrapalha — a pessoa chamou pra
        // perguntar, nao pra ouvir credencial.
        setLinha({ texto: "Pois não?", cls: "resposta" });
        tocarCurta(somPoisNao);
        setTimeout(() => aplicarEstado("repouso"), 1200);
        return;
      }
      onEnviar(pergunta || txt);
    },
    [onEnviar, agente, tocarCurta, aplicarEstado],
  );

  // ── reconhecimento de fala ────────────────────────────────────────────
  // A página nasce em SENTINELA: mic aberto só esperando "oi {nome}" — é a
  // wake word que ATIVA a conversa, sem clique nenhum. Em conversa, o fim de
  // fala é automático (VAD por silêncio): falou, parou, ele responde. O botão
  // de microfone continua sendo o interruptor manual (e o desliga-tudo).
  const escuta = useRef<Escuta>("desligada");
  const [escutaUI, setEscutaUI] = useState<Escuta>("desligada");
  const mudarEscuta = useCallback((e: Escuta) => {
    escuta.current = e;
    setEscutaUI(e);
  }, []);
  // Houve gesto do usuário? Sem gesto, permissão negada no auto-início da
  // sentinela falha em SILÊNCIO (flash vermelho na cara de quem só abriu o
  // link seria hostil).
  const houveGesto = useRef(false);
  const reinicio = useRef<number | null>(null);

  // VAD: buffers do turno em andamento + o timer de silêncio que o fecha.
  const bufFinal = useRef("");
  const interimAtual = useRef("");
  const vadTimer = useRef<number | null>(null);
  const limparVad = useCallback(() => {
    if (vadTimer.current) {
      window.clearTimeout(vadTimer.current);
      vadTimer.current = null;
    }
    bufFinal.current = "";
    interimAtual.current = "";
  }, []);

  // 🚨 UM dono so pro reinicio. Antes o `onend` e o efeito de estado agendavam
  // restart os dois, brigando num laco a cada ~500ms — a tela travava e o
  // indicador de microfone piscava sem parar.
  // 🚨 `rodando` reflete o que o NAVEGADOR diz, nunca o que eu suponho. A versao
  // anterior marcava false no catch do start() — mas quando ele lanca
  // "already started" o reconhecimento ESTA rodando, entao a flag passava a
  // mentir e a escuta nunca mais comecava. Agora so onstart/onend escrevem nela.
  const rodando = useRef(false);
  const querEscutar = useRef(false);

  /** Faz a realidade bater com a vontade. Unico ponto que liga/desliga. */
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

  useEffect(() => {
    const SR = (window.SpeechRecognition || window.webkitSpeechRecognition) as any;
    if (!SR) return;
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
      // Ruído/muleta ("hum", "é") não vira chamada de LLM na conta do tenant.
      if (!falaValida(turno)) {
        setLinha({ texto: "", cls: "" });
        return;
      }
      // Zera o buffer do navegador: o isFinal pendente DESTE trecho não pode
      // chegar atrasado e virar um segundo envio. O onend religa a escuta.
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
      setLinha({ texto: turno, cls: "" });
      receber(turno);
    };

    rec.onstart = () => {
      rodando.current = true;
      aplicarEstado("ouvindo");
    };
    rec.onresult = (ev: any) => {
      let parcial = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        else parcial += ev.results[i][0].transcript;
      }

      if (escuta.current === "conversa") {
        // Acumula finais + interim e deixa O SILÊNCIO decidir o fim do turno.
        // Enviar no isFinal do Chrome cortava a frase em pausa de respiração
        // (~0,6s); o timer só dispara depois de VAD_SILENCIO_MS sem palavra nova.
        if (final) bufFinal.current = `${bufFinal.current} ${final}`.trim();
        interimAtual.current = parcial;
        const mostrado = `${bufFinal.current} ${parcial}`.replace(/\s+/g, " ").trim();
        if (mostrado) setLinha({ texto: mostrado, cls: "parcial" });
        if (vadTimer.current) window.clearTimeout(vadTimer.current);
        if (mostrado) vadTimer.current = window.setTimeout(fecharTurno, VAD_SILENCIO_MS);
        return;
      }

      // SENTINELA: só a CHAMADA acorda ("oi tier" no começo da frase, ou frase
      // curta endereçada). Conversa de fundo que apenas MENCIONA o agente é
      // descartada — a dica na tela diz como chamar, então o silêncio aqui não
      // é degradê mudo. Nada acumula: cada trecho é avaliado e morre.
      const ouvido = (final || parcial).trim();
      if (!ouvido || !detectarChamada(ouvido, agente, true).chamou) return;
      mudarEscuta("conversa");
      void destravarAudio(); // melhor esforço: sem gesto o Chrome pode segurar o som
      bufFinal.current = "";
      interimAtual.current = "";
      try {
        rec.abort(); // zera o trecho; onend religa já em modo conversa
      } catch {
        /* ignora */
      }
      receber(ouvido);
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed") {
        mudarEscuta("desligada");
        querEscutar.current = false;
        // Sem gesto (auto-início da sentinela): falha em silêncio — flash
        // vermelho na cara de quem só abriu o link seria hostil.
        if (!houveGesto.current) return;
      }
      aplicarEstado("erro");
      setLinha({ texto: e.error === "not-allowed" ? "microfone bloqueado" : `erro: ${e.error}`, cls: "" });
      setTimeout(() => {
        aplicarEstado("repouso");
        setLinha({ texto: "", cls: "" });
      }, 2600);
    };
    rec.onend = () => {
      rodando.current = false;
      setEstado((st) => (st === "ouvindo" ? "repouso" : st));
      // O Chrome encerra sozinho apos ~1min de silencio. Se ainda queremos
      // escutar, volta — com um respiro pra nao virar laco apertado.
      if (querEscutar.current) {
        if (reinicio.current) window.clearTimeout(reinicio.current);
        reinicio.current = window.setTimeout(sincronizar, 300);
      }
    };
    recRef.current = rec;

    // A SENTINELA NASCE LIGADA: abrir a página e dizer "oi tier" já ativa a
    // conversa. Se a permissão for negada, o onerror desliga em silêncio.
    mudarEscuta("sentinela");
    querEscutar.current = true;
    sincronizar();

    return () => {
      mudarEscuta("desligada");
      querEscutar.current = false;
      if (reinicio.current) window.clearTimeout(reinicio.current);
      if (vadTimer.current) window.clearTimeout(vadTimer.current);
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
      recRef.current = null;
    };
  }, [receber, aplicarEstado, sincronizar, agente, mudarEscuta, destravarAudio]);

  // Enquanto ele fala ou pensa, nao queremos escutar — senao o microfone ouve o
  // alto-falante e ele se chama sozinho (VAD + eco = pior ainda: fecharia turno
  // com a fala da Dora). Este efeito so muda a VONTADE; ligar e desligar de
  // fato e sempre do `sincronizar`. Buffers do VAD morrem junto.
  useEffect(() => {
    const ocupado = estado === "falando" || estado === "pensando";
    querEscutar.current = escutaUI !== "desligada" && !ocupado;
    if (ocupado) limparVad();
    sincronizar();
  }, [estado, escutaUI, sincronizar, limparVad]);

  /** O botão de microfone: liga a conversa; em conversa, DESLIGA TUDO
   *  (sentinela inclusive — desligou é desligou, privacidade). */
  const falar = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    houveGesto.current = true;

    if (escuta.current === "conversa") {
      mudarEscuta("desligada");
      querEscutar.current = false;
      limparVad();
      if (reinicio.current) window.clearTimeout(reinicio.current);
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
      aplicarEstado("repouso");
      setLinha({ texto: "", cls: "" });
      return;
    }

    void destravarAudio(); // precisa ser DENTRO do gesto
    // Sem attachMic: o reconhecimento ja abre o microfone. Dois capturas
    // simultaneas travavam a interface no Windows. A esfera usa o envelope.
    mudarEscuta("conversa");
    querEscutar.current = true;
    sincronizar();
  }, [aplicarEstado, sincronizar, mudarEscuta, limparVad, destravarAudio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.code === "Space" && alvo?.tagName !== "INPUT") {
        e.preventDefault();
        falar();
      }
      if (e.key === "Escape") {
        speechSynthesis?.cancel();
        aplicarEstado("repouso");
        setLinha({ texto: "", cls: "" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [falar, aplicarEstado]);

  const corPonto =
    estado === "ouvindo" || estado === "falando"
      ? "bg-white shadow-[0_0_12px_rgba(255,255,255,0.75)]"
      : estado === "pensando"
        ? "bg-[#8e8e93] animate-pulse"
        : estado === "erro"
          ? "bg-[#ff453a] shadow-[0_0_12px_rgba(255,69,58,0.8)]"
          : "bg-[#2c2c2e]";

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-[#f2f2f7] select-none">
      <span className={`fixed top-[22px] left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full z-30 transition-all ${corPonto}`} />

      <div className="flex-1 min-h-0 grid place-items-center px-4 pt-6">
        {/* A animacao vai no PAI. No proprio elemento, o visualizador media a
            caixa durante o scale(.88) e o canvas ficava 12% ampliado pra sempre. */}
        <div className="w-[min(72vmin,560px)] aspect-square voz-entra">
          <div id="esfera-voz" className="w-full h-full" />
        </div>
      </div>

      {linha.texto ? (
        <p
          className={`fixed left-0 right-0 bottom-[110px] text-center px-[7vw] z-30 font-light leading-[1.4] tracking-[-0.01em] max-h-[24vh] overflow-hidden text-[clamp(16px,2.1vw,24px)] ${
            linha.cls === "parcial" ? "text-[#8e8e93]" : "text-[#f2f2f7]"
          }`}
        >
          {linha.texto}
        </p>
      ) : null}

      <p
        className={`fixed left-0 right-0 bottom-[86px] text-center z-30 text-[11px] tracking-[0.14em] uppercase text-[#48484a] transition-opacity duration-500 ${
          linha.texto ? "opacity-0" : "opacity-100"
        }`}
      >
        {escutaUI === "conversa"
          ? "escutando — pode falar"
          : escutaUI === "sentinela"
            ? `diga "oi ${nomeCurto}" — ou aperte o microfone`
            : "aperte o microfone e fale"}
      </p>

      <div className="fixed left-1/2 -translate-x-1/2 bottom-[18px] z-40 w-[min(92vw,760px)] h-14 rounded-[28px] bg-[#1c1c1e] flex items-center gap-1.5 pl-2.5 pr-2">
        <button
          type="button"
          onClick={onVerConversa}
          title="Ver a conversa"
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
            if (e.key === "Enter" && texto.trim()) {
              houveGesto.current = true;
              void destravarAudio(); // gesto do usuario: libera o som
              const v = texto.trim();
              setTexto("");
              setLinha({ texto: v, cls: "" });
              receber(v);
            }
          }}
          placeholder="Mensagem"
          autoComplete="off"
          enterKeyHint="send"
          className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[16px] text-[#f2f2f7] placeholder:text-[#8e8e93] px-1"
        />

        <button
          type="button"
          onClick={falar}
          title={
            escutaUI === "conversa"
              ? "Desligar o microfone"
              : `Conversar por voz — ou diga "oi ${nomeCurto}"`
          }
          aria-label={escutaUI === "conversa" ? "Desligar o microfone" : "Conversar por voz"}
          className={`shrink-0 h-9 w-9 rounded-full grid place-items-center transition-colors ${
            escutaUI === "conversa" ? "bg-[#f2f2f7] text-[#1c1c1e]" : "text-[#f2f2f7] hover:bg-[#2c2c2e]"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 18v4" />
            {escutaUI === "desligada" ? <path d="M3 3l18 18" /> : null}
          </svg>
        </button>

        <button
          type="button"
          onClick={onVerConversa}
          title={`Sair da voz — ${titulo}`}
          aria-label="Sair da voz"
          className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-[#3a3a3c] hover:bg-[#48484a] text-[#f2f2f7] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

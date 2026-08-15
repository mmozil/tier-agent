/**
 * Tela de voz do link público — a esfera de pó ocupando a tela, uma barra
 * embaixo e nada mais.
 *
 * Duas coisas mandam no comportamento:
 *
 * 1. **A esfera fica PARADA.** O giro dela não vem do relógio, vem do nível de
 *    voz (ver `PO_DEADZONE` no `optimus-viz.js`). Em silêncio ela não deriva.
 *
 * 2. **Chamar pelo nome é um comando.** "olá sr Carlos Drummond" acorda e ele se
 *    apresenta; "olá sr Carlos Drummond, tem período integral?" acorda E já leva
 *    a pergunta que veio depois do nome.
 *
 * O `SpeechSynthesis` não expõe o áudio pra análise, então enquanto ele fala a
 * esfera é alimentada pelo gerador de sílabas da própria biblioteca — não pela
 * saída real.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Viz = {
  simulate: (b: boolean) => void;
  setLevel: (v: number) => void;
  mount: (host: string | HTMLElement, id: string) => { destroy?: () => void };
  attachMic: () => Promise<unknown>;
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

// Carrega a biblioteca uma vez só, mesmo com StrictMode remontando.
let promessaViz: Promise<Viz | null> | null = null;
function carregarViz(): Promise<Viz | null> {
  if (window.OptimusViz) return Promise.resolve(window.OptimusViz);
  if (promessaViz) return promessaViz;
  promessaViz = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "/optimus-viz.js";
    s.async = true;
    s.onload = () => resolve(window.OptimusViz ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return promessaViz;
}

function semAcento(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Como o nome do agente pode ser dito em voz alta. */
function termosDoNome(nome: string): string[] {
  const limpo = semAcento(nome).replace(/[^a-z0-9\s]/g, " ").trim();
  const partes = limpo.split(/\s+/).filter((p) => p.length > 1);
  const t = [limpo];
  if (partes.length) t.push(partes[partes.length - 1]); // "drummond"
  // "M7" sai da transcrição como "eme sete" / "m sete" com frequência
  if (/^m\s?7$/.test(limpo)) t.push("eme sete", "m sete", "m7");
  return Array.from(new Set(t.filter(Boolean)));
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
  ultimaResposta: { texto: string; id: number } | null;
  onEnviar: (texto: string) => void;
  onVerConversa: () => void;
}) {
  const [estado, setEstado] = useState<Estado>("repouso");
  const [linha, setLinha] = useState<{ texto: string; cls: string }>({ texto: "", cls: "" });
  const [texto, setTexto] = useState("");
  const [ouvindo, setOuvindo] = useState(false);
  const [dicaOff, setDicaOff] = useState(false);

  const vizRef = useRef<Viz | null>(null);
  const recRef = useRef<any>(null);
  const micLigado = useRef(false);
  const termos = useRef<string[]>(termosDoNome(agente));

  useEffect(() => {
    termos.current = termosDoNome(agente);
  }, [agente]);

  // ── a esfera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let inst: { destroy?: () => void } | null = null;
    let vivo = true;
    carregarViz().then((v) => {
      if (!vivo || !v) return;
      vizRef.current = v;
      v.simulate(false);
      inst = v.mount("#esfera-voz", "po");
      v.setLevel(0); // parada de verdade
    });
    return () => {
      vivo = false;
      inst?.destroy?.();
    };
  }, []);

  const aplicarEstado = useCallback((e: Estado) => {
    setEstado(e);
    const v = vizRef.current;
    if (!v) return;
    if (e === "falando" || e === "pensando") v.simulate(true);
    else if (e !== "ouvindo") {
      v.simulate(false);
      v.setLevel(0);
    }
  }, []);

  useEffect(() => {
    if (pensando) aplicarEstado("pensando");
  }, [pensando, aplicarEstado]);

  // ── o agente fala a resposta que chegou ───────────────────────────────
  const respostaTexto = ultimaResposta?.texto ?? "";
  const respostaId = ultimaResposta?.id ?? 0;
  useEffect(() => {
    if (!respostaTexto) return;
    setLinha({ texto: respostaTexto, cls: "resposta" });
    aplicarEstado("falando");

    if (!("speechSynthesis" in window)) {
      const id = setTimeout(() => aplicarEstado("repouso"), 2600);
      return () => clearTimeout(id);
    }
    const u = new SpeechSynthesisUtterance(respostaTexto);
    u.lang = "pt-BR";
    u.rate = 1.04;
    const vs = speechSynthesis.getVoices().filter((v) => /pt[-_]BR/i.test(v.lang));
    if (vs.length) u.voice = vs[0];
    u.onend = () => aplicarEstado("repouso");
    u.onerror = () => aplicarEstado("repouso");
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return () => speechSynthesis.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostaId, aplicarEstado]);

  // ── separa a invocação da pergunta ────────────────────────────────────
  const receber = useCallback(
    (txt: string) => {
      const alvo = semAcento(txt);
      for (const termo of termos.current) {
        const pos = alvo.indexOf(termo);
        if (pos < 0) continue;
        const resto = txt.slice(pos + termo.length).replace(/^[\s,.!?;:-]+/, "").trim();
        if (resto) {
          onEnviar(resto);
          return;
        }
        // chamou e não perguntou nada: ele só se apresenta
        setLinha({ texto: `Sim, sou ${agente}, atendente virtual. Em que posso ajudar?`, cls: "resposta" });
        aplicarEstado("falando");
        if ("speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(`Sim, sou ${agente}, atendente virtual. Em que posso ajudar?`);
          u.lang = "pt-BR";
          u.rate = 1.04;
          u.onend = () => aplicarEstado("repouso");
          u.onerror = () => aplicarEstado("repouso");
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        } else {
          setTimeout(() => aplicarEstado("repouso"), 2400);
        }
        return;
      }
      onEnviar(txt);
    },
    [agente, onEnviar, aplicarEstado],
  );

  // ── reconhecimento de fala ────────────────────────────────────────────
  useEffect(() => {
    const SR = (window.SpeechRecognition || window.webkitSpeechRecognition) as any;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      setOuvindo(true);
      aplicarEstado("ouvindo");
      setLinha({ texto: "", cls: "" });
    };
    rec.onresult = (ev: any) => {
      let parcial = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        else parcial += ev.results[i][0].transcript;
      }
      if (final) {
        setLinha({ texto: final, cls: "" });
        receber(final);
      } else if (parcial) {
        setLinha({ texto: parcial, cls: "parcial" });
      }
    };
    rec.onerror = (e: any) => {
      setOuvindo(false);
      if (e.error === "no-speech") {
        aplicarEstado("repouso");
        setLinha({ texto: "", cls: "" });
        return;
      }
      aplicarEstado("erro");
      setLinha({ texto: e.error === "not-allowed" ? "microfone bloqueado" : `erro: ${e.error}`, cls: "" });
      setTimeout(() => {
        aplicarEstado("repouso");
        setLinha({ texto: "", cls: "" });
      }, 2600);
    };
    rec.onend = () => {
      setOuvindo(false);
      setEstado((s) => (s === "ouvindo" ? "repouso" : s));
    };
    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* ignora */
      }
      recRef.current = null;
    };
  }, [receber, aplicarEstado]);

  const falar = useCallback(() => {
    const rec = recRef.current;
    if (ouvindo) {
      try {
        rec?.stop();
      } catch {
        /* ignora */
      }
      return;
    }
    if (estado === "pensando" || estado === "falando") return;
    setDicaOff(true);
    if (!rec) return;
    const seguir = () => {
      try {
        rec.start();
      } catch {
        /* ja rodando */
      }
    };
    const v = vizRef.current;
    if (v && !micLigado.current) {
      v.attachMic()
        .then(() => {
          micLigado.current = true;
          seguir();
        })
        .catch(seguir);
    } else seguir();
  }, [ouvindo, estado]);

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
        <div id="esfera-voz" className="w-[min(72vmin,560px)] aspect-square voz-entra" />
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
          dicaOff || linha.texto ? "opacity-0" : "opacity-100"
        }`}
      >
        chame por {agente} ou aperte o microfone
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
              const v = texto.trim();
              setTexto("");
              setDicaOff(true);
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
          title={ouvindo ? "Parar" : "Falar"}
          aria-label={ouvindo ? "Parar" : "Falar"}
          className={`shrink-0 h-9 w-9 rounded-full grid place-items-center transition-colors ${
            ouvindo ? "bg-[#f2f2f7] text-[#1c1c1e]" : "text-[#f2f2f7] hover:bg-[#2c2c2e]"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 18v4" />
            {!ouvindo ? <path d="M3 3l18 18" /> : null}
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

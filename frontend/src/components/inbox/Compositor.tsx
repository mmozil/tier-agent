import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

/** Os emojis que mais aparecem em atendimento de escola — o «recentes» do WhatsApp. */
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋",
  "😎", "🤩", "🥳", "🤗", "🤔", "🤭", "😐", "🙄", "😏", "😬", "😌", "😔", "😴", "😷", "🤒", "😢",
  "😭", "😤", "😡", "😱", "😳", "🥺", "🙏", "👍", "👎", "👌", "✌️", "🤞", "👏", "🙌", "💪", "👋",
  "🤝", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💯", "✅", "❌", "⚠️", "⭐", "🌟", "✨", "🎉",
  "🎊", "🎁", "🎂", "🎈", "📚", "📖", "✏️", "📝", "📅", "📌", "📎", "📞", "📱", "💻", "🏫", "🎒",
  "🚌", "⏰", "☀️", "🌈", "☕", "🍎", "⚽", "🏊",
];

const BOTAO = "h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.06] disabled:opacity-40";
export const BOTAO_COMPOSITOR = BOTAO;

export function EmojiBotao({ onEscolher }: { onEscolher: (emoji: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);
  return (
    <div ref={ref} className="relative">
      <button type="button" title="Emoji" onClick={() => setAberto((a) => !a)} className={BOTAO}>
        <Smile className="w-4 h-4" />
      </button>
      {aberto && (
        <div className="absolute bottom-10 left-0 z-50 w-[296px] max-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-[#14171c] grid grid-cols-8 gap-0.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onEscolher(e)}
              className="h-8 w-8 rounded-md text-[19px] leading-none hover:bg-slate-100 dark:hover:bg-white/[0.08]"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Formatos que o navegador sabe gravar, na ordem de preferência. O servidor
 *  converte qualquer um deles em mensagem de voz do WhatsApp (ogg/opus). */
const FORMATOS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
const LIMITE_SEGUNDOS = 15 * 60;

export interface Gravacao {
  blob: Blob;
  nome: string;
}

/** O microfone da caixa de resposta: grava, mostra o tempo, cancela ou entrega o áudio. */
export function useGravadorVoz() {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const fluxo = useRef<MediaStream | null>(null);
  const relogio = useRef<number | null>(null);
  const aoParar = useRef<((g: Gravacao | null) => void) | null>(null);

  function soltar() {
    if (relogio.current) window.clearInterval(relogio.current);
    relogio.current = null;
    fluxo.current?.getTracks().forEach((t) => t.stop());
    fluxo.current = null;
    rec.current = null;
    setGravando(false);
    setSegundos(0);
  }

  useEffect(() => () => soltar(), []);

  async function iniciar(): Promise<string | null> {
    if (gravando) return null;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return "Este navegador não grava áudio.";
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return "Sem permissão para usar o microfone.";
    }
    const mime = FORMATOS.find((f) => MediaRecorder.isTypeSupported(f));
    const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    pedacos.current = [];
    r.ondataavailable = (e) => e.data.size > 0 && pedacos.current.push(e.data);
    r.onstop = () => {
      const tipo = r.mimeType || mime || "audio/webm";
      const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(pedacos.current, { type: tipo });
      const fim = aoParar.current;
      aoParar.current = null;
      soltar();
      fim?.(blob.size > 0 ? { blob, nome: `voz.${ext}` } : null);
    };
    fluxo.current = stream;
    rec.current = r;
    r.start(250);
    setGravando(true);
    setSegundos(0);
    relogio.current = window.setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= LIMITE_SEGUNDOS) rec.current?.state === "recording" && rec.current.stop();
        return s + 1;
      });
    }, 1000);
    return null;
  }

  /** Para e devolve o áudio (ou null se não gravou nada). */
  function parar(): Promise<Gravacao | null> {
    return new Promise((resolve) => {
      if (!rec.current || rec.current.state !== "recording") {
        soltar();
        resolve(null);
        return;
      }
      aoParar.current = resolve;
      rec.current.stop();
    });
  }

  function cancelar() {
    aoParar.current = null;
    if (rec.current && rec.current.state === "recording") {
      rec.current.onstop = null;
      rec.current.stop();
    }
    soltar();
  }

  return { gravando, segundos, iniciar, parar, cancelar };
}

export function tempo(seg: number): string {
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}

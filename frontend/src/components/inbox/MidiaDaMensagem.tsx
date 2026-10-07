import { FileText, ImageOff } from "lucide-react";

/** Anexo gravado na mensagem (`ta_message_log.attachments_json`). */
export interface Anexo {
  kind: string; // image | audio | video | document | sticker | link
  url: string | null;
  mime?: string | null;
  /** nome do arquivo (documento) */
  name?: string | null;
  /** capinha do link — o que o WhatsApp desenha em cima do texto */
  title?: string | null;
  description?: string | null;
  thumb?: string | null;
  /** mídia que chegou mas não baixou (07/10/2026: antes sumia sem rastro) */
  erro?: string | null;
}

const NOME_DO_TIPO: Record<string, string> = {
  image: "Foto",
  sticker: "Figurinha",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
};

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Capinha do link no formato do WhatsApp: miniatura, título, descrição e o site. */
function Capinha({ a, escuro }: { a: Anexo; escuro: boolean }) {
  if (!a.url) return null;
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer noopener"
      className={`flex gap-2.5 mb-1.5 rounded-lg overflow-hidden no-underline ${
        escuro ? "bg-white/[0.14] hover:bg-white/[0.2]" : "bg-black/[0.05] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      } transition-colors`}
    >
      {a.thumb && <img src={a.thumb} alt="" className="w-[72px] min-h-[72px] object-cover shrink-0" />}
      <span className={`min-w-0 py-2 ${a.thumb ? "pr-2.5" : "px-2.5"}`}>
        <span className="block text-[12.5px] font-semibold leading-snug line-clamp-2">{a.title || dominio(a.url)}</span>
        {a.description && <span className="block text-[12px] leading-snug opacity-75 line-clamp-2 mt-0.5">{a.description}</span>}
        <span className="block text-[11px] opacity-60 mt-0.5 truncate">{dominio(a.url)}</span>
      </span>
    </a>
  );
}

/** Mídia da mensagem dentro do balão — igual ao WhatsApp, para a atendente se achar. */
export default function MidiaDaMensagem({ midia, escuro = false }: { midia: Anexo[]; escuro?: boolean }) {
  return (
    <>
      {midia.map((a, i) => {
        if (a.kind === "link") return <Capinha key={i} a={a} escuro={escuro} />;
        if (!a.url || a.erro) {
          return (
            <span key={i} className="flex items-center gap-1.5 text-[12.5px] italic opacity-70 mb-1">
              <ImageOff className="w-3.5 h-3.5 shrink-0" />
              {NOME_DO_TIPO[a.kind] || "Arquivo"} recebido, mas não foi possível baixar
            </span>
          );
        }
        if (a.kind === "image") {
          return (
            <img
              key={i}
              src={a.url}
              alt=""
              loading="lazy"
              onClick={() => window.open(a.url!, "_blank")}
              className="rounded-lg max-w-full max-h-60 object-cover mb-1 cursor-pointer"
            />
          );
        }
        if (a.kind === "sticker") {
          return <img key={i} src={a.url} alt="Figurinha" loading="lazy" className="w-32 h-32 object-contain mb-1" />;
        }
        if (a.kind === "audio") return <audio key={i} controls preload="none" src={a.url} className="max-w-full mb-1" />;
        if (a.kind === "video") {
          return <video key={i} controls preload="metadata" src={a.url} className="rounded-lg max-w-full max-h-60 mb-1" />;
        }
        return (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer noopener"
            className={`flex items-center gap-2 mb-1 rounded-lg px-2.5 py-2 text-[12.5px] no-underline ${
              escuro ? "bg-white/[0.14] hover:bg-white/[0.2]" : "bg-black/[0.05] hover:bg-black/[0.08] dark:bg-white/[0.06]"
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span className="truncate">{a.name || NOME_DO_TIPO[a.kind] || "Documento"}</span>
          </a>
        );
      })}
    </>
  );
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const PONTA = /[.,;:!?)\]}'"»]+$/;

/** Transforma os links do texto em clicáveis (o WhatsApp faz isso). */
export function linkificar(texto: string, chave: string): (string | JSX.Element)[] {
  const saida: (string | JSX.Element)[] = [];
  let ultimo = 0;
  let k = 0;
  for (const m of texto.matchAll(URL_RE)) {
    const bruto = m[0];
    const sobra = bruto.match(PONTA)?.[0] || "";
    const url = bruto.slice(0, bruto.length - sobra.length);
    const ini = m.index ?? 0;
    if (ini > ultimo) saida.push(texto.slice(ultimo, ini));
    saida.push(
      <a
        key={`${chave}-${k++}`}
        href={url.toLowerCase().startsWith("www.") ? `https://${url}` : url}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 break-all"
      >
        {url}
      </a>,
    );
    if (sobra) saida.push(sobra);
    ultimo = ini + bruto.length;
  }
  if (ultimo < texto.length) saida.push(texto.slice(ultimo));
  return saida;
}

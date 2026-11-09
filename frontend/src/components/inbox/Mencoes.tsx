/**
 * Marcar alguém com «@» na nota interna (09/11/2026, M7).
 *
 * Pedido do dono: «validar as menções @, e nas notas internas também». A nota tinha uma
 * fileira com TODAS as pessoas da conta (18 na M7) em botões «@Nome», sem foto, e digitar
 * «@» no texto não fazia nada. Agora é o gesto que todo mundo conhece (WhatsApp, Slack):
 * digita «@», abre a lista com foto e cargo, filtra enquanto digita, Enter ou clique marca.
 * Quem foi marcado aparece em etiquetas com foto (tira no «×»). O servidor já avisava cada
 * marcado e punha a conversa na pasta «Menções» dele — isso não muda.
 */
import { useState, type RefObject } from "react";
import { X } from "lucide-react";

export type PessoaMencao = { id: number; nome: string; cargo?: string | null; avatar_url?: string | null; online?: boolean };

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** «Marisa Graciano Souza» → «Marisa Graciano»: o que vai no texto da nota. */
const curto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(" ");

export function MiniAvatar({ nome, url, online, tam = 22 }: { nome: string; url?: string | null; online?: boolean; tam?: number }) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] || "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tam, height: tam }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="inline-flex h-full w-full items-center justify-center rounded-full bg-[#003083]/[0.08] font-semibold leading-none text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#5b9bff]"
          style={{ fontSize: Math.round(tam * 0.42) }}
        >
          {ini}
        </span>
      )}
      {online && (
        <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-[#16a34a] ring-2 ring-white dark:ring-[#14171c]" title="Online" />
      )}
    </span>
  );
}

/** Estado e teclado da lista de «@». `teclado` devolve true quando tratou a tecla (Enter não envia). */
export function useMencoes({
  ativo,
  texto,
  setTexto,
  taRef,
  pessoas,
  setMarcadas,
}: {
  ativo: boolean;
  texto: string;
  setTexto: (t: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  pessoas: PessoaMencao[];
  setMarcadas: (f: (prev: number[]) => number[]) => void;
}) {
  const [consulta, setConsulta] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);

  /** Lê o «@algo» logo antes do cursor. Chamar depois de cada mudança de texto ou de cursor. */
  function atualizar() {
    const ta = taRef.current;
    if (!ativo || !ta) {
      setConsulta(null);
      return;
    }
    const ate = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
    const m = ate.match(/(?:^|\s)@([^\s@]{0,30})$/);
    setConsulta(m ? m[1] : null);
    setIdx(0);
  }

  const termo = semAcento(consulta ?? "");
  const lista =
    consulta === null
      ? []
      : pessoas
          .filter((p) => semAcento(p.nome).split(/\s+/).some((parte) => parte.startsWith(termo)) || semAcento(p.nome).includes(termo))
          .slice(0, 7);

  function escolher(p: PessoaMencao) {
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? texto.length;
    const antes = texto.slice(0, pos).replace(/@([^\s@]{0,30})$/, `@${curto(p.nome)} `);
    setTexto(antes + texto.slice(pos));
    setMarcadas((prev) => (prev.includes(p.id) ? prev : [...prev, p.id]));
    setConsulta(null);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(antes.length, antes.length);
    });
  }

  function teclado(e: { key: string; preventDefault: () => void }): boolean {
    if (!ativo || consulta === null || lista.length === 0) return false;
    if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, lista.length - 1));
    else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" || e.key === "Tab") escolher(lista[Math.min(idx, lista.length - 1)]);
    else if (e.key === "Escape") setConsulta(null);
    else return false;
    e.preventDefault();
    return true;
  }

  return { aberta: ativo && consulta !== null && lista.length > 0, lista, idx, setIdx, escolher, teclado, atualizar };
}

/** A lista que abre acima da caixa de texto. */
export function ListaDeMencoes({
  lista,
  idx,
  setIdx,
  escolher,
}: {
  lista: PessoaMencao[];
  idx: number;
  setIdx: (i: number) => void;
  escolher: (p: PessoaMencao) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Marcar alguém"
      className="absolute bottom-full left-0 z-40 mb-2 w-[300px] max-w-full overflow-hidden rounded-[12px] border border-[#EDEDED] bg-white p-1 shadow-[0_10px_32px_rgba(0,0,0,0.12)] dark:border-[#23272e] dark:bg-[#14171c]"
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[#262626]/45 dark:text-[#6b7280]">
        Marcar na nota
      </p>
      {lista.map((p, i) => (
        <button
          key={p.id}
          type="button"
          role="option"
          aria-selected={i === idx}
          onMouseEnter={() => setIdx(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // não tira o foco da caixa de texto
            escolher(p);
          }}
          className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors ${
            i === idx ? "bg-[#003083]/[0.07] dark:bg-[#5b9bff]/[0.12]" : ""
          }`}
        >
          <MiniAvatar nome={p.nome} url={p.avatar_url} online={p.online} tam={26} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[#262626] dark:text-[#e6e8eb]">{p.nome}</span>
            {p.cargo && <span className="block truncate text-[11.5px] text-[#262626]/50 dark:text-[#8b93a0]">{p.cargo}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** As pessoas marcadas, com foto, para tirar no «×». */
export function EtiquetasDeMencao({
  pessoas,
  marcadas,
  tirar,
}: {
  pessoas: PessoaMencao[];
  marcadas: number[];
  tirar: (id: number) => void;
}) {
  const quem = marcadas.map((id) => pessoas.find((p) => p.id === id)).filter((p): p is PessoaMencao => !!p);
  if (!quem.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11.5px] text-[#262626]/50 dark:text-[#8b93a0]">Avisar:</span>
      {quem.map((p) => (
        <span
          key={p.id}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 pl-1 pr-1.5 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <MiniAvatar nome={p.nome} url={p.avatar_url} tam={20} />
          {curto(p.nome)}
          <button type="button" onClick={() => tirar(p.id)} className="rounded-full p-0.5 hover:bg-amber-200/60 dark:hover:bg-amber-500/20" title={`Não avisar ${curto(p.nome)}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

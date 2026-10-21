/**
 * Editar uma mensagem já enviada (21/10/2026) — como no WhatsApp: passa o mouse no
 * balão, clica no lápis, troca o texto; o contato vê o novo com «Editada». Só a
 * resposta que a própria pessoa mandou pelo painel, de texto, até 15 minutos
 * depois do envio (o WhatsApp não aceita depois). O servidor confere tudo de novo.
 */
import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { FC } from "@/components/ds/fc";

/** Mesma margem do servidor (14 min 30 s): passar do prazo no WhatsApp é silencioso. */
export const JANELA_EDICAO_MS = (14 * 60 + 30) * 1000;

/** Hora do Agent vem sem fuso e é UTC — sem o «Z» o navegador leria como local. */
export function horaUtc(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const temFuso = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  return new Date(temFuso ? iso : `${iso}Z`).getTime();
}

export function podeEditarMensagem(
  m: {
    role: string;
    wa_message_id?: string | null;
    wa_from_me?: boolean | null;
    member_id?: number | null;
    attachments_json?: unknown[] | null;
    created_at: string;
  },
  meuMemberId: number | null | undefined,
  agora: number = Date.now(),
): boolean {
  if (m.role !== "agent" || !m.wa_message_id || !m.wa_from_me) return false;
  if (!meuMemberId || m.member_id !== meuMemberId) return false;
  if (m.attachments_json && m.attachments_json.length > 0) return false;
  const enviada = horaUtc(m.created_at);
  return Number.isFinite(enviada) && agora - enviada <= JANELA_EDICAO_MS;
}

/** O lápis que aparece ao passar o mouse no balão (o pai tem `group`). */
export function BotaoEditar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Editar mensagem"
      aria-label="Editar mensagem"
      className={`absolute -top-3 left-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border ${FC.hair} bg-white text-[#3c4257] shadow-[0_2px_8px_rgba(0,0,0,0.08)] opacity-0 pointer-events-none transition-opacity hover:text-[#003083] focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto dark:bg-[#16191f] dark:text-slate-300 dark:hover:text-[#8ab4ff]`}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

/** O campo que entra no lugar do texto do balão enquanto se edita. */
export function EditorDoBalao({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial: string;
  onSalvar: (texto: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const salvar = async () => {
    const limpo = texto.trim();
    if (!limpo || salvando) return;
    if (limpo === inicial.trim()) {
      onCancelar();
      return;
    }
    setSalvando(true);
    try {
      await onSalvar(limpo);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex min-w-[260px] flex-col gap-2">
      <textarea
        ref={ref}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancelar();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void salvar();
          }
        }}
        rows={Math.min(8, Math.max(2, texto.split("\n").length))}
        maxLength={4000}
        className="w-full resize-none rounded-lg bg-white/95 px-2.5 py-2 text-[13px] leading-relaxed text-[#1a1f36] outline-none focus:ring-2 focus:ring-white/60 dark:bg-[#0c0e12] dark:text-slate-100"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] opacity-80">Enter salva · Esc cancela</span>
        <button
          type="button"
          onClick={onCancelar}
          disabled={salvando}
          className="h-6 rounded-md px-2 text-[11px] font-medium opacity-90 hover:bg-white/15 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando || !texto.trim()}
          className="h-6 rounded-md bg-white px-2.5 text-[11px] font-semibold text-[#003083] hover:bg-white/90 disabled:opacity-50 dark:bg-[#0c0e12] dark:text-[#8ab4ff]"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

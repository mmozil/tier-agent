import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Zap, Plus, Trash2, X, Pencil } from "lucide-react";

import { api } from "@/lib/api";

interface Canned {
  id: number;
  shortcut: string;
  content: string;
}

export default function CannedPicker({ onInsert }: { onInsert: (content: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Canned[]>([]);
  const [creating, setCreating] = useState(false);
  // 14/11/2026 — editar a resposta salva (antes só dava para criar e apagar). O mesmo
  // formulário da «Nova resposta», preenchido; salvar grava por cima (PUT).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const { data } = await api.get<Canned[]>("/canned-responses");
      setItems(data);
    } catch {
      /* silencioso */
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setEditingId(null);
        setShortcut("");
        setContent("");
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function fecharForm() {
    setCreating(false);
    setEditingId(null);
    setShortcut("");
    setContent("");
  }

  function editar(it: Canned) {
    setEditingId(it.id);
    setShortcut(it.shortcut);
    setContent(it.content);
    setCreating(true);
  }

  async function salvar() {
    const s = shortcut.trim();
    const c = content.trim();
    if (!s || !c) return;
    try {
      if (editingId != null) {
        const { data } = await api.put<Canned>(`/canned-responses/${editingId}`, { shortcut: s, content: c });
        setItems((prev) => prev.map((i) => (i.id === data.id ? data : i)));
        toast.success("Resposta pronta atualizada");
      } else {
        await api.post("/canned-responses", { shortcut: s, content: c });
        load();
        toast.success("Resposta pronta salva");
      }
      fecharForm();
    } catch {
      toast.error("Erro ao salvar");
    }
  }

  async function remove(id: number) {
    try {
      await api.delete(`/canned-responses/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      toast.error("Erro ao excluir");
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Respostas prontas"
        className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
      >
        <Zap className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute bottom-11 right-0 w-[320px] bg-white rounded-xl shadow-lg ring-1 ring-black/5 z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-800">Respostas prontas</span>
            <button onClick={() => setOpen(false)} className="h-8 px-1 rounded text-slate-400 hover:bg-slate-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            {items.length === 0 && !creating && (
              <p className="px-3 py-5 text-center text-[12px] text-slate-400">
                Nenhuma resposta pronta ainda.
              </p>
            )}
            {items.map((it) => (
              <div key={it.id} className="group flex items-start gap-2 px-3 py-2 hover:bg-slate-50 border-b border-slate-50">
                <button
                  onClick={() => {
                    onInsert(it.content);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-[12px] font-medium text-[#003083]">/{it.shortcut}</span>
                  <p className="text-[12px] text-slate-600 line-clamp-2">{it.content}</p>
                </button>
                <button
                  onClick={() => editar(it)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-8 px-1 rounded text-slate-300 hover:text-[#003083] hover:bg-slate-100"
                  title="Editar"
                  aria-label={`Editar /${it.shortcut}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(it.id)}
                  className="opacity-0 group-hover:opacity-100 h-8 px-1 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {creating ? (
            <div className="p-3 border-t border-slate-100 space-y-2 bg-slate-50/60">
              {editingId != null && (
                <div className="text-[11px] font-medium text-slate-500">Editando a resposta</div>
              )}
              <input
                value={shortcut}
                onChange={(e) => setShortcut(e.target.value)}
                placeholder="atalho (ex: horario)"
                className="w-full h-7 px-2 text-[12px] rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083]"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="texto da resposta…"
                className="w-full px-2 py-1.5 text-[12px] rounded-md border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083] resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={salvar}
                  className="h-8 px-3 text-[12px] rounded-md bg-[#003083] text-white hover:bg-[#002266]"
                >
                  Salvar
                </button>
                <button
                  onClick={fecharForm}
                  className="h-8 px-3 text-[12px] rounded-md text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                fecharForm();
                setCreating(true);
              }}
              className="w-full h-8 px-3 text-[12px] text-[#003083] font-medium hover:bg-slate-50 inline-flex items-center justify-center gap-1 border-t border-slate-100"
            >
              <Plus className="w-3.5 h-3.5" /> Nova resposta
            </button>
          )}
        </div>
      )}
    </div>
  );
}

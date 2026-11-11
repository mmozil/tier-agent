// Balão do modelo como o contato vê no WhatsApp (11/11/2026). Usado em Canais › Modelos e na Nova conversa.

/** Balão como o contato vê no WhatsApp. */
export default function BalaoDoModelo({ corpo, rodape, botoes }: { corpo: string; rodape?: string; botoes?: string[] }) {
  return (
    <div className="rounded-xl bg-[#e7f7e1] dark:bg-[#1f3a2c] px-3 py-2 text-[13px] leading-5 text-[#111b21] dark:text-[#e9edef] max-w-[360px] shadow-sm">
      <p className="whitespace-pre-wrap break-words">{corpo || <span className="opacity-50">O texto aparece aqui…</span>}</p>
      {rodape && <p className="mt-1 text-[11.5px] opacity-60">{rodape}</p>}
      {!!botoes?.length && (
        <div className="mt-2 -mx-3 border-t border-black/10 dark:border-white/10">
          {botoes.map((b, i) => (
            <div key={i} className="py-1.5 text-center text-[12.5px] font-medium text-[#027eb5] dark:text-[#53bdeb] border-b border-black/5 dark:border-white/5 last:border-b-0">
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

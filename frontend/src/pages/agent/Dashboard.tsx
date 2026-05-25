export default function Dashboard() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[18px] font-medium text-slate-800">
              tier<span className="text-tier">.</span>
            </span>
            <span className="text-[13px] text-slate-500">agent</span>
          </div>
          <div className="text-[13px] text-slate-500">Dashboard (placeholder)</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-[24px] font-medium text-slate-900 mb-2">Meu agente</h1>
        <p className="text-[14px] text-slate-600 mb-6">
          Aqui você vai configurar persona, canais, conhecimento e métricas. Próxima fase implementa.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {["Persona", "Canais", "Knowledge", "Conversas", "Skills", "Configurações"].map((s) => (
            <div key={s} className="rounded-xl bg-white border border-slate-200 p-5">
              <div className="text-[14px] font-medium text-slate-900">{s}</div>
              <div className="text-[12px] text-slate-500 mt-1">Em construção</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

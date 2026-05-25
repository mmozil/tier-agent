import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-7 w-auto" />
          <nav className="flex items-center gap-3">
            <Link to="/login" className="text-[13px] text-slate-600 hover:text-slate-900">
              Entrar
            </Link>
            <Link
              to="/signup"
              className="text-[13px] bg-tier hover:bg-tier-dark text-white px-3 h-8 inline-flex items-center rounded-md"
            >
              Criar agente
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-4xl mx-auto px-6 py-20 text-center">
          <img
            src="/tier-agent-escuro.png"
            alt="Tier Agent"
            className="h-12 w-auto mx-auto mb-8"
          />
          <h1 className="text-[40px] leading-tight font-medium tracking-tight text-slate-900">
            Seu funcionário digital, em qualquer canal.
          </h1>
          <p className="mt-4 text-[16px] text-slate-600 max-w-2xl mx-auto">
            Crie um agente que atende WhatsApp, e-mail e Telegram. Ele lembra, planeja, age sozinho e aprende com cada
            conversa.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/signup"
              className="bg-tier hover:bg-tier-dark text-white px-5 h-10 inline-flex items-center rounded-md text-[14px] font-medium"
            >
              Começar grátis
            </Link>
            <Link
              to="/login"
              className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 h-10 inline-flex items-center rounded-md text-[14px]"
            >
              Já tenho conta
            </Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: "Atendimento autônomo",
              desc: "Responde clientes 24/7 via WhatsApp, Telegram, e-mail e widget web.",
            },
            {
              title: "Memória que cresce",
              desc: "Lembra de cada conversa, perfil do cliente e contexto histórico.",
            },
            {
              title: "Conhecimento personalizado",
              desc: "Upload de PDFs, planilhas e catálogos. Agente aprende dos seus dados.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl bg-white border border-slate-200 p-5">
              <h3 className="text-[15px] font-medium text-slate-900">{f.title}</h3>
              <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <div className="max-w-6xl mx-auto px-6 text-[12px] text-slate-500 flex items-center justify-between">
          <span>© 2026 Tier Finance</span>
          <a href="https://tier.finance" className="hover:text-slate-700">
            tier.finance
          </a>
        </div>
      </footer>
    </div>
  );
}

/* Exclusão de Dados — Tier Agent (pública, exigida pelo App Review da Meta) */

export default function DataDeletion() {
  return (
    <div className="min-h-screen bg-white text-ink font-sans">
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <a href="/" className="text-[13px] text-accent hover:underline">← tier.finance</a>
        <h1 className="mt-6 font-display text-[32px] font-semibold tracking-display">Exclusão de Dados</h1>
        <p className="mt-2 text-[13px] text-[#6A7385]">Tier Agent · atualizado em 29/05/2026</p>

        <div className="mt-10 space-y-8 text-[14px] leading-relaxed text-[#3a3f47]">
          <section>
            <h2 className="text-[17px] font-semibold text-ink">Como solicitar a exclusão dos seus dados</h2>
            <p className="mt-2">
              Você tem o direito de solicitar a exclusão dos seus dados pessoais tratados pelo Tier Agent
              (mensagens trocadas, nome e número de telefone), conforme a LGPD.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-ink">Passo a passo</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              <li>Envie um e-mail para <strong>privacidade@tier.finance</strong> com o assunto "Exclusão de Dados".</li>
              <li>Informe o número de WhatsApp usado na conversa (para localizarmos seus dados).</li>
              <li>Confirmaremos o recebimento em até 48 horas úteis.</li>
              <li>A exclusão é concluída em até 15 dias, e você recebe a confirmação por e-mail.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-ink">O que é excluído</h2>
            <p className="mt-2">
              Todo o histórico de mensagens, dados de contato e contexto de conversa associados ao seu número
              são removidos definitivamente dos nossos sistemas, exceto registros que a lei exija reter.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold text-ink">Contato</h2>
            <p className="mt-2">
              Encarregado de Dados (DPO): <strong>privacidade@tier.finance</strong> · Site: https://tier.finance
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

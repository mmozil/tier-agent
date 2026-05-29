/* Política de Privacidade — Tier Agent (pública, exigida pelo App Review da Meta) */

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "1. Quem somos",
    p: [
      "O Tier Agent é uma plataforma de atendimento automatizado por inteligência artificial operada pela Tier (\"Tier\", \"nós\"). Permite que empresas atendam seus clientes via WhatsApp e outros canais por meio de agentes de IA configuráveis.",
      "Esta política descreve como tratamos dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018).",
    ],
  },
  {
    h: "2. Dados que coletamos",
    p: [
      "Quando um usuário interage com um agente conectado via WhatsApp, podemos tratar: número de telefone, nome de exibição do WhatsApp, e o conteúdo das mensagens trocadas (texto, imagens, áudios e documentos enviados na conversa).",
      "Das empresas clientes, coletamos dados de cadastro (nome, e-mail, dados da conta) necessários para prestar o serviço.",
    ],
  },
  {
    h: "3. Como usamos os dados",
    p: [
      "Os dados das conversas são usados exclusivamente para processar e responder às mensagens por meio do agente de IA, manter o contexto do atendimento e melhorar a qualidade das respostas para a empresa cliente.",
      "Não vendemos dados pessoais e não usamos o conteúdo das conversas para finalidade diversa do atendimento contratado pela empresa cliente.",
    ],
  },
  {
    h: "4. Compartilhamento",
    p: [
      "Para operar o serviço, compartilhamos dados estritamente necessários com: a Meta Platforms (WhatsApp Business Platform / Cloud API), provedores de modelos de IA (LLM) para gerar as respostas, e provedores de infraestrutura em nuvem. Todos atuam como operadores, sob instruções da Tier e da empresa cliente.",
      "Podemos divulgar dados quando exigido por lei ou autoridade competente.",
    ],
  },
  {
    h: "5. Retenção e exclusão",
    p: [
      "Mantemos os dados pelo tempo necessário à prestação do serviço. A empresa cliente pode solicitar a exclusão dos dados a qualquer momento.",
      "Para solicitar a exclusão dos seus dados, consulte a página de Exclusão de Dados (/data-deletion) ou envie um e-mail para privacidade@tier.finance.",
    ],
  },
  {
    h: "6. Seus direitos (LGPD)",
    p: [
      "Você pode solicitar acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, além de revogar consentimento. Para exercer esses direitos, escreva para privacidade@tier.finance.",
    ],
  },
  {
    h: "7. Segurança",
    p: [
      "Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo criptografia de credenciais e controle de acesso. Apesar dos esforços, nenhum sistema é absolutamente seguro.",
    ],
  },
  {
    h: "8. Contato",
    p: [
      "Encarregado de Dados (DPO) / Privacidade: privacidade@tier.finance. Site: https://tier.finance.",
    ],
  },
];

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-ink font-sans">
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <a href="/" className="text-[13px] text-accent hover:underline">← tier.finance</a>
        <h1 className="mt-6 font-display text-[32px] font-semibold tracking-display">Política de Privacidade</h1>
        <p className="mt-2 text-[13px] text-[#6A7385]">Tier Agent · atualizado em 29/05/2026</p>

        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="text-[17px] font-semibold text-ink">{s.h}</h2>
              {s.p.map((para, i) => (
                <p key={i} className="mt-2 text-[14px] leading-relaxed text-[#3a3f47]">{para}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

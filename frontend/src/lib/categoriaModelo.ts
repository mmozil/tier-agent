// Análise da categoria de um modelo do WhatsApp oficial (14/11/2026).
//
// Pedido do dono: «acha que é de utilidade e depois a Meta aprova em marketing». Quem decide a
// categoria é a Meta, pelo TEXTO — e categoria de modelo aprovado não muda mais. Aqui a tela lê o
// texto, o rodapé e os botões enquanto a pessoa escreve e diz o que a Meta tende a fazer, com o
// motivo e o custo, ANTES de mandar para análise.
//
// Régua (a da Meta): Utilidade é sobre algo que a pessoa JÁ pediu ou fez — pedido, agendamento,
// pagamento, cadastro. Convite, oferta, novidade ou retomada de contato é Marketing. Texto
// misturado é Marketing. Sem sinal claro, a Meta tende a Marketing. É heurística: orienta, não
// garante — a decisão final continua sendo da Meta.

import { PRECO_POR_MENSAGEM } from "@/lib/disparos";

export type Categoria = "MARKETING" | "UTILITY";

export interface AnaliseCategoria {
  provavel: Categoria;
  /** true quando não há sinal nenhum — a Meta tende a Marketing, mas é palpite. */
  incerto: boolean;
  motivosMarketing: string[];
  motivosUtilidade: string[];
}

type Sinal = { re: RegExp; motivo: string };

// Cada sinal guarda o trecho para mostrar à pessoa de onde veio a leitura.
const MARKETING: Sinal[] = [
  { re: /promo[cç][aã]o|promocional/i, motivo: "fala de promoção" },
  { re: /desconto|\d+\s*%\s*(off|de desconto)?|cupom/i, motivo: "fala de desconto ou cupom" },
  { re: /\boferta|imperd[ií]vel|exclusiv[oa]s?\b/i, motivo: "faz oferta" },
  { re: /gr[aá]tis|gratuit[oa]|frete gr[aá]tis/i, motivo: "oferece algo grátis" },
  { re: /aproveite|n[aã]o perca|garanta (j[aá]|o seu|a sua|sua|seu)|[uú]ltimas vagas|vagas limitadas/i, motivo: "chama para aproveitar" },
  { re: /novidade|lan[cç]amento|chegou (a|o) nov|conhe[cç]a\b|confira\b|saiba mais/i, motivo: "apresenta novidade ou convida a conhecer" },
  { re: /\bconvid|venha (conhecer|visitar|nos visitar)|visite\b|fa[cç]a uma visita|agende (j[aá] )?(uma|sua) visita|marque (uma|sua) visita/i, motivo: "convida para visitar ou agendar" },
  { re: /matr[ií]culas? abertas?|inscri[cç][oõ]es abertas?/i, motivo: "divulga matrícula ou inscrição aberta" },
  { re: /(seu|o seu) interesse|demonstrou interesse|ainda (tem|est[aá]) interessad|procurando (uma )?escola/i, motivo: "retoma o contato de quem demonstrou interesse" },
  { re: /sentimos (sua|a sua) falta|volte a|faz tempo que|retom(ar|e) (o|seu) atendimento/i, motivo: "tenta reativar o contato" },
  { re: /black friday|liquida[cç][aã]o|queima de estoque/i, motivo: "campanha de venda" },
];

const MARKETING_BOTAO: Sinal[] = [
  { re: /saiba mais|ver ofertas?|comprar|quero (agendar|conhecer|saber)|conhecer|garantir|aproveitar/i, motivo: "botão de chamada para ação" },
];

const UTILIDADE: Sinal[] = [
  { re: /(seu|sua|o seu|a sua) (pedido|compra|pagamento|boleto|fatura|agendamento|consulta|visita|reserva|matr[ií]cula|cadastro|inscri[cç][aã]o)/i, motivo: "fala de algo que a pessoa já tem (pedido, agendamento, pagamento…)" },
  { re: /confirm(a[cç][aã]o|amos|ado|ada|ar)|est[aá] confirmad|foi confirmad/i, motivo: "confirma algo" },
  { re: /lembrete|lembrando que|amanh[aã] [aà]s|hoje [aà]s|dia \{\{\d+\}\} [aà]s/i, motivo: "lembra de um compromisso marcado" },
  { re: /(est[aá]|foi) (agendad|marcad|reagendad|cancelad|aprovad|recebid|enviad|entregue)/i, motivo: "informa o andamento de algo em curso" },
  { re: /rastreio|c[oó]digo de rastre|saiu para entrega|em tr[aâ]nsito|vencimento|vence (hoje|amanh[aã]|em)|recibo|nota fiscal|segunda via/i, motivo: "atualiza entrega, cobrança ou documento" },
];

const UTILIDADE_BOTAO: Sinal[] = [
  { re: /^(confirmar|reagendar|cancelar|ver pedido|rastrear|pagar|2[aª] via)/i, motivo: "botão de ação sobre o que já existe" },
];

function achar(sinais: Sinal[], texto: string): string[] {
  const out: string[] = [];
  for (const s of sinais) {
    const m = texto.match(s.re);
    if (m) out.push(`${s.motivo} («${m[0].trim()}»)`);
  }
  return out;
}

export function analisarCategoria(corpo: string, rodape = "", botoes: string[] = []): AnaliseCategoria {
  const texto = `${corpo || ""}\n${rodape || ""}`;
  const motivosMarketing = achar(MARKETING, texto);
  const motivosUtilidade = achar(UTILIDADE, texto);
  for (const b of botoes.filter(Boolean)) {
    motivosMarketing.push(...achar(MARKETING_BOTAO, b).map((m) => m.replace("(«", "(botão «")));
    motivosUtilidade.push(...achar(UTILIDADE_BOTAO, b).map((m) => m.replace("(«", "(botão «")));
  }
  // Misturado é Marketing (regra da Meta); sem sinal nenhum, tende a Marketing.
  if (motivosMarketing.length) return { provavel: "MARKETING", incerto: false, motivosMarketing, motivosUtilidade };
  if (motivosUtilidade.length) return { provavel: "UTILITY", incerto: false, motivosMarketing, motivosUtilidade };
  return { provavel: "MARKETING", incerto: true, motivosMarketing, motivosUtilidade };
}

export function precoDe(c: Categoria): number {
  return PRECO_POR_MENSAGEM[c] ?? 0;
}

export function reais(v: number, casas = 2): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Página «Disparos» (11/11/2026): tipos, rótulos e a conta de custo — usados pela lista, pelo
// novo disparo e pelo detalhe. O backend é `routes/disparos_oficiais.py`.

export type StatusDisparo = "rascunho" | "em_andamento" | "pausado" | "concluido" | "cancelado";
export type Situacao =
  | "pendente"
  | "enviando"
  | "enviado"
  | "entregue"
  | "lido"
  | "falhou"
  | "descadastrado"
  | "sem_nome"
  | "cancelado";

export interface Contagens {
  pendentes: number;
  /** Funil: enviados incluem entregues e lidos. */
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  descadastrados: number;
  sem_nome: number;
  cancelados: number;
  /** Contatos que mandaram mensagem na conversa depois do envio (12/11/2026). */
  respondidos?: number;
}

export interface Disparo {
  id: number;
  nome: string;
  status: StatusDisparo;
  motivo_pausa: string | null;
  modelo: string;
  idioma: string;
  categoria: string | null;
  connector_id: number;
  telefone: string | null;
  agente: string | null;
  numero_ativo: boolean | null;
  total: number;
  contagens: Contagens;
  intervalo_s: number;
  variacao_s: number;
  agendado_para: string | null;
  comeca_em: string | null;
  criado_por: string | null;
  criado_em: string | null;
  iniciado_em: string | null;
  pausado_em: string | null;
  concluido_em: string | null;
  cancelado_em: string | null;
}

export interface ModeloResumo {
  nome: string;
  status: string;
  categoria: string | null;
  idioma: string;
  corpo: string;
  rodape: string;
  cabecalho: string | null;
  cabecalho_midia: string | null;
  botoes: string[];
  variaveis: number;
}

export type Variavel = { fonte: "nome"; valor?: null } | { fonte: "fixo"; valor: string };

export interface DisparoDetalhe extends Disparo {
  modelo_resumo: ModeloResumo | null;
  variaveis: Variavel[];
}

export interface Envio {
  id: number;
  numero: string;
  nome: string | null;
  situacao: Situacao;
  motivo: string | null;
  enviado_em: string | null;
  status_em: string | null;
  conversation_id: number | null;
  /** Primeira mensagem do contato depois do envio (null = não respondeu). */
  respondeu_em?: string | null;
  /** O card da família no CRM (null = sem card ou CRM fora do ar). */
  crm_url?: string | null;
}

// Preço por mensagem ENTREGUE (a Meta cobra o modelo entregue, não o enviado). Fonte: rate card
// oficial da Meta, linha Brasil, publicado em BRL — Marketing R$ 0,3217 e Utilidade/Autenticação
// R$ 0,0350, conferido em 15/08/2026 (tier-finance CLAUDE.md, «Tarifas WhatsApp / Meta»).
// É estimativa: a Meta muda a tabela com 30 dias de aviso e Utilidade tem desconto por volume.
// Quem paga é a conta da Meta (WABA) do número, não a Tier.
export const PRECO_POR_MENSAGEM: Record<string, number> = {
  MARKETING: 0.3217,
  UTILITY: 0.035,
  AUTHENTICATION: 0.035,
};

export function precoDaCategoria(categoria: string | null | undefined): number | null {
  return PRECO_POR_MENSAGEM[(categoria || "").toUpperCase()] ?? null;
}

export function nomeDaCategoria(categoria: string | null | undefined): string {
  const c = (categoria || "").toUpperCase();
  return c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidade" : c === "AUTHENTICATION" ? "Autenticação" : c || "—";
}

export function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function inteiro(v: number): string {
  return v.toLocaleString("pt-BR");
}

export function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** «40 min», «1 h 20 min», «45 s». */
export function duracao(segundos: number): string {
  if (segundos < 60) return `${Math.max(0, Math.round(segundos))} s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// Cores de STATUS — as mesmas da página de Modelos (verde = ok, âmbar = atenção, vermelho = erro);
// o azul da marca marca o que está acontecendo agora. Cor só com função (design-system §1).
export const TOM = {
  neutro: "bg-black/[0.05] text-[#262626]/[0.56] dark:bg-white/[0.08] dark:text-[#8b93a0]",
  ativo: "bg-[#003083]/[0.07] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#8ab4ff]",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  atencao: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  erro: "bg-red-500/10 text-red-700 dark:text-red-400",
} as const;

export function statusDoDisparo(d: Pick<Disparo, "status" | "comeca_em">): { texto: string; tom: keyof typeof TOM } {
  switch (d.status) {
    case "rascunho":
      return { texto: "Rascunho", tom: "neutro" };
    case "em_andamento":
      return d.comeca_em ? { texto: "Agendado", tom: "ativo" } : { texto: "Enviando", tom: "ativo" };
    case "pausado":
      return { texto: "Pausado", tom: "atencao" };
    case "concluido":
      return { texto: "Concluído", tom: "ok" };
    case "cancelado":
      return { texto: "Cancelado", tom: "neutro" };
  }
}

export const SITUACAO: Record<Situacao, { texto: string; tom: keyof typeof TOM }> = {
  pendente: { texto: "Na fila", tom: "neutro" },
  enviando: { texto: "Enviando", tom: "ativo" },
  enviado: { texto: "Enviado", tom: "ativo" },
  entregue: { texto: "Entregue", tom: "ok" },
  lido: { texto: "Lido", tom: "ok" },
  falhou: { texto: "Falhou", tom: "erro" },
  descadastrado: { texto: "Pediu para não receber", tom: "atencao" },
  sem_nome: { texto: "Sem nome", tom: "atencao" },
  cancelado: { texto: "Cancelado", tom: "neutro" },
};

/** Os {{n}} do texto trocados pelos valores (o que falta fica como está). */
export function preencher(texto: string, valores: (string | null | undefined)[]): string {
  return (texto || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => valores[Number(n) - 1] || m);
}

export function mensagemDeErro(e: unknown, padrao: string): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "msg" in d[0]) return String((d[0] as { msg: unknown }).msg);
  return padrao;
}

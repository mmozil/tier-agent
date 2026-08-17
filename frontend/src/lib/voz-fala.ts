/**
 * Lógica PURA da fala — wake word, invocação e validação de turno.
 *
 * Vive separada da tela (`VozPublica.tsx`) por um motivo só: dá pra testar com
 * transcripts simulados, sem microfone. Wake word e VAD são exatamente o tipo de
 * código que "funciona na minha voz" e quebra na do cliente — os casos-limite
 * moram aqui, cobertos por teste, e a tela só orquestra.
 */

export function semAcento(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Normaliza preservando o COMPRIMENTO (acento removido = 1:1, pontuação vira
 * espaço). É o que permite achar o termo no texto normalizado e cortar o
 * original pelo mesmo índice, sem desalinhar.
 */
function normalPreservandoIndices(s: string): string {
  return semAcento(s).replace(/[^a-z0-9\s]/g, " ");
}

// 🚨 Palavras de nome de agente que são VOCABULÁRIO comum de conversa. Nunca
// podem virar termo de chamada sozinhas: com o agente "Tier Empresas
// Atendimento", a pergunta "qual o horário de ATENDIMENTO?" casava no termo
// "atendimento" e a pergunta era cortada pra vazio → "Pois não?" no lugar da
// resposta (bug real pego pelo harness E2E).
const GENERICOS = new Set([
  "atendimento", "suporte", "vendas", "comercial", "assistente", "assistant",
  "agente", "agent", "bot", "virtual", "oficial", "online", "digital",
  "servico", "servicos", "empresa", "empresas", "brasil", "cliente", "clientes",
]);

/** Como o nome do agente pode ser dito em voz alta. */
export function termosDoNome(nome: string): string[] {
  const limpo = normalPreservandoIndices(nome).replace(/\s+/g, " ").trim();
  const partes = limpo.split(/\s+/).filter((p) => p.length > 1);
  const t = [limpo];
  // 🚨 A PRIMEIRA palavra e como as pessoas chamam de verdade: "oi tier",
  // nao "oi tier empresas atendimento". A ultima entra tambem ("drummond").
  if (partes.length) t.push(partes[0]);
  if (partes.length > 1) t.push(partes[partes.length - 1]);
  // "M7" sai da transcrição como "eme sete" / "m sete" com frequência
  if (/^m\s?7$/.test(limpo)) t.push("eme sete", "m sete", "m7");
  // termos mais longos primeiro: "tier empresas" ganha de "tier"
  return Array.from(new Set(t.filter((x) => x && (x === limpo || !GENERICOS.has(x)))))
    .sort((a, b) => b.length - a.length);
}

/** Palavras que podem vir ANTES do nome numa chamada legítima ("oi tier", "bom dia tier"). */
const SAUDACOES = new Set([
  "oi", "oie", "ola", "alo", "hey", "ei", "hei", "opa", "eai", "e", "ai",
  "bom", "boa", "dia", "tarde", "noite", "fala", "salve", "psiu", "escuta",
]);

export type Invocacao = { chamou: boolean; pergunta: string };

/**
 * Acha o nome do agente na frase e devolve o que veio depois dele.
 *
 * `estrito=false` (modo conversa): o nome vale em QUALQUER posição — serve pro
 * "pois não?" quando a pessoa chama no meio do papo.
 *
 * `estrito=true` (SENTINELA / wake word): o nome só ACORDA o agente se a frase
 * for endereçada a ele — nome no início (só saudação antes) ou frase curta.
 * Sem isso, qualquer conversa de fundo que MENCIONE o agente ("eu falei do
 * tier ontem") dispararia uma chamada de LLM na conta do tenant.
 */
export function detectarChamada(txt: string, nomeAgente: string, estrito = false): Invocacao {
  const original = txt || "";
  const norm = ` ${normalPreservandoIndices(original)} `;
  // 🚨 Vence o match mais À ESQUERDA (desempate: mais longo). A chamada vem no
  // COMEÇO da frase; um pedaço do nome que aparece no meio ("...horário de
  // atendimento") não pode roubar o corte da pergunta do termo do início.
  let melhor: { idx: number; termo: string } | null = null;
  for (const termo of termosDoNome(nomeAgente)) {
    const idx = norm.indexOf(` ${termo} `);
    if (idx < 0) continue;

    if (estrito) {
      const antes = norm.slice(1, idx + 1).trim();
      const palavrasAntes = antes ? antes.split(/\s+/) : [];
      const totalPalavras = norm.trim().split(/\s+/).length;
      const soSaudacaoAntes = palavrasAntes.every((p) => SAUDACOES.has(p));
      const fraseCurta = totalPalavras <= 4;
      if (!(soSaudacaoAntes || fraseCurta)) continue;
    }

    if (!melhor || idx < melhor.idx) melhor = { idx, termo };
  }
  if (!melhor) return { chamou: false, pergunta: original.trim() };

  // `norm` tem 1 char de padding à esquerda → termo começa em `idx` no original
  const pergunta = original
    .slice(melhor.idx + melhor.termo.length)
    .replace(/^[\s,.!?;:—–-]+/, "")
    .trim();
  return { chamou: true, pergunta };
}

/** Muletas/ruído que sozinhas não são um turno de fala. */
const MULETAS = new Set(["e", "eh", "é", "a", "o", "ah", "uh", "hum", "hm", "uhum", "aham", "ta", "tá"]);

/**
 * O turno detectado pelo VAD merece ir pro agente? Barra ruído ("hum"), frase
 * vazia e cacos de 1 letra — mandar isso pro LLM custa dinheiro e devolve
 * resposta sem sentido na cara do visitante.
 */
export function falaValida(txt: string): boolean {
  const n = normalPreservandoIndices(txt || "").replace(/\s+/g, " ").trim();
  if (!n) return false;
  const palavras = n.split(" ");
  return palavras.some((p) => p.length >= 2 && !MULETAS.has(p));
}

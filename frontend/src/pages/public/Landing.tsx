/**
 * Site público do Tier Agent — agent.tier.finance/ (sem login).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DIREÇÃO: «Premium SaaS Trust» — o produto no contexto; a tela do Agent
 * trabalhando é a prova. Escolhida pelo dono em 09/10/2026, com 2 de 3 votos de
 * um júri (conversão e assinatura votaram nela; exequibilidade votou Precision &
 * Density). Veio de um ciclo de crítica em 5 lentes + 3 direções concorrentes.
 *
 * A versão anterior desta página foi escrita SEM direção e SEM Section Contract —
 * e tirou, na rubrica da skill-design: ritmo 2,6 · assinatura 3,6 · conversão 4,0
 * · hierarquia 4,2 · consistência 7,0. O diagnóstico: 5 de 5 seções abriam com a
 * mesma moldura (Cabecalho centrado), 6 de 6 respiravam com o mesmo `py-16
 * md:py-24`, e 88% dos tamanhos de texto viviam entre 10 e 15px — fortissimo e
 * pianissimo, sem meio-tom. A página tinha MENOS variação que o Emissor e o
 * Empresas, que ela dizia seguir.
 *
 * A PARTITURA (o que conserta o ritmo 2,6): a densidade alterna e a moldura varia.
 *   §1 alta  · assimétrica, vídeo + painel AO LADO do título
 *   §2 alta  · título à ESQUERDA, painel correndo até a borda — o pico precoce
 *   §3 média · assimétrica [1fr_1.2fr], tabela em vez de cartão
 *   §4 alta  · o ÚNICO Cabecalho centrado do corpo — catálogo é objeto simétrico
 *   §5 alta  · intocada: é a seção que já funcionava
 *   §6 baixa · faixa sem cartão de ícone e sem cabeçalho — o respiro
 *   §7 média · centrada, fecha o arco
 *
 * ASSINATURA — O CARIMBO. Todo painel termina numa régua de 11px `tabular-nums`
 * com três campos na mesma ordem: a ferramenta que foi chamada · o freio que
 * conferiu · o custo e o tempo. É a trilha de auditoria do próprio produto virada
 * elemento de desenho, e não sai de um prompt de «SaaS escuro»: exige que
 * conversa, chamada de ferramenta, conferência e preço vivam no mesmo modelo de
 * dados — `ta_message_log.brakes_fired` é coluna JSONB de verdade.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 DECISÕES DO DONO (09/10/2026), e o que cada uma proíbe:
 *
 * 1. NENHUM BOTÃO DE ENTRAR OU CADASTRAR. O cadastro não está aberto pelo site.
 *    A única ação é «Falar com vendas».
 *
 * 2. NENHUM NÚMERO DE OPERAÇÃO INVENTADO. A versão anterior exibia «93% de
 *    cobertura · R$ 149/dia · 1,4s · 7% humano» como se fossem a operação do
 *    leitor — eram constantes no fonte — e ainda punha um selo «Atualizado
 *    agora» por cima, afirmando liveness sobre array estático. A §5 mantém a
 *    FORMA (gráfico, tabela, indicadores) e passa a se declarar `exemplo`.
 *    Os números do herói são outra coisa: são fatos do produto, contados por
 *    mim no código, com a fonte anotada em cada constante abaixo.
 *
 * 3. SEM AGENTE AO VIVO. Existe um agente público em `/c/demo-tier-empresas`,
 *    mas o dono preferiu não expô-lo aqui. A conversa desta página é desenhada —
 *    e por isso vem rotulada `exemplo`, como as métricas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FATOS DO PRODUTO — todos contados por mim no código em 09/10/2026, não pelo
 * agente que propôs a direção, e não pela página antiga (que dizia «12 tools» e
 * estava errada):
 *   10 ferramentas .. tier-finance/backend/routes/mcp_erp.py (5 erp_* + 5 crm_*)
 *    7 playbooks ... tier-agent/backend/services/playbook_seed.py (dict TEMPLATES)
 *   18 freios ...... tier-agent/backend/services/tier_engine.py (brakes_fired);
 *                    9 entram aqui — os outros são de cliente (taxidog_*) ou
 *                    específicos demais (asks_pet_data, prof_hours)
 *    6 operações ... os clientes já no ar
 *
 * ATIVOS — nada novo foi pedido. O vídeo `/images/tier-empresas-720p.mp4` JÁ
 * estava neste repositório e já era usado por Login.tsx e Signup.tsx; a landing
 * era a única página pública que não o usava, e é por isso que o herói tinha
 * ~461px de preto chapado (o radial anterior zerava em y=248 de um herói de
 * ~709px, com o pico escondido atrás do cabeçalho fixo). O `pattern-tier-cubos.svg`
 * também já existia. O movimento vem de `components/landing/motion.tsx`, que
 * estava no repositório com ZERO importadores — framer-motion já entra no bundle
 * por causa do Login, então usar movimento aqui custa zero byte a mais.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, CircleDollarSign, Menu, ShieldCheck, UserRound, X } from 'lucide-react';

import { BotaoTier, CARD, CARROSSEL, Cabecalho, ITEM_CARROSSEL, Selo, SeloNeutro } from '../../components/landing/ui';
import { Item, Reveal, StaggerIn } from '../../components/landing/motion';

const vendas = (assunto: string) => `mailto:contato@tier.finance?subject=${encodeURIComponent(assunto)}`;
const VENDAS = vendas('Quero o Tier Agent');

const NAV = [
  { href: '#desfechos', rotulo: 'Os desfechos' },
  { href: '#playbooks', rotulo: 'Playbooks' },
  { href: '#fontes', rotulo: 'Fontes' },
  { href: '#freio', rotulo: 'O freio' },
];

const CLIENTES = ['Kirvah', 'Hovio', 'M7', 'Out Group', 'Esneper', 'Petdubem'];

/** Os quatro números do herói são FATOS contados no código — ver cabeçalho. */
const FATOS = [
  ['10', 'Ferramentas no ERP'],
  ['7', 'Playbooks prontos'],
  ['18', 'Freios no motor'],
  ['6', 'Operações no ar'],
];

/**
 * §2 — os três desfechos. É o que separa o produto de um chatbot: o chatbot tem
 * um desfecho só. O carimbo de cada coluna é a assinatura da página.
 */
const DESFECHOS = [
  {
    icone: ShieldCheck,
    selo: 'Resolvido',
    marca: false,
    pergunta: 'Qual o prazo do meu pedido 4471?',
    resposta: 'Saiu ontem e chega quinta. O código de rastreio foi para o seu WhatsApp agora.',
    carimbo: { ferramenta: 'erp_kpis', freio: 'price_no_check', custo: 'R$ 0,02', tempo: '2,8s' },
  },
  {
    icone: CircleDollarSign,
    selo: 'Cobrado',
    marca: true,
    pergunta: 'Quero retomar o carrinho e pagar no Pix.',
    resposta: 'Mantive o mesmo catálogo da compra anterior e deixei o Pix pronto, com vencimento amanhã.',
    carimbo: { ferramenta: 'crm_oportunidade_criar', freio: 'confirm_no_book', custo: 'R$ 0,03', tempo: '3,1s' },
  },
  {
    icone: UserRound,
    selo: 'Passado para humano',
    marca: false,
    pergunta: 'Preciso falar com uma pessoa do time.',
    resposta: 'Chamei alguém agora. A conversa foi para a fila com o histórico e o pedido já anexados.',
    carimbo: { ferramenta: '—', freio: 'announce_and_stop', custo: 'R$ 0,01', tempo: '1,2s' },
  },
];

/** §3 — os 7 playbooks REAIS do produto (playbook_seed.py, dict TEMPLATES). */
const PLAYBOOKS = [
  { nome: 'FAQ + Atendimento Humano', dispara: 'Pergunta sobre produto, prazo ou política', faz: 'Responde pela base e passa adiante o que não souber' },
  { nome: 'Recuperar Carrinho', dispara: 'Carrinho parado há mais de um dia', faz: 'Retoma a conversa e gera o Pix do mesmo catálogo' },
  { nome: 'Qualificação SDR (BANT)', dispara: 'Lead novo em qualquer canal', faz: 'Qualifica, pontua e abre a oportunidade no CRM' },
  { nome: 'NPS pós-compra', dispara: 'Pedido entregue', faz: 'Pergunta a nota e encaminha a nota baixa para uma pessoa' },
  { nome: 'Reativação cliente inativo', dispara: 'Cliente sem comprar há N dias', faz: 'Reabre com o histórico dele, não com disparo genérico' },
  { nome: 'Triagem Suporte L1 + L2', dispara: 'Pedido de ajuda', faz: 'Resolve o primeiro nível e escala o resto com contexto' },
  { nome: 'Equipe IA Multi-Especialista', dispara: 'Assunto que cruza áreas', faz: 'Reparte entre agentes e devolve uma resposta só' },
];

/** §4 — as 10 ferramentas REAIS (mcp_erp.py). A página antiga dizia 12. */
const FERRAMENTAS = [
  { nome: 'erp_dre', faz: 'Demonstrativo de resultado do período', escreve: false },
  { nome: 'erp_fluxo_caixa', faz: 'Entradas e saídas projetadas', escreve: false },
  { nome: 'erp_kpis', faz: 'Indicadores de venda e operação', escreve: false },
  { nome: 'erp_aging_receber', faz: 'Quem deve, e há quanto tempo', escreve: false },
  { nome: 'erp_aging_pagar', faz: 'O que vence, e quando', escreve: false },
  { nome: 'crm_pipeline', faz: 'Funil com etapas e valores', escreve: false },
  { nome: 'crm_oportunidades', faz: 'Negociações abertas do cliente', escreve: false },
  { nome: 'crm_oportunidade_criar', faz: 'Abre a negociação na etapa certa', escreve: true },
  { nome: 'crm_oportunidade_mover', faz: 'Move a negociação de etapa', escreve: true },
  { nome: 'crm_enriquecer_cnpj', faz: 'Preenche o cadastro pela base da Receita', escreve: true },
];

const FONTES = [
  { nome: 'Tier Empresas ERP', estado: 'Conectado', detalhe: '10 ferramentas · financeiro e CRM' },
  { nome: 'Hovio Pet', estado: 'Conectado', detalhe: 'Clientes, agenda, financeiro e WhatsApp' },
  { nome: 'Servidor MCP próprio', estado: 'Pronto para plugar', detalhe: 'URL + autenticação do provedor' },
];

/**
 * §6 — 9 dos 18 freios reais do motor (tier_engine.py, `brakes_fired`). Ficaram
 * de fora os de cliente (taxidog_*) e os específicos demais (asks_pet_data…).
 */
const FREIOS = [
  { nome: 'price_no_check', pega: 'Afirmou um preço sem consultar o sistema' },
  { nome: 'confirm_no_book', pega: 'Disse que fechou sem ter fechado' },
  { nome: 'confirm_summary_missing', pega: 'Confirmou sem repetir o que foi combinado' },
  { nome: 'offers_slot_no_check', pega: 'Ofereceu horário sem olhar a agenda' },
  { nome: 'denies_slots', pega: 'Disse que não há horário sem ter conferido' },
  { nome: 'mudo_apos_ferramenta', pega: 'Chamou a ferramenta e não respondeu nada' },
  { nome: 'announce_and_stop', pega: 'Anunciou que ia fazer — e parou aí' },
  { nome: 'phone_reasked', pega: 'Pediu de novo um dado que o cliente já tinha dado' },
  { nome: 'cjk_leak', pega: 'Respondeu com caractere de outro idioma' },
];

/** §5 — a seção que já funcionava. Dados de EXEMPLO, e a página diz isso. */
const SERIE = [
  { dia: '07', valor: 26 }, { dia: '08', valor: 32 }, { dia: '09', valor: 30 }, { dia: '10', valor: 44 },
  { dia: '11', valor: 41 }, { dia: '12', valor: 53 }, { dia: '13', valor: 61 }, { dia: '14', valor: 57 },
];
const POR_PLAYBOOK = [
  { nome: 'FAQ + Atendimento Humano', exec: '1.482', custo: 'R$ 63,80', latencia: '1,3s' },
  { nome: 'Recuperar Carrinho', exec: '914', custo: 'R$ 18,10', latencia: '1,1s' },
  { nome: 'Qualificação SDR (BANT)', exec: '706', custo: 'R$ 42,30', latencia: '1,4s' },
  { nome: 'Triagem Suporte L1 + L2', exec: '388', custo: 'R$ 25,40', latencia: '1,8s' },
];
const INDICADORES = [['R$ 149', 'Custo por dia'], ['93%', 'Cobertura'], ['1,4s', 'Latência'], ['7%', 'Humano no loop']];
const LEITURA = [
  ['Mais eficiente', 'Recuperar Carrinho'],
  ['Maior volume', 'FAQ + Atendimento Humano'],
  ['Maior latência', 'Triagem Suporte L1 + L2'],
];

/**
 * O CARIMBO — a assinatura. Mesma ordem em todo painel: ferramenta · freio ·
 * custo e tempo, em 11px tabular-nums, separado por uma linha de 1px.
 */
function Carimbo({ ferramenta, freio, custo, tempo }: { ferramenta: string; freio: string; custo: string; tempo: string }) {
  return (
    // 🚨 DUAS linhas SEMPRE, nao "quebra se nao couber". Com uma linha so, a
    // coluna cujo nome de ferramenta e mais longo (crm_oportunidade_criar, 21
    // caracteres) empurrava custo+tempo para baixo e desalinhava das vizinhas —
    // medido na captura: 2 das 3 colunas em uma linha, a do meio em duas.
    <dl className="mt-4 pt-3 border-t border-[#333] text-[11px] tabular-nums space-y-1">
      {/* 🚨 No celular ferramenta e freio EMPILHAM sempre; so do sm para cima
          ficam lado a lado. Com `flex-wrap`, quem quebrava era so a coluna de
          nome mais longo — medido a 390px: carimbos de 50, 71 e 50px de altura
          no mesmo painel. Previsivel vence compacto. */}
      <div className="flex flex-col sm:flex-row sm:items-baseline gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <dt className="text-neutral-600 shrink-0">ferramenta</dt>
          <dd className="text-neutral-300 truncate">{ferramenta}</dd>
        </span>
        <span className="flex items-baseline gap-1.5 min-w-0">
          <dt className="text-neutral-600 shrink-0">freio</dt>
          <dd className="text-neutral-300 truncate">{freio}</dd>
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 text-neutral-400">
        <dd>{custo}</dd>
        <span className="text-neutral-700">·</span>
        <dd>{tempo}</dd>
      </div>
    </dl>
  );
}

/** Painel do herói: a conversa chegando, a resposta e o carimbo fechando o laço. */
function PainelAoVivo() {
  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-[#4d8bff]/15 text-[#4d8bff] text-[11px] font-medium flex items-center justify-center">
            MS
          </span>
          <div>
            <p className="text-[12px] font-medium text-white leading-none">Marina Souza</p>
            <p className="mt-1 text-[10px] text-neutral-500 leading-none">WhatsApp oficial · 19h40, sexta</p>
          </div>
        </div>
        <SeloNeutro>exemplo</SeloNeutro>
      </div>

      <p className="mt-4 rounded-lg bg-white/[0.04] p-3 text-[13px] leading-relaxed text-neutral-300">
        Queria retomar o carrinho e saber se consigo pagar no Pix e separar para amanhã.
      </p>

      <div className="mt-2.5 rounded-lg bg-[#4d8bff]/[0.07] ring-1 ring-[#4d8bff]/25 p-3">
        <p className="text-[13px] leading-relaxed text-neutral-200">
          Consigo sim. Mantive o mesmo catálogo da compra anterior, deixei o Pix pronto e já sinalizei a separação para
          amanhã.
        </p>
      </div>

      <Carimbo ferramenta="crm_oportunidade_criar" freio="confirm_no_book" custo="R$ 0,03" tempo="3,1s" />
    </div>
  );
}

function GraficoVolume() {
  const L = 560, A = 136, topo = 10, base = A - 14;
  const maior = Math.max(...SERIE.map((p) => p.valor));
  const menor = Math.min(...SERIE.map((p) => p.valor));
  const faixa = maior - menor || 1;
  const pts = SERIE.map((p, i) => ({
    ...p,
    x: (i / (SERIE.length - 1)) * (L - 32) + 16,
    y: base - ((p.valor - menor) / faixa) * (base - topo),
  }));
  const linha = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${pts[0].x.toFixed(1)},${base} ${linha} ${pts[pts.length - 1].x.toFixed(1)},${base}`;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Volume diário</p>
      <svg viewBox={`0 0 ${L} ${A}`} className="mt-3 w-full h-auto" role="img" aria-label="Volume diário de execuções, exemplo">
        <defs>
          <linearGradient id="g-vol" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4d8bff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#4d8bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1="16" x2={L - 16} y1={topo + f * (base - topo)} y2={topo + f * (base - topo)} stroke="#333" strokeWidth="1" />
        ))}
        <polygon points={area} fill="url(#g-vol)" />
        <polyline points={linha} fill="none" stroke="#4d8bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={p.dia} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.5}
            fill={i === pts.length - 1 ? '#4d8bff' : '#161616'} stroke="#4d8bff" strokeWidth="1.5" />
        ))}
      </svg>
      {/* 🚨 Os rótulos dos dias ficam FORA do viewBox: texto dentro de SVG escala
          junto, e a 390px o cartão mede ~294px (fator 0,525) — ilegível. */}
      <div className="mt-1.5 flex justify-between px-3 text-[10px] tabular-nums text-neutral-600">
        {SERIE.map((p) => <span key={p.dia}>{p.dia}</span>)}
      </div>
    </div>
  );
}

export default function Landing() {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="dark agent-outfit min-h-screen bg-[#0a0a0a] text-white">
      {/* ── Topo ── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="max-w-[1180px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="shrink-0">
            <img src="/tier-agent-site.png" alt="Tier Agent" style={{ height: 32, width: 'auto' }} draggable={false} />
          </Link>
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-[13px] text-neutral-400 hover:text-white transition-colors">
                {n.rotulo}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <BotaoTier href={VENDAS}>Falar com vendas</BotaoTier>
            <button
              type="button"
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto((v) => !v)}
              className="md:hidden w-8 h-8 rounded-full flex items-center justify-center text-neutral-300 hover:bg-white/5"
            >
              {menuAberto ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
            </button>
          </div>
        </div>
        {menuAberto && (
          <nav className="md:hidden border-t border-white/[0.06] px-6 pt-2 pb-5">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenuAberto(false)}
                className="block py-3 text-[15px] text-neutral-300 hover:text-white border-b border-white/[0.04]">
                {n.rotulo}
              </a>
            ))}
            <BotaoTier href={VENDAS} size="xl" className="mt-5 w-full">Falar com vendas</BotaoTier>
          </nav>
        )}
      </header>

      {/* ── §1 · O ciclo — assimétrico: a afirmação à esquerda, a máquina ao lado ── */}
      <section className="relative overflow-hidden pt-16">
        <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover opacity-40">
          <source src="/images/tier-empresas-720p.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-[#0a0a0a]" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-12 pb-14 md:pt-24 md:pb-20">
          <StaggerIn className="grid gap-10 lg:gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
            <Item className="max-w-[520px]">
              <Selo dot>WhatsApp oficial · 6 operações no ar</Selo>
              <h1 className="mt-5 text-[34px] sm:text-[42px] md:text-[54px] font-medium tracking-[-0.03em] leading-[1.05]">
                Responda todo mundo.
                <br />
                <span className="text-neutral-400">Confira cada resposta.</span>
              </h1>
              <p className="mt-5 text-[15px] md:text-[16px] leading-relaxed text-neutral-400">
                A mensagem que chega sexta às 19h40 hoje é respondida na segunda. Aqui ela é respondida na hora — com o
                dado do seu sistema dentro e o custo da resposta à vista.
              </p>
              <div className="mt-7 flex">
                <BotaoTier href={VENDAS} size="xl" className="w-full sm:w-auto max-w-[340px]">
                  Falar com vendas
                  <ArrowRight />
                </BotaoTier>
              </div>
            </Item>

            <Item>
              <PainelAoVivo />
            </Item>
          </StaggerIn>

          {/* Fatos do produto — contados no código, não métricas de operação. */}
          <Reveal className="mt-12 md:mt-14 grid grid-cols-2 md:grid-cols-4 gap-2" delay={0.1}>
            {FATOS.map(([valor, rotulo]) => (
              <div key={rotulo} className={`${CARD} px-4 py-3.5`}>
                <p className="text-[11px] text-neutral-500">{rotulo}</p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums text-white">{valor}</p>
              </div>
            ))}
          </Reveal>

          <Reveal className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3" delay={0.18}>
            <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-600">Já no ar</span>
            {CLIENTES.map((c) => (
              <span key={c} className="text-[15px] font-medium text-neutral-500">{c}</span>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── §2 · Três desfechos — título à esquerda, painel até a borda (o pico) ── */}
      <section id="desfechos" className="py-16 md:py-24 scroll-mt-16">
        <div className="max-w-[1180px] mx-auto px-6">
          <Reveal className="max-w-[540px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">Os desfechos</p>
            <h2 className="mt-3 text-[30px] md:text-[36px] font-medium tracking-[-0.02em] leading-[1.15]">
              Três fins possíveis — e um deles é chamar gente
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-400">
              Um chatbot tem um desfecho só: responder. Abaixo, a mesma máquina resolvendo, cobrando e parando — com o
              carimbo do que foi chamado em cada caso.
            </p>
          </Reveal>
        </div>

        <Reveal className="mt-10 md:mt-14 px-6">
          <div className={`${CARD} overflow-hidden max-w-[1320px] mx-auto`}>
            {/* Celular: carrossel com encaixe (o gesto da casa) — a ponta da 2a
                coluna aparece e convida a deslizar. Do tablet para cima, grade
                dividida por fio de 1px. O `divide-x` so entra no md para nao
                desenhar fio entre cartoes que rolam. */}
            <div className={`${CARROSSEL} md:grid-cols-3 md:gap-0 md:divide-x md:divide-[#333]`}>
              {DESFECHOS.map(({ icone: Icone, selo, marca, pergunta, resposta, carimbo }) => (
                <div key={selo} className={`${ITEM_CARROSSEL} p-6`}>
                  <div className="flex items-center gap-2">
                    <Icone className="w-4 h-4 text-neutral-400" />
                    {marca ? <Selo>{selo}</Selo> : <SeloNeutro>{selo}</SeloNeutro>}
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-neutral-500">“{pergunta}”</p>
                  <p className="mt-3 text-[13px] leading-relaxed text-neutral-200">{resposta}</p>
                  <Carimbo {...carimbo} />
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── §3 · O playbook — assimétrica, tabela no lugar de cartão ── */}
      <section id="playbooks" className="border-y border-white/[0.06] bg-white/[0.02] scroll-mt-16">
        <div className="max-w-[1180px] mx-auto px-6 py-16 md:py-24 grid gap-8 md:gap-12 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">Playbooks</p>
            <h2 className="mt-3 text-[30px] md:text-[36px] font-medium tracking-[-0.02em] leading-[1.15]">
              A regra é sua, e está escrita
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-400 max-w-[420px]">
              Sete playbooks já prontos no produto. Cada um tem um gatilho e uma ação — nada acontece porque o modelo
              achou que devia.
            </p>
          </Reveal>

          {/* 🚨 `min-w-0`: item de grade NAO encolhe abaixo do conteudo. Sem ele a
              tabela de min-w-[520px] forca a coluna a 520px, o overflow-x-auto
              nunca chega a agir e a PAGINA INTEIRA rola na horizontal — medido a
              390px: documentElement.scrollWidth = 544. */}
          <Reveal delay={0.1} className="min-w-0">
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-[#333]">
                    {['Playbook', 'O que dispara', 'O que faz'].map((h) => (
                      <th key={h} className="px-5 py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#333]">
                  {PLAYBOOKS.map((p) => (
                    <tr key={p.nome}>
                      <td className="px-5 py-3 text-[13px] text-white">{p.nome}</td>
                      <td className="px-5 py-3 text-[12px] text-neutral-400">{p.dispara}</td>
                      <td className="px-5 py-3 text-[12px] text-neutral-400">{p.faz}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── §4 · As fontes — o ÚNICO Cabecalho centrado do corpo ── */}
      <section id="fontes" className="max-w-[1180px] mx-auto px-6 py-16 md:py-24 scroll-mt-16">
        <Reveal>
          <Cabecalho
            rotulo="Fontes de dados"
            titulo="Ele lê o seu sistema. E escreve nele."
            texto="O Agent fala MCP: o que você já usa vira ferramenta dele, com escopo e credencial separados."
          />
        </Reveal>

        <Reveal className={`${CARD} mt-10 md:mt-14 grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#333] overflow-hidden`} delay={0.08}>
          {FONTES.map((f) => (
            <div key={f.nome} className="p-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-white">{f.nome}</p>
                <p className="mt-1 text-[11px] text-neutral-500">{f.detalhe}</p>
              </div>
              {f.estado === 'Conectado' ? <Selo dot>{f.estado}</Selo> : <SeloNeutro>{f.estado}</SeloNeutro>}
            </div>
          ))}
        </Reveal>

        <Reveal className={`${CARD} mt-3 divide-y divide-[#333]`} delay={0.14}>
          <div className="flex items-center gap-3 px-5 py-3">
            <Boxes className="w-4 h-4 text-neutral-500 shrink-0" />
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              As 10 ferramentas do ERP da Tier
            </p>
          </div>
          {FERRAMENTAS.map((t) => (
            <div key={t.nome} className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-[12px] text-neutral-300 sm:w-[190px] shrink-0">{t.nome}</span>
              <p className="hidden sm:block text-[12px] text-neutral-400 flex-1">{t.faz}</p>
              <span className={`text-[10px] shrink-0 ml-auto sm:ml-0 ${t.escreve ? 'text-[#4d8bff]' : 'text-neutral-600'}`}>
                {t.escreve ? 'escreve' : 'lê'}
              </span>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ── §5 · Métricas — a seção que já funcionava. Intocada, exceto a honestidade ── */}
      <section id="metricas" className="border-y border-white/[0.06] bg-white/[0.02] scroll-mt-16">
        <div className="max-w-[1180px] mx-auto px-6 py-16 md:py-24">
          <Reveal>
            <Cabecalho
              rotulo="Métricas da operação"
              titulo="Custo, latência e cobertura sem adivinhação"
              texto="IA cobra por uso. Aqui token, latência, falha e humano no loop são número de primeira classe."
            />
          </Reveal>

          <Reveal className="mt-10 md:mt-14 grid gap-3 lg:grid-cols-[1.6fr_1fr]" delay={0.08}>
            {/* `min-w-0` pelo mesmo motivo do §3: dentro ha tabela rolavel. */}
            <div className={`${CARD} p-6 min-w-0`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-medium text-white">Saúde por agente e por playbook</h3>
                  <p className="mt-0.5 text-[12px] text-neutral-500">Custo, volume e latência legíveis sem abrir planilha.</p>
                </div>
                {/* 🚨 Era `Selo dot «Atualizado agora»` sobre arrays escritos no
                    fonte — afirmava liveness que não existe. Decisão do dono. */}
                <SeloNeutro>exemplo</SeloNeutro>
              </div>

              <div className="mt-6"><GraficoVolume /></div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left">
                  <thead>
                    <tr className="border-b border-[#333]">
                      {['Playbook', 'Exec.', 'Custo', 'Latência'].map((h, i) => (
                        <th key={h} className={`pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 ${i ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#333]">
                    {POR_PLAYBOOK.map((p) => (
                      <tr key={p.nome}>
                        <td className="py-2.5 text-[13px] text-neutral-200">{p.nome}</td>
                        <td className="py-2.5 text-[13px] text-neutral-400 text-right tabular-nums">{p.exec}</td>
                        <td className="py-2.5 text-[13px] text-neutral-400 text-right tabular-nums">{p.custo}</td>
                        <td className="py-2.5 text-[13px] text-neutral-400 text-right tabular-nums">{p.latencia}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 content-start">
              <div className={`${CARD} p-6`}>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Leitura rápida</p>
                <p className="mt-2 text-[13px] text-neutral-400">Onde a operação está ganhando ou pesando.</p>
                <ul className="mt-4 space-y-3">
                  {LEITURA.map(([r, v]) => (
                    <li key={r} className="rounded-lg ring-1 ring-[#333] px-3 py-2.5">
                      <p className="text-[11px] text-neutral-500">{r}</p>
                      <p className="mt-0.5 text-[13px] text-neutral-200">{v}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {INDICADORES.map(([valor, rotulo]) => (
                  <div key={rotulo} className={`${CARD} px-4 py-3.5`}>
                    <p className="text-[11px] text-neutral-500">{rotulo}</p>
                    <p className="mt-1 text-[20px] font-semibold tabular-nums text-white">{valor}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-neutral-600">
                Números de exemplo, para mostrar o formato do relatório. Os seus aparecem no painel a partir da primeira
                conversa.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── §6 · O freio — faixa sem cartão de ícone e sem cabeçalho: o respiro ── */}
      <section id="freio" className="max-w-[1180px] mx-auto px-6 py-16 md:py-20 grid gap-8 md:gap-12 lg:grid-cols-[1fr_1.35fr] scroll-mt-16">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">O freio</p>
          <h2 className="mt-3 text-[30px] md:text-[36px] font-medium tracking-[-0.02em] leading-[1.15]">
            O freio fica no motor, não na persona
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-neutral-400 max-w-[420px]">
            Não prometemos que a IA acerta sempre. Mostramos o que o motor não deixa passar — são 18 conferências a cada
            resposta, antes de ela sair. Nove delas:
          </p>
        </Reveal>

        <Reveal className={`${CARD} divide-y divide-[#333]`} delay={0.1}>
          {FREIOS.map((f) => (
            <div key={f.nome} className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 px-5 py-2.5">
              <span className="text-[12px] text-neutral-300 sm:w-[210px] shrink-0">{f.nome}</span>
              <p className="text-[12px] text-neutral-400">{f.pega}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ── §7 · Chamada final — o eco, centrado ── */}
      <section className="relative border-t border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <img
          src="/pattern-tier-cubos.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 w-full h-full object-cover opacity-[0.04]"
        />
        <div className="relative max-w-[1180px] mx-auto px-6 py-20 md:py-28 text-center">
          <h2 className="text-[30px] md:text-[44px] font-medium tracking-[-0.03em] leading-[1.1]">
            Quantas conversas hoje
            <br />
            <span className="text-neutral-400">ninguém teve tempo de responder?</span>
          </h2>
          <p className="mt-4 text-[15px] text-neutral-400 max-w-[520px] mx-auto">
            Conte como o seu atendimento funciona hoje. A gente mostra o que o Agent assume, o que continua com a sua
            equipe e quanto custa a diferença.
          </p>
          <div className="mt-8 flex justify-center">
            <BotaoTier href={VENDAS} size="xl" className="w-full sm:w-auto max-w-[340px]">
              Falar com vendas
              <ArrowRight />
            </BotaoTier>
          </div>
          <p className="mt-5 text-[12px] text-neutral-500">
            Quer a conta da tarifa do WhatsApp antes de conversar?{' '}
            <a href="/whatsapp/" className="text-neutral-300 hover:text-white underline-offset-2 hover:underline">
              A calculadora está aqui
            </a>
          </p>
        </div>
      </section>

      {/* ── Rodapé ── */}
      <footer className="border-t border-white/[0.06]">
        <div className="max-w-[1180px] mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <img src="/tier-agent-site.png" alt="Tier Agent" style={{ height: 26, width: 'auto' }} draggable={false} />
            <p className="mt-3 text-[12px] text-neutral-500 max-w-[360px]">
              Agente de atendimento com WhatsApp oficial, playbooks e os dados do seu sistema. Parte do ecossistema Tier.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 md:flex md:flex-wrap md:gap-x-6 md:gap-y-2 text-[12px] text-neutral-500">
            <a href="#playbooks" className="hover:text-white">Playbooks</a>
            <a href="#fontes" className="hover:text-white">Fontes</a>
            <a href="#freio" className="hover:text-white">O freio</a>
            <a href="/whatsapp/" className="hover:text-white">Tarifas do WhatsApp</a>
            <Link to="/privacidade" className="hover:text-white">Privacidade</Link>
            <a href="mailto:contato@tier.finance" className="hover:text-white">Contato</a>
          </div>
        </div>
        <p className="max-w-[1180px] mx-auto px-6 pb-8 text-[11px] text-neutral-600">
          © 2026 Tier Finance. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  );
}

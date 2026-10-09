/**
 * Site público do Tier Agent — agent.tier.finance/ (sem login).
 *
 * Mesmo padrão do Tier Emissor e do Tier Empresas (`tier-finance`): tema escuro,
 * cartão com anel `ring-1 ring-[#333]`, botão em contorno, selo da marca, fonte
 * Hellix (`.agent-outfit`) e carrossel com encaixe no celular. O kit está em
 * `components/landing/ui.tsx`, que explica de onde veio cada medida.
 *
 * 🚨 NENHUM BOTÃO DE ENTRAR OU COMEÇAR (decisão do dono, 09/10/2026): o cadastro
 * não está aberto pelo site. A única ação da página é «Falar com vendas». Os
 * botões saíram também do cabeçalho e do rodapé compartilhados (`marketing.tsx`),
 * então as outras páginas de marketing perderam a porta de entrada junto.
 * Reabrir = devolver os links de /login e /signup.
 *
 * 🚨 A oferta de «14 dias do Pro» SAIU. Sem cadastro aberto não há como começar
 * um teste, e prometer prazo sem o caminho é promessa vazia — mesma regra que
 * tirou o «teste grátis de 14 dias» do site do Tier Empresas.
 *
 * 🚨 Acentos: a versão anterior tinha texto gravado em mojibake no próprio código
 * («CobranÃ§a automÃ¡tica», «RecuperaÃ§Ã£o de carrinho», «saÃºde», «LÃª»…), visível
 * na tela da seção de métricas. Não era charset da página — era a string no fonte.
 * Reescrito aqui em UTF-8 correto.
 *
 * Os dados são os mesmos que a página já mostrava (conferidos no ar em 09/10/2026):
 * as conversas do inbox, as três fontes, os quatro playbooks com custo e latência,
 * a série de volume dos dias 07 a 14 e os quatro indicadores da operação.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Boxes,
  Menu,
  ShieldCheck,
  Sparkles,
  Wallet,
  Workflow,
  X,
} from 'lucide-react';

import { BotaoTier, CARD, CARROSSEL, Cabecalho, ITEM_CARROSSEL, Selo, SeloNeutro } from '../../components/landing/ui';

const vendas = (assunto: string) => `mailto:contato@tier.finance?subject=${encodeURIComponent(assunto)}`;
const VENDAS = vendas('Quero o Tier Agent');

const NAV = [
  { href: '#operacao', rotulo: 'A operação' },
  { href: '#playbooks', rotulo: 'Playbooks' },
  { href: '#fontes', rotulo: 'Fontes' },
  { href: '#metricas', rotulo: 'Métricas' },
];

const CLIENTES = ['Kirvah', 'Hovio', 'M7', 'Out Group', 'Esneper', 'Petdubem'];

/** As movimentações do inbox — o que a página já mostrava. */
const CONVERSAS = [
  { nome: 'Marina Souza', hora: '09:41', texto: 'Queria retomar o carrinho e pagar no Pix.', selo: 'Lead pronta', ativa: true },
  { nome: 'Lucas Pet', hora: '09:18', texto: 'Pode me mandar a cobrança do banho?', selo: 'Cobrança pendente', ativa: false },
  { nome: 'Bianca M7', hora: '08:52', texto: 'Preciso falar com uma pessoa do time.', selo: 'Handoff humano', ativa: false },
];

const EVENTOS = [
  { titulo: 'Pix criado', texto: 'Cobrança pronta, com valor e vencimento corretos.' },
  { titulo: 'Handoff logístico', texto: 'Fila humana aberta, com contexto e pedido preenchidos.' },
];

const PROXIMOS_PASSOS = [
  'Confirmar o envio do Pix assim que o cliente responder.',
  'Acionar humano só se houver exceção de estoque.',
  'Atualizar o lead score depois do pagamento.',
];

const PLAYBOOKS = [
  {
    icone: Workflow,
    titulo: 'Escuta o que chega',
    texto: 'Mensagem, lead de formulário ou pedido do marketplace entram no mesmo fluxo, com a conversa inteira em volta.',
  },
  {
    icone: Sparkles,
    titulo: 'Decide com a regra sua',
    texto: 'O playbook é seu: quem responde sozinho, quem cobra, quem agenda e o que nunca sai sem um humano olhar.',
  },
  {
    icone: Wallet,
    titulo: 'Move a conversa',
    texto: 'Gera o Pix, marca na agenda, atualiza o CRM e devolve o próximo passo escrito — não só uma resposta bonita.',
  },
];

const FONTES = [
  {
    nome: 'Tier Empresas ERP',
    estado: 'Conectado',
    tools: '12 tools',
    escopo: 'financeiro:read · vendas:read',
    texto: 'DRE, recebimentos, pedidos e saúde comercial da operação.',
  },
  {
    nome: 'Hovio Pet',
    estado: 'Conectado',
    tools: '9 tools',
    escopo: 'pet:read · pet:write · pet:whatsapp',
    texto: 'Clientes, pets, agenda, financeiro e WhatsApp do petshop.',
  },
  {
    nome: 'Servidor MCP próprio',
    estado: 'Pronto para plugar',
    tools: 'JSON-RPC',
    escopo: 'URL + autenticação do provedor',
    texto: 'Conecte qualquer sistema que fale MCP sem reescrever o Agent.',
  },
];

const FERRAMENTAS = [
  { nome: 'Consultar DRE e recebimentos', fonte: 'Tier Empresas ERP', texto: 'Lê indicadores financeiros e cobranças em aberto.' },
  { nome: 'Criar cliente e agendamento', fonte: 'Hovio Pet', texto: 'Abre o cadastro e marca a agenda sem sair do fluxo.' },
  { nome: 'Disparar rota MCP própria', fonte: 'Servidor MCP próprio', texto: 'Aciona ferramenta externa dentro do playbook.' },
  { nome: 'Testar autenticação e listar tools', fonte: 'Catálogo', texto: 'Traduz capacidade técnica para a linguagem da operação.' },
];

/** Volume diário — os oito dias que a página já mostrava. */
const SERIE = [
  { dia: '07', valor: 26 },
  { dia: '08', valor: 32 },
  { dia: '09', valor: 30 },
  { dia: '10', valor: 44 },
  { dia: '11', valor: 41 },
  { dia: '12', valor: 53 },
  { dia: '13', valor: 61 },
  { dia: '14', valor: 57 },
];

const POR_PLAYBOOK = [
  { nome: 'Atendente WhatsApp', exec: '1.482', custo: 'R$ 63,80', latencia: '1,3s' },
  { nome: 'Cobrança automática', exec: '914', custo: 'R$ 18,10', latencia: '1,1s' },
  { nome: 'Recuperação de carrinho', exec: '706', custo: 'R$ 42,30', latencia: '1,4s' },
  { nome: 'Triagem com RAG', exec: '388', custo: 'R$ 25,40', latencia: '1,8s' },
];

const INDICADORES = [
  ['R$ 149', 'Custo por dia'],
  ['93%', 'Cobertura'],
  ['1,4s', 'Latência'],
  ['7%', 'Humano no loop'],
];

const LEITURA_RAPIDA = [
  { rotulo: 'Agente mais eficiente', valor: 'Cobrança automática' },
  { rotulo: 'Maior volume', valor: 'Atendente WhatsApp' },
  { rotulo: 'Maior latência', valor: 'Triagem com RAG' },
];

const OPERADOR = [
  {
    icone: ShieldCheck,
    titulo: 'Humano no loop',
    texto:
      'Pedido explícito de ajuda, frustração detectada ou regra crítica pausam o bot e entregam a conversa à equipe com o contexto inteiro.',
  },
  {
    icone: BookOpen,
    titulo: 'Resposta com fonte',
    texto: 'A base de conhecimento entra na resposta citando de onde veio. Menos improviso, menos retrabalho, menos resposta vaga.',
  },
  {
    icone: Activity,
    titulo: 'Custo à vista',
    texto: 'Tokens, latência, execuções e cobertura legíveis por agente e por playbook — o preço da operação não fica escondido.',
  },
];

const EMPRESA = [
  { titulo: 'Governança', texto: 'Limites, auditoria, consentimento e trilha de execução por agente.' },
  { titulo: 'Segurança', texto: 'Escopo por fonte, credencial criptografada e separação por cliente.' },
  { titulo: 'Confiabilidade', texto: 'WhatsApp oficial, saída para humano e operação pensada para o dia a dia.' },
];

/** Gráfico de volume: área + linha + pontos, desenhado em SVG (sem biblioteca). */
function GraficoVolume() {
  const L = 560;
  const A = 150;
  const topo = 12;
  const base = A - 24;
  const maior = Math.max(...SERIE.map((p) => p.valor));
  const menor = Math.min(...SERIE.map((p) => p.valor));
  const faixa = maior - menor || 1;
  const pontos = SERIE.map((p, i) => ({
    ...p,
    x: (i / (SERIE.length - 1)) * (L - 32) + 16,
    y: base - ((p.valor - menor) / faixa) * (base - topo),
  }));
  const linha = pontos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${pontos[0].x.toFixed(1)},${base} ${linha} ${pontos[pontos.length - 1].x.toFixed(1)},${base}`;

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Volume diário</p>
      <svg viewBox={`0 0 ${L} ${A}`} className="mt-3 w-full h-auto" role="img" aria-label="Volume diário de execuções dos dias 07 a 14">
        <defs>
          <linearGradient id="grad-volume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4d8bff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#4d8bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1="16" x2={L - 16} y1={topo + f * (base - topo)} y2={topo + f * (base - topo)} stroke="#333" strokeWidth="1" />
        ))}
        <polygon points={area} fill="url(#grad-volume)" />
        <polyline points={linha} fill="none" stroke="#4d8bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pontos.map((p, i) => (
          <circle
            key={p.dia}
            cx={p.x}
            cy={p.y}
            r={i === pontos.length - 1 ? 4 : 2.5}
            fill={i === pontos.length - 1 ? '#4d8bff' : '#161616'}
            stroke="#4d8bff"
            strokeWidth="1.5"
          />
        ))}
        {pontos.map((p) => (
          <text key={`r-${p.dia}`} x={p.x} y={A - 4} textAnchor="middle" fill="#737373" fontSize="10">
            {p.dia}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** As movimentações: a conversa entrando, a resposta pronta e o que ela moveu. */
function Movimentacoes() {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="grid lg:grid-cols-[232px_1fr_250px] divide-y lg:divide-y-0 lg:divide-x divide-[#333]">
        {/* Fila */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Inbox</p>
            <SeloNeutro>3 canais</SeloNeutro>
          </div>
          <ul className="mt-3 space-y-1.5">
            {CONVERSAS.map((c) => (
              <li
                key={c.nome}
                className={`rounded-lg p-3 ${c.ativa ? 'bg-white/[0.06] ring-1 ring-[#4d8bff]/30' : 'bg-white/[0.02]'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-white">{c.nome}</span>
                  <span className="text-[11px] text-neutral-500 tabular-nums">{c.hora}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">{c.texto}</p>
                <span className="mt-2 inline-block text-[10px] text-neutral-500">{c.selo}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* A conversa */}
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[13px] font-medium text-white">Marina Souza · WhatsApp oficial</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">Cliente recorrente · ticket médio R$ 1.240 · sem atraso</p>
            </div>
            <Selo dot>IA ativa</Selo>
          </div>

          <div className="mt-4 rounded-lg bg-white/[0.04] p-3 text-[13px] leading-relaxed text-neutral-300">
            Oi, queria retomar o carrinho e saber se consigo pagar no Pix e separar para amanhã.
          </div>

          <div className="mt-3 rounded-lg ring-1 ring-[#333] bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#4d8bff]" />
                <span className="text-[12px] font-medium text-white">Resposta pronta</span>
              </div>
              <span className="text-[11px] text-neutral-500 tabular-nums">1,2s</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">
              Consigo sim. Mantive o mesmo catálogo da compra anterior, deixei o Pix pronto e já sinalizei a separação para
              entrega amanhã.
            </p>
            <p className="mt-2 text-[11px] text-neutral-500">Histórico, cobrança e logística já aplicados.</p>
          </div>

          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {EVENTOS.map((e) => (
              <div key={e.titulo} className="rounded-lg ring-1 ring-[#333] p-3">
                <p className="text-[12px] font-medium text-white">{e.titulo}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{e.texto}</p>
              </div>
            ))}
          </div>
        </div>

        {/* O que o Agent puxou */}
        <div className="p-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Contexto ao vivo</p>
          <dl className="mt-3 space-y-2.5">
            {[
              ['Cliente', 'Marina Souza'],
              ['Segmento', 'Recorrente · Varejo'],
              ['Ticket médio', 'R$ 1.240'],
              ['Último pedido', 'há 3 dias'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-[11px] text-neutral-500">{k}</dt>
                <dd className="text-[12px] text-neutral-200 text-right">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Próximos passos</p>
          <ul className="mt-2 space-y-2">
            {PROXIMOS_PASSOS.map((p) => (
              <li key={p} className="flex gap-2 text-[11px] leading-relaxed text-neutral-400">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-[#4d8bff] shrink-0" />
                {p}
              </li>
            ))}
          </ul>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {[
              ['1', 'Handoff'],
              ['92', 'Lead score'],
            ].map(([v, k]) => (
              <div key={k} className="rounded-lg ring-1 ring-[#333] px-3 py-2">
                <p className="text-[10px] text-neutral-500">{k}</p>
                <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-white">{v}</p>
              </div>
            ))}
          </div>
        </div>
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
              <a
                key={n.href}
                href={n.href}
                onClick={() => setMenuAberto(false)}
                className="block py-3 text-[15px] text-neutral-300 hover:text-white border-b border-white/[0.04]"
              >
                {n.rotulo}
              </a>
            ))}
            <BotaoTier href={VENDAS} size="xl" className="mt-5 w-full">
              Falar com vendas
            </BotaoTier>
          </nav>
        )}
      </header>

      {/* ── Abertura ── */}
      <section className="relative overflow-hidden pt-16">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(77,139,255,0.10),transparent_70%)]" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-14 pb-14 md:pt-28 md:pb-20 text-center">
          <Selo dot>WhatsApp oficial · playbooks · humano no loop</Selo>
          <h1 className="mt-5 md:mt-6 text-[36px] sm:text-[44px] md:text-[60px] font-medium tracking-[-0.03em] leading-[1.06]">
            O atendimento responde.
            <br />
            <span className="text-neutral-400">E resolve.</span>
          </h1>
          <p className="mt-5 md:mt-6 max-w-[580px] mx-auto text-[15px] md:text-[16px] leading-relaxed text-neutral-400">
            Um agente que lê o seu ERP, gera o Pix, marca na agenda e chama a pessoa certa quando precisa — com o custo, a
            latência e a cobertura à vista o tempo todo.
          </p>
          <div className="mt-8 md:mt-9 flex justify-center">
            <BotaoTier href={VENDAS} size="xl" className="w-full sm:w-auto max-w-[340px]">
              Falar com vendas
              <ArrowRight />
            </BotaoTier>
          </div>

          <div className="mt-11 md:mt-14">
            <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Operações que já rodam com a Tier</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              {CLIENTES.map((c) => (
                <span key={c} className="text-[15px] font-medium text-neutral-500">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── A operação (movimentações) ── */}
      <section id="operacao" className="max-w-[1180px] mx-auto px-6 py-16 md:py-24 scroll-mt-16">
        <Cabecalho
          rotulo="A operação"
          titulo="O contexto chega antes da resposta"
          texto="A conversa entra, o Agent puxa o histórico, responde e deixa escrito o que já moveu — e o que falta."
        />
        <div className="mt-10 md:mt-14">
          <Movimentacoes />
        </div>
      </section>

      {/* ── Playbooks ── */}
      <section id="playbooks" className="border-y border-white/[0.06] bg-white/[0.02] scroll-mt-16">
        <div className="max-w-[1180px] mx-auto px-6 py-16 md:py-24">
          <Cabecalho
            rotulo="Playbooks"
            titulo="Fluxos que escutam, decidem e movem"
            texto="A regra é sua. O Agent executa, registra e devolve a conversa quando o caso pede gente."
          />
          <div className={`mt-10 md:mt-14 ${CARROSSEL} md:grid-cols-3`}>
            {PLAYBOOKS.map(({ icone: Icone, titulo, texto }) => (
              <div key={titulo} className={`${CARD} ${ITEM_CARROSSEL} p-6`}>
                <Icone className="w-4 h-4 text-neutral-400" />
                <h3 className="mt-4 text-[15px] font-medium text-white">{titulo}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Fontes ── */}
      <section id="fontes" className="max-w-[1180px] mx-auto px-6 py-16 md:py-24 scroll-mt-16">
        <Cabecalho
          rotulo="Fontes de dados"
          titulo="Plugue sistemas vivos sem reescrever a stack"
          texto="O Agent fala MCP. O que você já usa vira ferramenta dele, com escopo e credencial separados."
        />
        <div className={`mt-10 md:mt-14 ${CARROSSEL} md:grid-cols-3`}>
          {FONTES.map((f) => (
            <div key={f.nome} className={`${CARD} ${ITEM_CARROSSEL} p-6`}>
              <div className="flex items-center justify-between gap-2">
                <Boxes className="w-4 h-4 text-neutral-400" />
                {f.estado === 'Conectado' ? <Selo dot>{f.estado}</Selo> : <SeloNeutro>{f.estado}</SeloNeutro>}
              </div>
              <h3 className="mt-4 text-[15px] font-medium text-white">{f.nome}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">{f.texto}</p>
              <div className="mt-5 pt-4 border-t border-[#333] flex items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-500">{f.escopo}</span>
                <span className="text-[11px] text-neutral-400 shrink-0">{f.tools}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`${CARD} mt-3 divide-y divide-[#333]`}>
          {FERRAMENTAS.map((t) => (
            <div key={t.nome} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
              <div className="sm:w-[280px] shrink-0">
                <p className="text-[13px] font-medium text-white">{t.nome}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">{t.fonte}</p>
              </div>
              <p className="text-[12px] leading-relaxed text-neutral-400">{t.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Métricas (gráfico) ── */}
      <section id="metricas" className="border-y border-white/[0.06] bg-white/[0.02] scroll-mt-16">
        <div className="max-w-[1180px] mx-auto px-6 py-16 md:py-24">
          <Cabecalho
            rotulo="Métricas da operação"
            titulo="Custo, latência e cobertura sem adivinhação"
            texto="IA cobra por uso. Aqui token, latência, falha e humano no loop são número de primeira classe."
          />

          <div className="mt-10 md:mt-14 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className={`${CARD} p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-medium text-white">Saúde por agente e por playbook</h3>
                  <p className="mt-0.5 text-[12px] text-neutral-500">Custo, volume e latência legíveis sem abrir planilha.</p>
                </div>
                <Selo dot>Atualizado agora</Selo>
              </div>

              <div className="mt-6">
                <GraficoVolume />
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#333]">
                      {['Playbook', 'Exec.', 'Custo', 'Latência'].map((h, i) => (
                        <th
                          key={h}
                          className={`pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 ${i ? 'text-right' : ''}`}
                        >
                          {h}
                        </th>
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
                  {LEITURA_RAPIDA.map((l) => (
                    <li key={l.rotulo} className="rounded-lg ring-1 ring-[#333] px-3 py-2.5">
                      <p className="text-[11px] text-neutral-500">{l.rotulo}</p>
                      <p className="mt-0.5 text-[13px] text-neutral-200">{l.valor}</p>
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
            </div>
          </div>
        </div>
      </section>

      {/* ── Operar de verdade ── */}
      <section className="max-w-[1180px] mx-auto px-6 py-16 md:py-24">
        <Cabecalho
          rotulo="Operação"
          titulo="Feito para rodar todo dia, não para parecer demonstração"
          texto="Três coisas que separam um agente que atende de um que só responde."
        />
        <div className={`mt-10 md:mt-14 ${CARROSSEL} md:grid-cols-3`}>
          {OPERADOR.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className={`${CARD} ${ITEM_CARROSSEL} p-6`}>
              <Icone className="w-4 h-4 text-neutral-400" />
              <h3 className="mt-4 text-[15px] font-medium text-white">{titulo}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">{texto}</p>
            </div>
          ))}
        </div>

        <div className={`${CARD} mt-3 grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#333]`}>
          {EMPRESA.map((e) => (
            <div key={e.titulo} className="p-6">
              <h3 className="text-[14px] font-medium text-white">{e.titulo}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">{e.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Chamada final ── */}
      <section className="border-t border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-[1180px] mx-auto px-6 py-16 md:py-24 text-center">
          <h2 className="text-[30px] md:text-[44px] font-medium tracking-[-0.03em] leading-[1.1]">
            Quantas conversas hoje
            <br />
            <span className="text-neutral-400">ninguém teve tempo de responder?</span>
          </h2>
          <p className="mt-4 text-[15px] text-neutral-400 max-w-[520px] mx-auto">
            Conte como o seu atendimento funciona hoje. A gente mostra o que o Agent assume e o que continua com a sua
            equipe.
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
              Agente de atendimento com WhatsApp oficial, playbooks e dados do seu sistema. Parte do ecossistema Tier.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 md:flex md:flex-wrap md:gap-x-6 md:gap-y-2 text-[12px] text-neutral-500">
            <a href="#playbooks" className="hover:text-white">
              Playbooks
            </a>
            <a href="#metricas" className="hover:text-white">
              Métricas
            </a>
            <a href="/whatsapp/" className="hover:text-white">
              Tarifas do WhatsApp
            </a>
            <Link to="/privacidade" className="hover:text-white">
              Privacidade
            </Link>
            <a href="mailto:contato@tier.finance" className="hover:text-white">
              Contato
            </a>
          </div>
        </div>
        <p className="max-w-[1180px] mx-auto px-6 pb-8 text-[11px] text-neutral-600">
          © 2026 Tier Finance. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  );
}

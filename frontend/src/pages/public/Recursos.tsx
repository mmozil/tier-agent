import { Link } from "react-router-dom";
import {
  MessagesSquare,
  UserPlus,
  Hand,
  Inbox,
  Split,
  Clock,
  Eye,
  AudioLines,
  BookOpen,
  BrainCircuit,
  Plug,
  Gauge,
  GitBranch,
  Users,
  CalendarClock,
  Store,
  Wand2,
  Code2,
  ShieldCheck,
  EyeOff,
  Wallet,
  BarChart3,
  ScrollText,
  ArrowRight,
} from "lucide-react";
import { MarketingNav, MarketingFooter, FinalCTA, IsoCube } from "../../components/landing/marketing";

/* Tier Agent — /recursos · catálogo completo de funcionalidades (Attio-grade) */

type Feat = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  tag?: string;
};

type Group = {
  id: string;
  label: string;
  heading: string;
  sub: string;
  feats: Feat[];
};

const GROUPS: Group[] = [
  {
    id: "atendimento",
    label: "Atendimento",
    heading: "Atende como gente — em escala de máquina.",
    sub: "O agente conversa em qualquer canal, captura o lead, divide a resposta em balões e chama um humano na hora certa.",
    feats: [
      { icon: MessagesSquare, title: "Multicanal nativo", desc: "WhatsApp Cloud API oficial, Instagram, Telegram, e-mail e widget web. Uma persona, todos os canais." },
      { icon: UserPlus, title: "Captura de lead", desc: "Detecta intenção de compra e telefone na conversa e abre uma notificação pro time comercial." },
      { icon: Hand, title: "Hand-off humano", desc: "Quando o cliente pede atendente, o agente curto-circuita antes do LLM e passa pra equipe com todo o histórico." },
      { icon: Inbox, title: "Inbox de conversas", desc: "Histórico completo por contato, status e canal. Leads e notificações num só lugar." },
      { icon: Split, title: "Respostas humanizadas", desc: "Mensagens longas viram até 4 balões; delay de leitura e digitação imita o ritmo de uma pessoa." },
      { icon: Clock, title: "Persona consultiva", desc: "Entende antes de apresentar e nunca inventa: o que não sabe, encaminha pro consultor." },
    ],
  },
  {
    id: "inteligencia",
    label: "Inteligência",
    heading: "Vê, ouve e lembra.",
    sub: "Vai além de texto: entende fotos, conversa por áudio, responde dos seus dados com citação e lembra de cada contato.",
    feats: [
      { icon: Eye, title: "Visão multimodal", desc: "Recebe uma foto no WhatsApp e entende o conteúdo — comprovante, produto, documento." },
      { icon: AudioLines, title: "Voz de ponta a ponta", desc: "Transcreve áudio em PT-BR na entrada e responde com voz natural na saída.", tag: "Pro" },
      { icon: BookOpen, title: "RAG com citação", desc: "PDFs, planilhas e catálogos viram conhecimento. Responde com a fonte — sem alucinar." },
      { icon: BrainCircuit, title: "Memória cross-session", desc: "Lembra de cada contato entre conversas. Quanto mais usa, mais o agente entende." },
      { icon: Plug, title: "MCP client", desc: "Conecta qualquer servidor MCP via JSON-RPC e dá novas ferramentas ao agente sem código." },
      { icon: Gauge, title: "Cache de respostas", desc: "FAQs repetidas saem do cache — até 80% menos custo de LLM, resposta instantânea." },
    ],
  },
  {
    id: "automacao",
    label: "Automação",
    heading: "Playbooks visuais que fazem o trabalho.",
    sub: "Desenhe fluxos arrastando blocos: gatilho, decisão, IA, integração, cobrança e hand-off. O canvas executa e mostra o caminho ao vivo.",
    feats: [
      { icon: GitBranch, title: "Editor de playbooks", desc: "Canvas estilo n8n com 19 blocos — triggers e ações. Arraste, conecte e publique." },
      { icon: Users, title: "Roteamento por especialista", desc: "Múltiplos agentes no mesmo canvas; o fluxo roteia pra vendas, suporte ou financeiro sozinho." },
      { icon: CalendarClock, title: "Agendamento (cron)", desc: "Follow-up, NPS e reativação disparam na hora certa, sem ninguém apertar botão." },
      { icon: Store, title: "Marketplace de templates", desc: "Comece de um playbook pronto — recuperação de carrinho, qualificação SDR, triagem com RAG." },
      { icon: Wand2, title: "Skills auto-evolutivas", desc: "O agente extrai e arquiva novas habilidades a partir das próprias conversas.", tag: "Business" },
      { icon: Code2, title: "CodeAct (sandbox)", desc: "Executa Python isolado quando o fluxo precisa de cálculo ou lógica sob medida.", tag: "Business" },
    ],
  },
  {
    id: "governanca",
    label: "Governança",
    heading: "Controle, custo e conformidade.",
    sub: "Cada mensagem é medida, cada dado sensível é protegido e cada gasto tem teto. Visibilidade total da operação.",
    feats: [
      { icon: ShieldCheck, title: "Guardrails", desc: "Detecta prompt injection e jailbreak antes do modelo responder — com fail-open seguro." },
      { icon: EyeOff, title: "Redação de PII (BR)", desc: "CPF, CNPJ, cartão, e-mail e telefone são mascarados antes de ir pro LLM. Ligado por padrão." },
      { icon: Wallet, title: "Budget guard", desc: "Cota de gasto por plano, alerta em 80% e pausa automática quando estoura o teto." },
      { icon: BarChart3, title: "Métricas de custo", desc: "Tokens, custo e latência por agente, modelo e conversa — num dashboard só." },
      { icon: ScrollText, title: "Trilha de auditoria", desc: "Tudo registrado: quem mudou o quê, quando, e cada decisão do agente." },
      { icon: Wallet, title: "Cobrança integrada", desc: "Gera Pix e cobra no fluxo via Tier Pay, com split nativo — sem sair da conversa." },
    ],
  },
];

function FeatureRow({ group }: { group: Group }) {
  return (
    <section id={group.id} className="scroll-mt-20 border-b border-hairline">
      <div className="max-w-[1180px] mx-auto px-6 py-16 lg:py-20">
        <div className="max-w-[620px]">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-accent">{group.label}</span>
          <h2 className="font-display mt-3 text-[clamp(26px,3.4vw,38px)] font-semibold tracking-display text-ink leading-tight">
            {group.heading}
          </h2>
          <p className="mt-3 text-[16px] text-[#4a5159] leading-relaxed">{group.sub}</p>
        </div>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border border-line rounded-xl overflow-hidden">
          {group.feats.map((f, i) => {
            const cols = 3;
            const lastRowStart = group.feats.length - (group.feats.length % cols || cols);
            const notLastRow = i < lastRowStart;
            const notLastCol = (i + 1) % cols !== 0;
            return (
              <div
                key={f.title}
                className={`p-6 bg-white hover:bg-surface-subtle transition-colors ${notLastRow ? "border-b border-hairline" : ""} ${
                  notLastCol ? "md:border-r border-hairline" : ""
                }`}
              >
                <div
                  className="w-9 h-9 rounded-md bg-accent/[0.06] flex items-center justify-center"
                  style={{ boxShadow: "0 0 0 1px rgba(0,48,131,.12)" }}
                >
                  <f.icon className="w-4 h-4 text-accent" />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">{f.title}</h3>
                  {f.tag && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent bg-accent/[0.07] px-1.5 py-0.5 rounded-full">
                      {f.tag}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13px] text-[#6A7385] leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function Recursos() {
  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-hairline">
        <div className="absolute inset-0 bg-dots-lg opacity-50" />
        <div className="absolute inset-y-0 left-0 w-8 hatch hidden lg:block" />
        <div className="absolute inset-y-0 right-0 w-8 hatch hidden lg:block" />
        <IsoCube className="absolute bottom-6 right-8 w-28 hidden lg:block opacity-90" />
        <div className="relative max-w-[1180px] mx-auto px-6 pt-20 pb-16">
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-surface-muted border border-line text-[12px] font-medium text-[#3a3f47]">
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Tudo que o agente sabe fazer
          </span>
          <h1 className="font-display text-balance mt-6 text-[clamp(36px,5.5vw,60px)] font-semibold leading-[1.04] tracking-display text-ink max-w-[820px]">
            Uma plataforma. Quatro superpoderes.
          </h1>
          <p className="mt-5 text-[18px] leading-relaxed text-[#4a5159] max-w-[640px]">
            Do primeiro "oi" no WhatsApp ao Pix pago, o Tier Agent atende, entende, automatiza e governa —
            tudo sob uma persona só.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            {GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                className="h-9 px-3.5 inline-flex items-center rounded-md border border-line bg-white hover:bg-surface-muted text-[14px] font-medium text-ink transition-colors"
              >
                {g.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {GROUPS.map((g) => (
        <FeatureRow key={g.id} group={g} />
      ))}

      {/* Faixa canais */}
      <section className="border-b border-hairline bg-surface-subtle">
        <div className="max-w-[1180px] mx-auto px-6 py-14 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9AA4B2] mb-5">Canais suportados</p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[16px] font-semibold text-[#6A7385]">
            {["WhatsApp", "Instagram", "Telegram", "E-mail", "Widget Web"].map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <Link
            to="/plataforma"
            className="mt-7 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover"
          >
            Ver como a plataforma funciona <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      <FinalCTA />
      <MarketingFooter />
    </div>
  );
}

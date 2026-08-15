import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  Clock,
  ChevronDown,
  GitBranch,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  UserSquare,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";

import {
  BranchSplit,
  FinalCTA,
  FlowEdge,
  FlowNode,
  IsoCube,
  MarketingFooter,
  MarketingNav,
} from "../../components/landing/marketing";
import AgentResearchDemo from "../../components/landing/AgentResearchDemo";
import PlaybookDemo from "../../components/landing/PlaybookDemo";
import { GridFade, Spotlight } from "../../components/landing/effects";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Item, StaggerIn } from "../../components/landing/motion";
import {
  AgentsMenuIcon,
  ConversationsMenuIcon,
  LeadsMenuIcon,
  MetricsMenuIcon,
  OverviewMenuIcon,
  PlaybooksMenuIcon,
} from "../../components/icons/menuIcons";

type HeroTabId = "atendimento" | "playbooks" | "fontes" | "metricas";

const HERO_TABS: { id: HeroTabId; label: string; summary: string }[] = [
  { id: "atendimento", label: "Atendimento", summary: "Inbox, lead, resposta e handoff no mesmo operador." },
  { id: "playbooks", label: "Playbooks", summary: "Fluxos que escutam, decidem, cobram e entregam contexto." },
  { id: "fontes", label: "Fontes", summary: "ERP, Hovio Pet e MCP custom conectados por agente." },
  { id: "metricas", label: "Métricas", summary: "Custo, latência, cobertura e saúde da operação ao vivo." },
];

const CUSTOMERS = ["Kirvah", "Hovio", "M7", "Out Group", "Esneper", "Petdubem"];

const SOURCE_CARDS = [
  {
    name: "Tier Empresas ERP",
    status: "Conectado",
    tools: "12 tools",
    scope: "financeiro:read · vendas:read",
    detail: "DRE, recebimentos, pedidos e métricas comerciais do ERP.",
  },
  {
    name: "Hovio Pet",
    status: "Conectado",
    tools: "9 tools",
    scope: "pet:read · pet:write · pet:whatsapp",
    detail: "Clientes, pets, agenda, financeiro e WhatsApp do petshop.",
  },
  {
    name: "Servidor MCP custom",
    status: "Pronto para plugar",
    tools: "JSON-RPC",
    scope: "URL + auth do provider",
    detail: "Conecte qualquer stack que fale MCP sem reescrever o Agent.",
  },
];

const METRIC_ROWS = [
  { name: "Recuperação de carrinho", cost: "R$ 42,30", latency: "1,4s", coverage: "92%" },
  { name: "Cobrança automática", cost: "R$ 18,10", latency: "1,1s", coverage: "98%" },
  { name: "Triagem com RAG", cost: "R$ 25,40", latency: "1,8s", coverage: "87%" },
  { name: "Atendente WhatsApp", cost: "R$ 63,80", latency: "1,3s", coverage: "95%" },
];

const ATTIO_SOURCE_CONNECTIONS = [
  {
    name: "Tier Empresas ERP",
    status: "Conectada",
    tools: "12 tools",
    scope: "financeiro:read Â· vendas:read",
    detail: "DRE, recebimentos, pedidos e saÃºde comercial da operaÃ§Ã£o.",
    result: "Teste automÃ¡tico aprovado",
  },
  {
    name: "Hovio Pet",
    status: "Conectada",
    tools: "9 tools",
    scope: "pet:read Â· pet:write Â· pet:whatsapp",
    detail: "Clientes, pets, agenda, financeiro e WhatsApp do petshop.",
    result: "3 aÃ§Ãµes disponÃ­veis",
  },
  {
    name: "Servidor MCP custom",
    status: "Pronto para plugar",
    tools: "JSON-RPC",
    scope: "URL + auth do provider",
    detail: "Conecte qualquer stack que fale MCP sem reescrever o Agent.",
    result: "FormulÃ¡rio pronto",
  },
];

const ATTIO_SOURCE_TOOLS = [
  { name: "Consultar DRE e recebimentos", provider: "Tier Empresas ERP", detail: "LÃª indicadores financeiros e cobranÃ§as abertas." },
  { name: "Criar cliente e agendamento", provider: "Hovio Pet", detail: "Abre cadastro e marca agenda sem sair do fluxo." },
  { name: "Disparar rota MCP custom", provider: "Servidor MCP custom", detail: "Aciona ferramenta externa dentro do playbook." },
  { name: "Testar autenticaÃ§Ã£o e listar tools", provider: "CatÃ¡logo", detail: "Traduz capabilities tÃ©cnicas para linguagem de operaÃ§Ã£o." },
];

const ATTIO_METRIC_SERIES = [
  { label: "07", value: 26 },
  { label: "08", value: 32 },
  { label: "09", value: 30 },
  { label: "10", value: 44 },
  { label: "11", value: 41 },
  { label: "12", value: 53 },
  { label: "13", value: 61 },
  { label: "14", value: 57 },
];

const ATTIO_METRIC_BREAKDOWN = [
  { name: "Atendente WhatsApp", runs: "1.482", cost: "R$ 63,80", latency: "1,3s" },
  { name: "CobranÃ§a automÃ¡tica", runs: "914", cost: "R$ 18,10", latency: "1,1s" },
  { name: "RecuperaÃ§Ã£o de carrinho", runs: "706", cost: "R$ 42,30", latency: "1,4s" },
  { name: "Triagem com RAG", runs: "388", cost: "R$ 25,40", latency: "1,8s" },
];

const OPERATOR_CARDS = [
  {
    icon: ShieldCheck,
    title: "Humano no loop",
    text: "Pedido explícito de ajuda, frustração detectada ou regra crítica pausam o bot com contexto completo para a equipe.",
  },
  {
    icon: Sparkles,
    title: "RAG com citação",
    text: "A base de conhecimento entra na resposta com fonte e contexto. Menos improviso, menos retrabalho e menos resposta vaga.",
  },
  {
    icon: Activity,
    title: "Custo visível",
    text: "Tokens, latência, execuções e cobertura ficam legíveis por agente e por playbook, sem esconder o preço da operação.",
  },
];

const ENTERPRISE_CARDS = [
  { title: "Governança", text: "Guardrails, auditoria, consentimento e trilha de execução por agente." },
  { title: "Segurança", text: "Escopos por fonte, credenciais criptografadas e separação por tenant." },
  { title: "Confiabilidade", text: "WhatsApp oficial, fallback para humano e operação pensada para uso diário." },
];

function HeroTabButton({
  active,
  label,
  summary,
  onClick,
}: {
  active: boolean;
  label: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-h-[74px] flex-col items-center justify-center gap-1 border-r border-hairline px-4 py-4 text-center last:border-r-0 transition-colors ${
        active ? "bg-white text-ink" : "bg-surface-subtle text-[#6A7385] hover:bg-white"
      }`}
    >
      <span className="text-[14px] font-semibold">{label}</span>
      <span className="max-w-[220px] text-[11.5px] leading-[1.4]">{summary}</span>
      <span
        className={`absolute bottom-0 left-1/2 h-[3px] w-[58px] -translate-x-1/2 rounded-full transition-colors ${
          active ? "bg-ink" : "bg-transparent"
        }`}
      />
    </button>
  );
}

function MiniKpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good";
}) {
  return (
    <div className={`rounded-[14px] border p-3 ${tone === "good" ? "border-success/25 bg-flow-okbg/60" : "border-line bg-white"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">{label}</div>
      <div className="mt-2 font-display text-[28px] font-semibold tracking-display text-ink leading-none">{value}</div>
    </div>
  );
}

function ConversationStage() {
  return (
    <div className="grid min-h-[430px] lg:grid-cols-[250px_1fr_280px]">
      <div className="border-b border-hairline bg-surface-subtle p-4 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-white px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-[#9AA4B2]" />
          <span className="text-[12px] text-[#9AA4B2]">Buscar conversa, lead ou playbook</span>
        </div>
        <div className="mt-4 space-y-2">
          {[
            { name: "Marina Souza", tag: "Lead pronta", active: true },
            { name: "Lucas Pet", tag: "Cobrança pendente" },
            { name: "Bianca M7", tag: "Handoff humano" },
          ].map((item) => (
            <div
              key={item.name}
              className={`rounded-[14px] border px-3 py-3 ${
                item.active ? "border-line bg-white shadow-sm" : "border-transparent bg-transparent"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink">{item.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${item.active ? "bg-flow-okbg text-flow-okfg" : "bg-surface-muted text-[#6A7385]"}`}>
                  {item.tag}
                </span>
              </div>
              <div className="mt-1 text-[11.5px] leading-[1.45] text-[#6A7385]">
                Histórico, última mensagem e próxima ação sugerida pelo Agent.
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-hairline p-5 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <div className="text-[14px] font-semibold text-ink">Marina Souza · WhatsApp oficial</div>
            <div className="mt-1 text-[11.5px] text-[#6A7385]">Cliente recorrente · ticket médio R$ 1.240 · sem atraso</div>
          </div>
          <span className="inline-flex h-[28px] items-center rounded-full bg-flow-okbg px-3 text-[11px] font-semibold text-flow-okfg">
            IA ativa
          </span>
        </div>
        <div className="space-y-3 py-5">
          <div className="max-w-[72%] rounded-[16px] border border-line bg-surface-subtle px-4 py-3 text-[13px] leading-relaxed text-[#4a5159]">
            Oi, queria retomar o carrinho e saber se consigo pagar no Pix.
          </div>
          <div className="ml-auto max-w-[72%] rounded-[16px] bg-cta px-4 py-3 text-[13px] leading-relaxed text-white shadow-sm">
            Consigo sim. Você já comprou com a gente antes, então mantive o mesmo catálogo e já deixei o Pix pronto se quiser fechar agora.
          </div>
          <div className="max-w-[72%] rounded-[16px] border border-line bg-surface-subtle px-4 py-3 text-[13px] leading-relaxed text-[#4a5159]">
            Pode me mandar e separar pra entrega amanhã?
          </div>
          <div className="ml-auto max-w-[72%] rounded-[16px] bg-cta px-4 py-3 text-[13px] leading-relaxed text-white shadow-sm">
            Feito. O Agent confirmou o histórico, acionou a cobrança e criou o handoff para o time logístico já com tudo preenchido.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          {["Responder com IA", "Abrir handoff", "Enviar cobrança", "Criar lead"].map((action) => (
            <span key={action} className="inline-flex h-8 items-center rounded-full border border-line bg-white px-3 text-[11.5px] font-medium text-ink shadow-sm">
              {action}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-surface-subtle p-5">
        <div className="rounded-[16px] border border-line bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3 border-b border-hairline pb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-[13px] font-semibold text-accent">
              MS
            </div>
            <div>
              <div className="text-[14px] font-semibold text-ink">Perfil ao vivo</div>
              <div className="text-[11.5px] text-[#6A7385]">Contexto que o Agent já puxou</div>
            </div>
          </div>
          <div className="mt-3 space-y-2.5">
            {[
              { icon: UserSquare, label: "Cliente", value: "Marina Souza" },
              { icon: Tag, label: "Segmento", value: "Recorrente · Varejo" },
              { icon: Wallet, label: "Ticket médio", value: "R$ 1.240" },
              { icon: Clock, label: "Último pedido", value: "há 3 dias" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2.5 text-[12px]">
                <item.icon className="h-3.5 w-3.5 shrink-0 text-[#9AA4B2]" />
                <span className="w-[84px] shrink-0 text-[#6A7385]">{item.label}</span>
                <span className="font-medium text-ink">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniKpi label="Handoff" value="1" />
            <MiniKpi label="Lead score" value="92" tone="good" />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowStage() {
  return (
    <div className="grid min-h-[430px] lg:grid-cols-[1fr_260px]">
      <div className="relative overflow-hidden bg-dots p-6">
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-8 hatch lg:block" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-8 hatch lg:block" />
        <div className="relative flex flex-col items-center pt-10">
          <FlowNode icon={Zap} title="Mensagem recebida" subtitle="WhatsApp oficial · gatilho inbound" tag="Trigger" color="#8B5CF6" status="completed" trigger />
          <FlowEdge active />
          <FlowNode icon={GitBranch} title="Classifica a intenção" subtitle="Detecta cobrança, suporte ou venda" tag="Switch" color="#F5A300" status="completed" />
          <BranchSplit leftLabel="Venda" rightLabel="Suporte" activeRight={false} />
          <div className="mt-6 flex flex-wrap items-start justify-center gap-6">
            <FlowNode icon={Bot} title="Qualifica e responde" subtitle="Memória + RAG + cobrança" tag="Agent" color="#003083" status="running" />
            <FlowNode icon={ShieldCheck} title="Abre handoff" subtitle="Fila humana com contexto completo" tag="Queue" color="#16191C" dim />
          </div>
        </div>
      </div>

      <div className="border-t border-hairline bg-white p-5 lg:border-l lg:border-t-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Execuções</div>
        <div className="mt-4 space-y-2">
          {[
            { id: "#70", status: "Rodando", detail: "Carrinho abandonado · 3 passos" },
            { id: "#69", status: "Concluído", detail: "Cobrança Pix · 11 passos" },
            { id: "#68", status: "Concluído", detail: "Triagem com RAG · 8 passos" },
            { id: "#67", status: "Concluído", detail: "Lead SDR · 6 passos" },
          ].map((row, index) => (
            <div key={row.id} className="rounded-[14px] border border-line bg-surface-subtle px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink">{row.id}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    index === 0 ? "bg-flow-runbg text-flow-runfg" : "bg-flow-okbg text-flow-okfg"
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <div className="mt-1 text-[11.5px] text-[#6A7385]">{row.detail}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniKpi label="Concluídas" value="70" tone="good" />
          <MiniKpi label="Falhas" value="0" />
          <MiniKpi label="Tempo médio" value="18s" />
          <MiniKpi label="Em fila" value="1" />
        </div>
      </div>
    </div>
  );
}

function SourceBoard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[22px] border border-line bg-white shadow-sm ${compact ? "" : "max-w-[940px]"}`}>
      <div className="grid border-b border-hairline bg-surface-subtle lg:grid-cols-[1fr_260px]">
        <div className={`${compact ? "p-4" : "p-5"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Fontes ativas</div>
          <div className="mt-1 text-[13px] text-[#6A7385]">
            O Agent entende o que pode consultar, mutar e testar em cada provider.
          </div>
        </div>
        <div className={`border-t border-hairline bg-white lg:border-l lg:border-t-0 ${compact ? "p-4" : "p-5"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Descoberta</div>
          <div className="mt-2 text-[14px] font-semibold text-ink">List tools + test automático</div>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_260px]">
        <div className={`space-y-3 border-b border-hairline bg-white lg:border-b-0 ${compact ? "p-4" : "p-5"}`}>
          {SOURCE_CARDS.map((card) => (
            <div key={card.name} className="rounded-[16px] border border-line bg-surface-subtle p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-7 items-center rounded-full bg-accent/[0.08] px-3 text-[11px] font-semibold text-accent">
                  {card.tools}
                </span>
                <span className={`inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ${card.status === "Conectado" ? "bg-flow-okbg text-flow-okfg" : "bg-white text-[#6A7385] border border-line"}`}>
                  {card.status}
                </span>
              </div>
              <div className="mt-3 text-[14px] font-semibold text-ink">{card.name}</div>
              <div className="mt-1 text-[12px] text-[#6A7385]">{card.scope}</div>
              <div className="mt-2 text-[12.5px] leading-relaxed text-[#4a5159]">{card.detail}</div>
            </div>
          ))}
        </div>
        <div className={`bg-surface-subtle ${compact ? "p-4" : "p-5"}`}>
          <div className="rounded-[16px] border border-line bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">O que o Agent pode fazer</div>
            <div className="mt-3 space-y-2.5">
              {[
                "Consultar DRE e recebimentos do ERP",
                "Criar cliente, pet e agendamento no Hovio Pet",
                "Disparar tool MCP custom dentro de um playbook",
                "Testar autenticação e listar tools traduzidas na UI",
              ].map((line) => (
                <div key={line} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#4a5159]">
                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricsBoard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[22px] border border-line bg-white shadow-sm ${compact ? "" : "max-w-[960px]"}`}>
      <div className={`grid gap-3 border-b border-hairline bg-surface-subtle sm:grid-cols-2 xl:grid-cols-4 ${compact ? "p-4" : "p-5"}`}>
        <MiniKpi label="Custo / dia" value="R$ 149" />
        <MiniKpi label="Latência média" value="1,4s" />
        <MiniKpi label="Cobertura" value="93%" tone="good" />
        <MiniKpi label="Humano no loop" value="7%" />
      </div>
      <div className="grid lg:grid-cols-[1fr_250px]">
        <div className={`${compact ? "p-4" : "p-5"}`}>
          <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3">
            <div>
              <div className="text-[14px] font-semibold text-ink">Saúde por agente e por playbook</div>
              <div className="mt-1 text-[11.5px] text-[#6A7385]">Tokens, custo, latência e cobertura legíveis sem abrir planilha.</div>
            </div>
            <span className="inline-flex h-7 items-center rounded-full bg-flow-okbg px-3 text-[11px] font-semibold text-flow-okfg">
              Atualizado agora
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-[16px] border border-line">
            <div className="grid grid-cols-[1.4fr_.8fr_.8fr_.8fr] bg-surface-subtle px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#9AA4B2]">
              <span>Playbook</span>
              <span>Custo</span>
              <span>Latência</span>
              <span>Cobertura</span>
            </div>
            {METRIC_ROWS.map((row) => (
              <div key={row.name} className="grid grid-cols-[1.4fr_.8fr_.8fr_.8fr] items-center border-t border-hairline px-4 py-3 text-[12.5px] text-[#4a5159]">
                <span className="font-medium text-ink">{row.name}</span>
                <span>{row.cost}</span>
                <span>{row.latency}</span>
                <span className="font-medium text-ink">{row.coverage}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`border-t border-hairline bg-surface-subtle lg:border-l lg:border-t-0 ${compact ? "p-4" : "p-5"}`}>
          <div className="rounded-[16px] border border-line bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Leitura rápida</div>
            <div className="mt-3 space-y-3">
              {[
                { label: "Agente mais eficiente", value: "Cobrança automática" },
                { label: "Maior cobertura", value: "Atendente WhatsApp" },
                { label: "Maior latência", value: "Triagem com RAG" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[11.5px] text-[#9AA4B2]">{item.label}</div>
                  <div className="mt-1 text-[13px] font-semibold text-ink">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

if (false) {
  void [ConversationStage, WorkflowStage, SourceBoard, MetricsBoard];
}

function AttioConversationStage() {
  return (
    <div className="grid min-h-[444px] lg:grid-cols-[236px_1fr_296px]">
      <div className="border-b border-hairline bg-surface-subtle p-4 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Inbox</div>
          <span className="text-[11px] text-[#6A7385]">3 abertas</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-line bg-white px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-[#9AA4B2]" />
          <span className="text-[12px] text-[#9AA4B2]">Buscar conversa, lead ou playbook</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Todas", "Leads", "Handoffs"].map((filter, index) => (
            <span
              key={filter}
              className={`inline-flex h-7 items-center rounded-full px-3 text-[11px] font-medium ${
                index === 0 ? "border border-line bg-white text-ink shadow-sm" : "text-[#6A7385]"
              }`}
            >
              {filter}
            </span>
          ))}
        </div>
        <div className="mt-4 space-y-1.5">
          {[
            { name: "Marina Souza", time: "09:41", preview: "Queria retomar o carrinho e pagar no Pix.", status: "Lead pronta", active: true },
            { name: "Lucas Pet", time: "09:18", preview: "Pode me mandar a cobrança do banho?", status: "Cobrança pendente" },
            { name: "Bianca M7", time: "08:52", preview: "Preciso falar com uma pessoa do time.", status: "Handoff humano" },
          ].map((item) => (
            <div
              key={item.name}
              className={`rounded-[14px] px-3 py-3 transition-colors ${
                item.active ? "border border-line bg-white shadow-sm" : "border border-transparent bg-transparent hover:bg-white/70"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-ink">{item.name}</span>
                <span className="ml-auto text-[10.5px] text-[#9AA4B2]">{item.time}</span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.45] text-[#4A5159]">{item.preview}</div>
              <div className="mt-2">
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${item.active ? "bg-flow-okbg text-flow-okfg" : "border border-line bg-white text-[#6A7385]"}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-hairline bg-white p-5 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <div className="text-[14px] font-semibold text-ink">Marina Souza · WhatsApp oficial</div>
            <div className="mt-1 text-[11.5px] text-[#6A7385]">Cliente recorrente · ticket médio R$ 1.240 · sem atraso</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[28px] items-center rounded-full border border-line bg-white px-3 text-[11px] font-medium text-[#6A7385]">
              Lead pronta
            </span>
            <span className="inline-flex h-[28px] items-center rounded-full bg-flow-okbg px-3 text-[11px] font-semibold text-flow-okfg">
              IA ativa
            </span>
          </div>
        </div>

        <div className="py-5">
          <div className="max-w-[70%] rounded-[16px] border border-line bg-surface-subtle px-4 py-3 text-[13px] leading-relaxed text-[#4A5159]">
            Oi, queria retomar o carrinho e saber se consigo pagar no Pix e separar para amanhã.
          </div>

          <div className="mt-4 overflow-hidden rounded-[18px] border border-line bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-accent/[0.08] text-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[12.5px] font-semibold text-ink">Resposta pronta</div>
                  <div className="text-[11px] text-[#6A7385]">Histórico, cobrança e logística já aplicados</div>
                </div>
              </div>
              <span className="text-[11px] text-[#6A7385]">1,2s</span>
            </div>
            <div className="px-4 py-4 text-[13px] leading-relaxed text-[#4A5159]">
              Consigo sim. Mantive o mesmo catálogo da compra anterior, deixei o Pix pronto e já sinalizei a separação para entrega amanhã.
            </div>
            <div className="flex flex-wrap gap-2 border-t border-hairline px-4 py-3">
              {["Editar resposta", "Enviar agora", "Abrir handoff"].map((action, index) => (
                <span
                  key={action}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-[11.5px] font-medium ${
                    index === 1 ? "bg-cta text-white shadow-sm" : "border border-line bg-white text-ink"
                  }`}
                >
                  {action}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { title: "Pix criado", detail: "Cobrança pronta com valor e vencimento corretos." },
              { title: "Handoff logístico", detail: "Fila humana aberta com contexto e pedido preenchido." },
            ].map((item) => (
              <div key={item.title} className="rounded-[16px] border border-line bg-surface-subtle px-4 py-3">
                <div className="text-[12px] font-semibold text-ink">{item.title}</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-[#6A7385]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-surface-subtle">
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-[13px] font-semibold text-accent">
              MS
            </div>
            <div>
              <div className="text-[14px] font-semibold text-ink">Contexto ao vivo</div>
              <div className="text-[11.5px] text-[#6A7385]">O que o Agent puxou antes de responder</div>
            </div>
          </div>
        </div>
        <div className="space-y-0">
          {[
            { icon: UserSquare, label: "Cliente", value: "Marina Souza" },
            { icon: Tag, label: "Segmento", value: "Recorrente · Varejo" },
            { icon: Wallet, label: "Ticket médio", value: "R$ 1.240" },
            { icon: Clock, label: "Último pedido", value: "há 3 dias" },
          ].map((item, index) => (
            <div key={item.label} className={`flex items-center gap-2.5 px-5 py-3 text-[12px] ${index < 3 ? "border-b border-hairline" : ""}`}>
              <item.icon className="h-3.5 w-3.5 shrink-0 text-[#9AA4B2]" />
              <span className="w-[84px] shrink-0 text-[#6A7385]">{item.label}</span>
              <span className="font-medium text-ink">{item.value}</span>
            </div>
          ))}
        </div>
        <div className="border-y border-hairline px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Próximos passos</div>
          <div className="mt-3 space-y-2.5">
            {[
              "Confirmar envio do Pix se o cliente responder.",
              "Acionar humano só se houver exceção de estoque.",
              "Atualizar lead score depois do pagamento.",
            ].map((step) => (
              <div key={step} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#4A5159]">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {step}
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2">
          <div className="border-r border-hairline px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Handoff</div>
            <div className="mt-2 font-display text-[28px] font-semibold leading-none tracking-display text-ink">1</div>
          </div>
          <div className="bg-flow-okbg/55 px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-flow-okfg">Lead score</div>
            <div className="mt-2 font-display text-[28px] font-semibold leading-none tracking-display text-ink">92</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttioWorkflowStage() {
  return (
    <div className="flex min-h-[444px] flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-hairline bg-white px-4">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        </div>
        <div className="flex items-center gap-1.5 text-[13px]">
          <Workflow className="h-4 w-4 text-[#6A7385]" />
          <span className="font-medium text-ink">Playbooks</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-medium text-success">Ao vivo</span>
          <span className="relative h-[18px] w-8 rounded-full bg-success/90">
            <span className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
          </span>
        </div>
      </div>

      <div className="grid flex-1 lg:grid-cols-[190px_1fr_276px]">
        <div className="border-b border-hairline bg-surface-subtle px-3 py-3 lg:border-b-0 lg:border-r">
          <button className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-white px-2 shadow-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cta">
              <span className="h-2 w-2 rounded-[2px] bg-white" />
            </span>
            <span className="text-[13px] font-semibold text-ink">Tier Agent</span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-[#9AA4B2]" />
          </button>
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-hairline bg-surface-muted px-2.5 py-2">
            <Search className="h-3.5 w-3.5 text-[#9AA4B2]" />
            <span className="text-[12px] text-[#9AA4B2]">Ações rápidas</span>
            <span className="ml-auto rounded border border-hairline bg-white px-1 py-0.5 text-[10px] text-[#9AA4B2]">⌘K</span>
          </div>
          <div className="mt-3 space-y-1">
            {[
              { icon: OverviewMenuIcon, label: "Início" },
              { icon: ConversationsMenuIcon, label: "Conversas" },
              { icon: LeadsMenuIcon, label: "Leads" },
              { icon: PlaybooksMenuIcon, label: "Playbooks", active: true },
              { icon: AgentsMenuIcon, label: "Agentes" },
              { icon: MetricsMenuIcon, label: "Métricas" },
            ].map((item) => (
              <div
                key={item.label}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${
                  item.active ? "bg-white font-medium text-ink shadow-sm" : "text-[#6A7385]"
                }`}
              >
                <item.icon className={`h-4 w-4 ${item.active ? "text-accent" : "text-[#9AA4B2]"}`} />
                {item.label}
              </div>
            ))}
          </div>
          <div className="mt-4 px-1">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#B4BBC6]">Favoritos</div>
            <div className="space-y-2">
              {["Recuperação de carrinho", "Qualificação SDR", "Triagem com RAG"].map((item, index) => (
                <div key={item} className={`flex items-center gap-2 text-[12px] ${index === 0 ? "font-medium text-accent" : "text-[#9AA4B2]"}`}>
                  <Workflow className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col border-b border-hairline lg:border-b-0 lg:border-r">
          <div className="flex h-11 items-center gap-5 border-b border-hairline bg-white px-5">
            <span className="text-[13px] font-medium text-[#9AA4B2]">Editor</span>
            <span className="inline-flex h-11 items-center border-b-2 border-accent text-[13px] font-semibold text-ink">
              Execuções <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-[#6A7385]">70</span>
            </span>
          </div>
          <div className="relative flex-1 overflow-hidden bg-dots px-7 pb-10 pt-7">
            <span className="mb-8 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-flow-okbg px-2.5 text-[10.5px] font-semibold text-flow-okfg">
              <span className="h-1.5 w-1.5 rounded-full bg-flow-okfg" /> Execução #70
            </span>
            <div className="flex flex-col items-center">
              <FlowNode icon={Zap} title="Carrinho abandonado" subtitle="Dispara em uma conversa de venda" tag="Gatilho" color="#8B5CF6" status="completed" trigger />
              <FlowEdge active />
              <FlowNode icon={Bot} title="Pesquisa o cliente" subtitle="Levanta histórico e perfil de compra" tag="Agente" color="#003083" status="completed" />
              <FlowEdge active />
              <FlowNode icon={GitBranch} title="Decide a abordagem" subtitle="Roteia conforme a intenção do cliente" tag="Condições" color="#F5A300" status="running" />
              <BranchSplit leftLabel="Comprar" rightLabel="Suporte" activeRight={false} />
              <div className="mt-5 grid w-full max-w-[420px] grid-cols-3 gap-3">
                {["Comprar", "Negociar", "Suporte"].map((branch) => (
                  <div key={branch} className="rounded-xl border border-line bg-white py-1.5 text-center text-[11px] font-medium text-[#8A93A1]">
                    {branch}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-white">
          <div className="flex-1">
            {[
              { id: "#70", detail: "Carrinho abandonado", steps: "3", running: true },
              { id: "#69", detail: "Cobrança Pix", steps: "15" },
              { id: "#68", detail: "Triagem com RAG", steps: "11" },
              { id: "#67", detail: "Lead SDR", steps: "11" },
              { id: "#66", detail: "Onboarding", steps: "16" },
            ].map((row, index) => (
              <div key={row.id} className="flex h-[46px] items-center gap-2.5 border-b border-hairline px-4">
                {row.running ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-node-trigger" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success">
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                  </span>
                )}
                <span className="whitespace-nowrap text-[13px] font-medium text-ink">Execução {row.id}</span>
                <span className="inline-flex min-w-[19px] items-center justify-center rounded-full border border-hairline bg-surface-muted px-1 text-[9.5px] font-semibold tabular-nums text-[#9AA4B2]">
                  {row.steps}
                </span>
                <span className="truncate text-[12px] text-[#6A7385]">{row.detail}</span>
                <span className="ml-auto whitespace-nowrap text-[11.5px] text-[#9AA4B2]">{row.running ? "rodando" : `${index} min`}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-hairline p-4">
            <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#9AA4B2]">Overview</div>
            <div className="grid grid-cols-2 gap-2.5">
              <MiniKpi label="Concluídas" value="70" tone="good" />
              <MiniKpi label="Falhas" value="0" />
              <MiniKpi label="Em andamento" value="1" />
              <MiniKpi label="Tempo médio" value="18s" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttioSourceBoard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[22px] border border-line bg-white shadow-sm ${compact ? "" : "max-w-[960px]"}`}>
      <div className="flex h-12 items-center gap-3 border-b border-hairline bg-white px-4">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        </div>
        <div className="text-[13px] font-medium text-ink">Fontes de dados</div>
        <div className="ml-auto inline-flex h-7 items-center rounded-full border border-line bg-white px-3 text-[11px] font-medium text-[#6A7385]">
          Agente ativo: Tier Agent
        </div>
      </div>
      <div className="grid min-h-[420px] lg:grid-cols-[218px_1fr_280px]">
        <div className="border-b border-hairline bg-surface-subtle p-4 lg:border-b-0 lg:border-r">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Providers</div>
          <div className="mt-3 space-y-1.5">
            {ATTIO_SOURCE_CONNECTIONS.map((card, index) => (
              <div
                key={card.name}
                className={`rounded-[14px] border px-3 py-3 ${
                  index === 0 ? "border-line bg-white shadow-sm" : "border-transparent bg-transparent hover:bg-white/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{card.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${card.status === "Conectada" ? "bg-flow-okbg text-flow-okfg" : "border border-line bg-white text-[#6A7385]"}`}>
                    {card.status}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-[#6A7385]">{card.scope}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-hairline bg-white lg:border-b-0 lg:border-r">
          <div className={`${compact ? "p-4" : "p-5"} border-b border-hairline`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center rounded-full bg-accent/[0.08] px-3 text-[11px] font-semibold text-accent">
                12 tools
              </span>
              <span className="inline-flex h-7 items-center rounded-full bg-flow-okbg px-3 text-[11px] font-semibold text-flow-okfg">
                Conectada
              </span>
            </div>
            <div className="mt-3 text-[16px] font-semibold text-ink">Tier Empresas ERP</div>
            <div className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-[#4A5159]">
              O Agent descobre as tools, testa autenticação e traduz capabilities técnicas para a linguagem da operação.
            </div>
          </div>
          <div className={`${compact ? "p-4" : "p-5"}`}>
            <div className="overflow-hidden rounded-[16px] border border-line">
              <div className="grid grid-cols-[1.25fr_.85fr_1.5fr] bg-surface-subtle px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#9AA4B2]">
                <span>Tool</span>
                <span>Provider</span>
                <span>Leitura na UI</span>
              </div>
              {ATTIO_SOURCE_TOOLS.map((tool) => (
                <div key={tool.name} className="grid grid-cols-[1.25fr_.85fr_1.5fr] items-center border-t border-hairline px-4 py-3 text-[12.5px] text-[#4A5159]">
                  <span className="font-medium text-ink">{tool.name}</span>
                  <span className="text-[#6A7385]">{tool.provider}</span>
                  <span>{tool.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-surface-subtle">
          <div className={`${compact ? "p-4" : "p-5"} border-b border-hairline`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Descoberta</div>
            <div className="mt-2 text-[14px] font-semibold text-ink">List tools + test automático</div>
          </div>
          <div className={`${compact ? "p-4" : "p-5"} space-y-3`}>
            {ATTIO_SOURCE_CONNECTIONS.map((card) => (
              <div key={card.name} className="rounded-[16px] border border-line bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-ink">{card.name}</span>
                  <span className="text-[11px] text-[#9AA4B2]">{card.tools}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-[#6A7385]">{card.result}</div>
              </div>
            ))}
            <div className="rounded-[16px] border border-line bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">O que o Agent pode fazer</div>
              <div className="mt-3 space-y-2.5">
                {[
                  "Consultar DRE e recebimentos do ERP",
                  "Criar cliente, pet e agendamento no Hovio Pet",
                  "Disparar tool MCP custom dentro de um playbook",
                ].map((line) => (
                  <div key={line} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#4A5159]">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttioMetricChart() {
  const chartWidth = 520;
  const chartHeight = 194;
  const chartPadding = 16;
  const maxValue = Math.max(...ATTIO_METRIC_SERIES.map((point) => point.value));
  const points = ATTIO_METRIC_SERIES.map((point, index) => {
    const x = chartPadding + (index / (ATTIO_METRIC_SERIES.length - 1)) * (chartWidth - chartPadding * 2);
    const y = chartPadding + (1 - point.value / maxValue) * (chartHeight - chartPadding * 2);
    return { ...point, x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${(chartHeight - chartPadding).toFixed(2)} L${points[0].x.toFixed(2)},${(chartHeight - chartPadding).toFixed(2)} Z`;

  return (
    <div className="mt-4 overflow-hidden rounded-[18px] border border-line bg-[#FBFBFA]">
      <div className="border-b border-hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9AA4B2]">
        Volume diário
      </div>
      <div className="relative px-4 pb-10 pt-4">
        <div className="pointer-events-none absolute inset-x-4 top-4 grid h-[194px] grid-rows-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={`${row < 3 ? "border-b border-hairline" : ""}`} />
          ))}
        </div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="relative h-[194px] w-full" preserveAspectRatio="none" aria-hidden>
          <path d={areaPath} fill="rgba(0,48,131,0.10)" />
          <path d={linePath} fill="none" stroke="#003083" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <circle
              key={point.label}
              cx={point.x}
              cy={point.y}
              r={index === points.length - 1 ? 4.5 : 3}
              fill={index === points.length - 1 ? "#003083" : "#FFFFFF"}
              stroke="#003083"
              strokeWidth="2"
            />
          ))}
        </svg>
        <div className="mt-3 flex items-center justify-between text-[10.5px] font-medium text-[#9AA4B2]">
          {ATTIO_METRIC_SERIES.map((point) => (
            <span key={point.label}>{point.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AttioMetricsBoard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[22px] border border-line bg-white shadow-sm ${compact ? "" : "max-w-[960px]"}`}>
      <div className="flex h-12 items-center gap-3 border-b border-hairline bg-white px-4">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        </div>
        <div className="text-[13px] font-medium text-ink">Métricas da operação</div>
        <div className="ml-auto flex items-center gap-1">
          {["7D", "30D", "3M"].map((period, index) => (
            <span
              key={period}
              className={`inline-flex h-8 items-center rounded-[10px] px-3 text-[11px] font-medium ${
                index === 1 ? "bg-accent text-white shadow-sm" : "text-[#6A7385]"
              }`}
            >
              {period}
            </span>
          ))}
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_264px]">
        <div className={`${compact ? "p-4" : "p-5"} border-b border-hairline lg:border-b-0 lg:border-r`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-ink">Saúde por agente e por playbook</div>
              <div className="mt-1 text-[11.5px] text-[#6A7385]">Custo, volume e latência legíveis sem abrir planilha.</div>
            </div>
            <span className="inline-flex h-7 items-center rounded-full bg-flow-okbg px-3 text-[11px] font-semibold text-flow-okfg">
              Atualizado agora
            </span>
          </div>
          <AttioMetricChart />
          <div className="mt-4 overflow-hidden rounded-[16px] border border-line">
            <div className="grid grid-cols-[1.4fr_.8fr_.8fr_.8fr] bg-surface-subtle px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#9AA4B2]">
              <span>Playbook</span>
              <span>Exec.</span>
              <span>Custo</span>
              <span>Latência</span>
            </div>
            {ATTIO_METRIC_BREAKDOWN.map((row) => (
              <div key={row.name} className="grid grid-cols-[1.4fr_.8fr_.8fr_.8fr] items-center border-t border-hairline px-4 py-3 text-[12.5px] text-[#4A5159]">
                <span className="font-medium text-ink">{row.name}</span>
                <span>{row.runs}</span>
                <span>{row.cost}</span>
                <span>{row.latency}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-subtle">
          <div className={`${compact ? "p-4" : "p-5"} border-b border-hairline`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">Leitura rápida</div>
            <div className="mt-2 text-[14px] font-semibold text-ink">Onde a operação está ganhando ou pesando</div>
          </div>
          <div className={`${compact ? "p-4" : "p-5"} space-y-3`}>
            {[
              { label: "Agente mais eficiente", value: "Cobrança automática", good: true },
              { label: "Maior volume", value: "Atendente WhatsApp" },
              { label: "Maior latência", value: "Triagem com RAG" },
            ].map((item) => (
              <div key={item.label} className={`rounded-[16px] border border-line p-4 shadow-sm ${item.good ? "bg-flow-okbg/45" : "bg-white"}`}>
                <div className="text-[11.5px] text-[#9AA4B2]">{item.label}</div>
                <div className="mt-1 text-[13px] font-semibold text-ink">{item.value}</div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2.5">
              <MiniKpi label="Custo / dia" value="R$ 149" />
              <MiniKpi label="Cobertura" value="93%" tone="good" />
              <MiniKpi label="Latência" value="1,4s" />
              <MiniKpi label="Humano loop" value="7%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StaticHeroTabs({
  activeTab,
  setActiveTab,
}: {
  activeTab: HeroTabId;
  setActiveTab: (tab: HeroTabId) => void;
}) {
  return (
    <div className="grid border-b border-hairline bg-white md:grid-cols-2 xl:grid-cols-4">
      {HERO_TABS.map((tab) => (
        <HeroTabButton key={tab.id} active={activeTab === tab.id} label={tab.label} summary={tab.summary} onClick={() => setActiveTab(tab.id)} />
      ))}
    </div>
  );
}

function SectionIntro({
  label,
  title,
  copy,
  cta,
}: {
  label: string;
  title: string;
  copy: string;
  cta: { href: string; text: string };
}) {
  return (
    <div className="p-8 lg:p-12">
      <div className="text-[12px] font-medium text-[#9AA4B2]">{label}</div>
      <h2 className="mt-3 font-display text-[clamp(28px,3.6vw,42px)] font-semibold tracking-display text-ink leading-[1.05]">
        {title}
      </h2>
      <p className="mt-4 max-w-[320px] text-[15px] leading-relaxed text-[#4a5159]">{copy}</p>
      <Link to={cta.href} className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:text-accent-hover">
        {cta.text}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export default function Landing() {
  const shouldReduceMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<HeroTabId>("atendimento");

  useEffect(() => {
    if (shouldReduceMotion) return;
    const ids = HERO_TABS.map((tab) => tab.id);
    const timer = window.setInterval(() => {
      setActiveTab((current) => {
        const index = ids.indexOf(current);
        return ids[(index + 1) % ids.length];
      });
    }, 4200);
    return () => window.clearInterval(timer);
  }, [shouldReduceMotion]);

  return (
    <div className="min-h-screen bg-surface text-ink font-sans antialiased">
      <MarketingNav />

      <section className="relative overflow-hidden border-b border-hairline">
        <GridFade className="opacity-55" />
        <Spotlight className="left-1/2 top-[5%] h-[420px] w-[860px] -translate-x-1/2" />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-8 hatch xl:block" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-8 hatch xl:block" />
        <div className="relative mx-auto max-w-[1280px] px-6 pb-16 pt-16 lg:pb-20 lg:pt-20">
          <StaggerIn>
            <Item>
              <Link
                to="/recursos#governanca"
                className="group mx-auto inline-flex h-9 items-center gap-2 rounded-full border border-line bg-white px-4 text-[12.5px] font-medium text-[#3a3f47] shadow-sm hover:border-line-strong transition-colors"
              >
                Fontes de dados MCP + WhatsApp oficial + humano no loop
                <ArrowRight className="h-3.5 w-3.5 text-[#9AA4B2] transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Item>
            <Item>
              <h1 className="mx-auto mt-8 max-w-[860px] text-balance text-center font-display text-[clamp(46px,7vw,88px)] font-semibold tracking-display text-ink leading-[0.96]">
                A plataforma de agentes feita para escalar atendimento.
              </h1>
            </Item>
            <Item>
              <p className="mx-auto mt-6 max-w-[720px] text-balance text-center text-[19px] leading-relaxed text-[#4a5159]">
                Centralize canais, memória, playbooks, dados e custo numa operação que responde 24/7 e chama um humano só quando precisa.
              </p>
            </Item>
            <Item>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/signup"
                  className="inline-flex h-12 items-center rounded-[12px] bg-cta px-5 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(13,15,17,.18)] hover:bg-cta-hover transition-colors"
                >
                  Começar agora
                </Link>
                <Link
                  to="/plataforma"
                  className="inline-flex h-12 items-center rounded-[12px] border border-line bg-white px-5 text-[15px] font-medium text-ink hover:bg-surface-subtle transition-colors"
                >
                  Ver plataforma
                </Link>
              </div>
            </Item>
          </StaggerIn>

          <motion.div
            className="mt-14"
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          >
            <div className="overflow-hidden rounded-[24px] border border-line bg-white shadow-sm">
              <StaticHeroTabs activeTab={activeTab} setActiveTab={setActiveTab} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -12 }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                  {activeTab === "atendimento" && <AttioConversationStage />}
                  {activeTab === "playbooks" && <AttioWorkflowStage />}
                  {activeTab === "fontes" && <AttioSourceBoard compact />}
                  {activeTab === "metricas" && <AttioMetricsBoard compact />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="prova" className="scroll-mt-24 border-b border-hairline bg-surface-subtle">
        <div className="mx-auto max-w-[1280px] px-6 py-8">
          <p className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">
            Operações que já automatizam com a Tier
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {CUSTOMERS.map((name) => (
              <div key={name} className="text-[15px] font-semibold tracking-[-0.02em] text-[#6A7385] opacity-80">
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-hairline">
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[340px_1fr]">
          <SectionIntro
            label="Memória e contexto"
            title="O contexto certo chega antes da resposta."
            copy="O Agent já sabe quem é o cliente, o histórico, o ticket e o que deve citar antes de responder."
            cta={{ href: "/recursos#inteligencia", text: "Explorar inteligência" }}
          />
          <div className="border-t border-hairline p-8 lg:border-l lg:border-t-0 lg:p-12">
            <AgentResearchDemo />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-b border-hairline">
        <IsoCube className="absolute bottom-8 right-8 hidden w-32 opacity-80 xl:block" />
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[340px_1fr]">
          <SectionIntro
            label="Playbooks visuais"
            title="Fluxos que escutam, decidem e movem a conversa."
            copy="Triggers, branches, cobrança, RAG, espera, especialista e handoff no mesmo canvas. Tudo com execução rastreável."
            cta={{ href: "/plataforma", text: "Ver playbooks" }}
          />
          <div className="border-t border-hairline p-8 lg:border-l lg:border-t-0 lg:p-12">
            <PlaybookDemo />
          </div>
        </div>
      </section>

      <section className="border-b border-hairline">
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[340px_1fr]">
          <SectionIntro
            label="Fontes de dados"
            title="Plugue sistemas vivos sem reescrever a stack."
            copy="O mesmo agente pode consultar ERP, Hovio Pet e qualquer servidor MCP custom. O catálogo já explica o que ele pode fazer."
            cta={{ href: "/recursos#governanca", text: "Ver fontes de dados" }}
          />
          <div className="border-t border-hairline p-8 lg:border-l lg:border-t-0 lg:p-12">
            <AttioSourceBoard />
          </div>
        </div>
      </section>

      <FinalCTA />

      <section className="border-b border-hairline">
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[340px_1fr]">
          <SectionIntro
            label="Métricas da operação"
            title="Custo, latência e cobertura sem adivinhação."
            copy="IA cobra por uso. O Agent trata tokens, latência, falhas e humano no loop como métricas de primeira classe."
            cta={{ href: "/plataforma", text: "Ver métricas" }}
          />
          <div className="border-t border-hairline p-8 lg:border-l lg:border-t-0 lg:p-12">
            <AttioMetricsBoard />
          </div>
        </div>
      </section>

      <section className="border-b border-hairline bg-surface-subtle">
        <div className="mx-auto max-w-[980px] px-6 py-20 text-center">
          <p className="font-serif text-[28px] leading-[1.42] text-ink text-balance">
            “O ganho não foi só responder mais rápido. Foi operar com contexto: cobrança, lead, memória, handoff e custo na mesma visão.”
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-[13px] font-semibold text-accent">
              MT
            </div>
            <div className="text-left">
              <div className="text-[14px] font-semibold text-ink">Marcelo Tier</div>
              <div className="text-[12px] text-[#6A7385]">Fundador · Tier</div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[1280px] px-6 py-20">
          <div className="max-w-[760px]">
            <div className="text-[12px] font-medium text-[#9AA4B2]">Operação real</div>
            <h2 className="mt-3 font-display text-[clamp(30px,4vw,46px)] font-semibold tracking-display text-ink leading-[1.05]">
              Feito para operar com humano no loop, não para parecer demo.
            </h2>
            <p className="mt-4 max-w-[640px] text-[16px] leading-relaxed text-[#4a5159]">
              Cada feature que entra na home já existe no admin, já conversa com o runtime e já respeita fila humana, guardrails e custo de produção.
            </p>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {OPERATOR_CARDS.map((card) => (
              <div key={card.title} className="rounded-[18px] border border-line bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-accent/[0.08] text-accent">
                  <card.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.02em] text-ink">{card.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-[#4a5159]">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-subtle">
        <div className="mx-auto max-w-[1280px] px-6 py-16">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_repeat(3,1fr)]">
            <div>
              <div className="text-[12px] font-medium text-[#9AA4B2]">Enterprise-ready</div>
              <h2 className="mt-3 font-display text-[30px] font-semibold tracking-display text-ink leading-[1.06]">
                Pronto para operação crítica, não só para teste bonito.
              </h2>
              <p className="mt-4 max-w-[340px] text-[15px] leading-relaxed text-[#4a5159]">
                O mesmo desenho visual carrega princípios de confiabilidade, separação por tenant e controle por provider.
              </p>
            </div>
            {ENTERPRISE_CARDS.map((card) => (
              <div key={card.title} className="rounded-[18px] border border-line bg-white p-6 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9AA4B2]">{card.title}</div>
                <p className="mt-3 text-[14px] leading-relaxed text-[#4a5159]">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

/**
 * Schema central de Playbook Builder — tipos + catálogo de nós.
 *
 * Cada NodeKind tem metadata (label, descrição, ícone, cor, categoria)
 * e defaultData (config inicial quando arrastado pro canvas).
 *
 * O backend é fonte da verdade pra `type` strings — manter sincronizado
 * com services/playbook_nodes/__init__.py REGISTRY.
 */

import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Calendar,
  CircleDot,
  Clock,
  CreditCard,
  Database,
  FileText,
  GitBranch,
  MessageSquare,
  MousePointer,
  Search,
  Send,
  Sparkles,
  Tag,
  Webhook,
  Workflow,
  Users,
} from "lucide-react";

export type NodeCategory = "trigger" | "action" | "flow" | "integration";

export type PlaybookNodeKind =
  // triggers
  | "trigger_keyword"
  | "trigger_intent"
  | "trigger_manual"
  | "trigger_cron"
  | "trigger_event"
  // actions
  | "send_text"
  | "llm_step"
  | "knowledge_lookup"
  | "branch"
  | "wait"
  | "set_var"
  | "call_api"
  | "tier_pay"
  | "handoff_human"
  | "mcp_tool_call"
  | "memory_lookup"
  | "route_to_specialist"
  | "send_audio";

export interface NodeKindMeta {
  kind: PlaybookNodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  category: NodeCategory;
  /** Cor accent do nó no canvas (badge + handle) */
  color: string;
  /** True se nó pode ser entry point (trigger) */
  isTrigger?: boolean;
  /** True se nó tem 2+ saídas (ex: branch true/false) */
  hasMultipleOutputs?: boolean;
  /** Config default quando criado pelo canvas */
  defaultData: Record<string, unknown>;
  /** Versão MVP — Sprint 1=true | Sprint 3=false (ainda mostra mas marca "em breve") */
  available: boolean;
}

export const NODE_CATALOG: NodeKindMeta[] = [
  // ─── TRIGGERS ───
  {
    kind: "trigger_keyword",
    label: "Palavra-chave",
    description: "Dispara quando a mensagem contém uma palavra ou frase.",
    icon: Search,
    category: "trigger",
    color: "#8b5cf6",
    isTrigger: true,
    available: true,
    defaultData: {
      patterns: ["oi"],
      match: "any",
      case_sensitive: false,
      regex: false,
    },
  },
  {
    kind: "trigger_intent",
    label: "Intent (IA)",
    description: "Classifica a intenção do cliente via LLM (ex: comprar, reclamar).",
    icon: Sparkles,
    category: "trigger",
    color: "#8b5cf6",
    isTrigger: true,
    available: false,
    defaultData: { intents: ["comprar"], threshold: 0.7 },
  },
  {
    kind: "trigger_manual",
    label: "Manual",
    description: "Disparo manual via botão no painel.",
    icon: MousePointer,
    category: "trigger",
    color: "#8b5cf6",
    isTrigger: true,
    available: true,
    defaultData: { audience: "all" },
  },
  {
    kind: "trigger_cron",
    label: "Agendado",
    description: "Dispara em horário/data via cron.",
    icon: Calendar,
    category: "trigger",
    color: "#8b5cf6",
    isTrigger: true,
    available: false,
    defaultData: { cron_expr: "0 9 * * *", audience: "all" },
  },
  {
    kind: "trigger_event",
    label: "Evento externo",
    description: "Webhook POST /webhooks/event/{key} (ex: pedido criado).",
    icon: Webhook,
    category: "trigger",
    color: "#8b5cf6",
    isTrigger: true,
    available: true,
    defaultData: { event_key: "pedido_criado" },
  },

  // ─── ACTIONS ───
  {
    kind: "send_text",
    label: "Enviar texto",
    description: "Manda mensagem pelo canal. Suporta {{contact.name}}, {{vars.X}}.",
    icon: Send,
    category: "action",
    color: "#003083",
    available: true,
    defaultData: { text: "Olá {{contact.name|default:'amigo'}}!" },
  },
  {
    kind: "send_audio",
    label: "Enviar áudio (TTS)",
    description: "Gera áudio PT-BR via ElevenLabs e envia pelo canal. Cliente ouve sua resposta.",
    icon: MessageSquare,
    category: "action",
    color: "#003083",
    available: true,
    defaultData: {
      text: "Olá {{contact.name|default:'amigo'}}, sou seu atendente.",
      save_url_as: "audio_url",
    },
  },
  {
    kind: "llm_step",
    label: "Resposta IA",
    description: "Pede ao agente IA pra gerar texto contextual.",
    icon: Brain,
    category: "action",
    color: "#003083",
    available: true,
    defaultData: {
      system_prompt: "Responda em pt-BR de forma amigável e objetiva.",
      user_prompt: "{{message.text}}",
      send_text: true,
      save_as: "resposta_ia",
    },
  },
  {
    kind: "knowledge_lookup",
    label: "Buscar conhecimento",
    description: "RAG real (pgvector + Cohere Rerank) com citação de fonte na resposta.",
    icon: Database,
    category: "action",
    color: "#003083",
    available: true,
    defaultData: {
      query: "{{message.text}}",
      top_k: 3,
      save_as: "kb_result",
      save_sources_as: "kb_sources",
      synthesize: true,
      send_text: false,
    },
  },

  // ─── FLOW ───
  {
    kind: "branch",
    label: "Decisão",
    description: "If/else. Ex: {{message.text|lower}} contains 'sim'.",
    icon: GitBranch,
    category: "flow",
    color: "#f59e0b",
    hasMultipleOutputs: true,
    available: true,
    defaultData: { condition: "{{message.text|lower}} contains 'sim'" },
  },
  {
    kind: "wait",
    label: "Esperar",
    description: "Pausa o fluxo por N segundos (ou até horário específico).",
    icon: Clock,
    category: "flow",
    color: "#f59e0b",
    available: true,
    defaultData: { duration_seconds: 60 },
  },
  {
    kind: "set_var",
    label: "Definir variável",
    description: "Cria ou atualiza variável reusável no resto do fluxo.",
    icon: Tag,
    category: "flow",
    color: "#f59e0b",
    available: true,
    defaultData: { key: "minha_var", value: "valor" },
  },

  // ─── INTEGRATIONS ───
  {
    kind: "call_api",
    label: "Chamar API",
    description: "HTTP POST/GET pra serviço externo.",
    icon: Webhook,
    category: "integration",
    color: "#10b981",
    available: true,
    defaultData: {
      method: "POST",
      url: "https://exemplo.com/webhook",
      headers_json: { "Content-Type": "application/json" },
      body_json: { from: "{{contact.from}}", text: "{{message.text}}" },
      save_as: "api_response",
    },
  },
  {
    kind: "tier_pay",
    label: "Gerar pagamento",
    description: "Cria link Pix/Cartão via Tier Pay.",
    icon: CreditCard,
    category: "integration",
    color: "#10b981",
    available: true,
    defaultData: {
      valor_cents: 19900,
      descricao: "Pedido {{vars.pedido_id|default:'?'}}",
      metodo: "pix",
      save_as: "payment_link",
    },
  },
  {
    kind: "route_to_specialist",
    label: "Roteador (especialistas)",
    description: "Multi-agent visual: classifica intent e roteia pra um especialista (sub-persona).",
    icon: Users,
    category: "flow",
    color: "#8b5cf6",
    hasMultipleOutputs: true,
    available: true,
    defaultData: {
      specialists: [
        {
          name: "vendas",
          description: "Cliente quer comprar, pedir orçamento, ver preços",
          system_prompt: "Você é vendedor experiente. Foque em fechar venda, gerar Pix ou agendar.",
          auto_reply: true,
        },
        {
          name: "suporte",
          description: "Cliente tem dúvida, problema, pediu ajuda técnica",
          system_prompt: "Você é suporte L1. Responda com clareza, ofereça alternativa, escale se complexo.",
          auto_reply: true,
        },
        {
          name: "financeiro",
          description: "Cliente perguntou sobre fatura, boleto, segunda via, pagamento",
          system_prompt: "Você é financeiro. Responda dados de cobrança com objetividade.",
          auto_reply: true,
        },
      ],
      default_specialist: "suporte",
      save_as: "specialist",
    },
  },
  {
    kind: "memory_lookup",
    label: "Buscar memória",
    description: "Recupera fatos lembrados do contato (cross-session). Auto-injetado também em todo inbound.",
    icon: Database,
    category: "action",
    color: "#003083",
    available: true,
    defaultData: {
      query: "{{message.text}}",
      top_k: 5,
      save_as: "memories",
      save_text_as: "memory_block",
    },
  },
  {
    kind: "mcp_tool_call",
    label: "MCP Tool",
    description: "Chama tool de qualquer MCP server externo (Notion, Slack, GitHub, 10k+).",
    icon: Sparkles,
    category: "integration",
    color: "#10b981",
    available: true,
    defaultData: {
      server_url: "https://mcp.exemplo.com/messages",
      tool_name: "search",
      arguments: { query: "{{message.text}}" },
      auth_header: "",
      save_as: "mcp_result",
    },
  },
  {
    kind: "handoff_human",
    label: "Passar pra humano",
    description: "Pausa o agente IA e cria notificação pra equipe atender.",
    icon: Users,
    category: "integration",
    color: "#10b981",
    available: true,
    defaultData: {
      queue: "vendas",
      msg: "Um atendente humano vai continuar daqui, ok?",
      pause_minutes: 60,
    },
  },
];

export function getNodeMeta(kind: string): NodeKindMeta | undefined {
  return NODE_CATALOG.find((n) => n.kind === kind);
}

export function categoryLabel(cat: NodeCategory): string {
  return (
    { trigger: "Gatilhos", action: "Ações", flow: "Fluxo", integration: "Integrações" }[cat] ||
    cat
  );
}

// ────────────────────────────────────────────────────────────
// Tipos de dados do canvas (compatíveis com @xyflow/react)
// ────────────────────────────────────────────────────────────

export interface PlaybookNode {
  id: string;
  type: PlaybookNodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface PlaybookEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface PlaybookCanvas {
  version: number;
  nodes: PlaybookNode[];
  edges: PlaybookEdge[];
}

export function emptyCanvas(): PlaybookCanvas {
  return { version: 1, nodes: [], edges: [] };
}

export function genNodeId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

export function genEdgeId(): string {
  return `e_${Math.random().toString(36).slice(2, 10)}`;
}

// Re-export pra compat
export { CircleDot, FileText, MessageSquare, Workflow };

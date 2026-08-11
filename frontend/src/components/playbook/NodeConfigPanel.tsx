import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Settings2, Trash2, X } from "lucide-react";

import { getNodeMeta, type PlaybookNode } from "@/lib/playbookSchema";

interface Props {
  node: PlaybookNode | null;
  onChange: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Renderizado dentro do dock direito (que já provê largura, borda e rolagem). */
  embedded?: boolean;
}


export default function NodeConfigPanel({
  node,
  onChange,
  onDelete,
  onClose,
  collapsed,
  onToggleCollapse,
  embedded = false,
}: Props) {
  // Dentro do dock: sem largura/borda próprias (o container manda).
  const shell = embedded
    ? "flex flex-col"
    : "shrink-0 bg-white dark:bg-[#0f1216] border-l border-[#EDEDED] dark:border-[#23272e] flex flex-col h-full";
  // Modo colapsado — barra fina à direita
  if (collapsed) {
    return (
      <div
        className="w-[48px] shrink-0 bg-white dark:bg-[#0f1216] border-l border-[#EDEDED] dark:border-[#23272e] flex flex-col items-center py-2 gap-1 h-full"
      >
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[#262626]/40 dark:text-[#6b7280] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white dark:bg-[#14171c]/[0.04] transition-colors"
          title="Expandir configuração"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {node && (() => {
          const m = getNodeMeta(node.type);
          if (!m) return null;
          const Icon = m.icon;
          return (
            <>
              <div className="w-7 h-px bg-[#EDEDED] dark:bg-[#23272e] my-1" />
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center"
                style={{ backgroundColor: `${m.color}14`, color: m.color }}
                title={m.label}
              >
                <Icon className="w-3.5 h-3.5" />
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  // Empty state — sem nó selecionado
  if (!node) {
    return (
      <div
        className={embedded ? shell : `w-[320px] ${shell}`}
      >
        <div className="px-4 py-3 border-b border-[#EDEDED] dark:border-[#23272e] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5 text-[#262626]/[0.56] dark:text-[#8b93a0]" />
            <h3 className="text-[13px] font-semibold text-[#262626] dark:text-[#e6e8eb]">Configuração</h3>
          </div>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 inline-flex items-center justify-center rounded text-[#262626]/40 dark:text-[#6b7280] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white dark:bg-[#14171c]/[0.04]"
              title="Recolher painel"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <div>
            <div className="inline-flex w-10 h-10 rounded-lg bg-black/[0.035] dark:bg-white/[0.05] items-center justify-center mb-3">
              <Settings2 className="w-5 h-5 text-[#262626]/40 dark:text-[#6b7280]" />
            </div>
            <div className="text-[13px] font-medium text-[#262626] dark:text-[#e6e8eb] mb-1">Selecione um nó</div>
            <p className="text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0] leading-relaxed">
              Clique num nó do canvas pra ver e editar a configuração dele aqui.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const meta = getNodeMeta(node.type);
  if (!meta) return null;

  const Icon = meta.icon;

  return (
    <div
      className={embedded ? shell : `w-[340px] ${shell}`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#EDEDED] dark:border-[#23272e] flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}14`, boxShadow: `0 0 0 1px ${meta.color}26` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[#262626] dark:text-[#e6e8eb] truncate leading-tight">{meta.label}</div>
          <div className="text-[10px] text-[#262626]/[0.56] dark:text-[#8b93a0] truncate leading-tight font-mono mt-0.5">{node.id}</div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[#262626]/40 dark:text-[#6b7280] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white dark:bg-[#14171c]/[0.04] transition-colors"
          title="Fechar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[#262626]/40 dark:text-[#6b7280] hover:text-[#262626] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white dark:bg-[#14171c]/[0.04] transition-colors"
            title="Recolher painel"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body — form por kind */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <NodeForm node={node} onChange={onChange} />
      </div>

      {/* Footer — delete */}
      <div className="border-t border-[#EDEDED] dark:border-[#23272e] p-3">
        <button
          onClick={onDelete}
          className="w-full h-8 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Excluir nó
        </button>
      </div>
    </div>
  );
}

function NodeForm({ node, onChange }: { node: PlaybookNode; onChange: (data: Record<string, unknown>) => void }) {
  const [local, setLocal] = useState<Record<string, unknown>>(node.data || {});

  useEffect(() => {
    setLocal(node.data || {});
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key: string, value: unknown) {
    const next = { ...local, [key]: value };
    setLocal(next);
    onChange(next);
  }

  switch (node.type) {
    case "trigger_keyword":
      return (
        <>
          <FieldGroup label="Palavras-chave" hint="Uma por linha — qualquer match dispara o playbook">
            <TextareaInput
              value={((local.patterns as string[]) || []).join("\n")}
              onChange={(v) =>
                set(
                  "patterns",
                  v
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="preço&#10;valor&#10;quanto custa"
              rows={4}
            />
          </FieldGroup>
          <FieldGroup label="Modo">
            <SelectInput
              value={(local.match as string) || "any"}
              onChange={(v) => set("match", v)}
              options={[
                { value: "any", label: "Qualquer palavra (any)" },
                { value: "all", label: "Todas as palavras (all)" },
              ]}
            />
          </FieldGroup>
          <FieldGroup label="">
            <CheckboxInput
              checked={!!local.case_sensitive}
              onChange={(v) => set("case_sensitive", v)}
              label="Sensível a maiúsculas"
            />
            <CheckboxInput
              checked={!!local.regex}
              onChange={(v) => set("regex", v)}
              label="Usar regex (avançado)"
            />
          </FieldGroup>
        </>
      );

    case "trigger_manual":
      return (
        <FieldGroup label="Público" hint="Quem recebe quando o disparo manual rodar">
          <SelectInput
            value={(local.audience as string) || "all"}
            onChange={(v) => set("audience", v)}
            options={[
              { value: "all", label: "Todos os contatos do agente" },
              { value: "tags", label: "Por tag (em breve)" },
            ]}
          />
        </FieldGroup>
      );

    case "trigger_event":
      return (
        <>
          <FieldGroup
            label="Event key"
            hint="Identificador do evento. URL: POST /api/v1/webhooks/event/{key}"
          >
            <TextInput
              value={(local.event_key as string) || ""}
              onChange={(v) => set("event_key", v)}
              placeholder="pedido_criado"
              mono
            />
          </FieldGroup>
          <div className="text-[10px] text-[#262626]/[0.56] dark:text-[#8b93a0] bg-black/[0.035] dark:bg-white/[0.05] px-2 py-2 rounded space-y-1">
            <div className="font-semibold text-[#262626] dark:text-[#e6e8eb]">Como disparar:</div>
            <code className="block font-mono text-[10px] break-all">
              POST https://api-agent.tier.finance/api/v1/webhooks/event/{(local.event_key as string) || "{key}"}
            </code>
            <div>Body JSON vira <code>{"{{event.X}}"}</code> nos nós seguintes.</div>
          </div>
        </>
      );

    case "send_text":
      return (
        <FieldGroup
          label="Texto"
          hint="Suporta variáveis: {{contact.name}}, {{message.text}}, {{vars.X}}"
        >
          <TextareaInput
            value={(local.text as string) || ""}
            onChange={(v) => set("text", v)}
            placeholder="Olá {{contact.name|default:'amigo'}}!"
            rows={5}
          />
        </FieldGroup>
      );

    case "send_audio":
      return (
        <>
          <FieldGroup
            label="Texto (será convertido em áudio PT-BR)"
            hint="ElevenLabs Flash v2.5. ~150 chars = 1 min de áudio. Suporta {{vars}}."
          >
            <TextareaInput
              value={(local.text as string) || ""}
              onChange={(v) => set("text", v)}
              placeholder="Olá {{contact.name}}, posso te ajudar?"
              rows={4}
            />
          </FieldGroup>
          <FieldGroup label="Voice ID (opcional)" hint="Default: Rachel multilingue. Override ElevenLabs ID se quiser outra voz.">
            <TextInput
              value={(local.voice_id as string) || ""}
              onChange={(v) => set("voice_id", v)}
              placeholder="21m00Tcm4TlvDq8ikWAM"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Salvar URL R2 em (opcional)">
            <TextInput
              value={(local.save_url_as as string) || ""}
              onChange={(v) => set("save_url_as", v)}
              placeholder="audio_url"
              mono
            />
          </FieldGroup>
          <div className="text-[10px] text-blue-700 bg-blue-50 px-2 py-1.5 rounded">
            🔊 Custo aprox $0.0008/1k chars. Áudio enviado via WhatsApp Engine como voice message.
          </div>
        </>
      );

    case "branch":
      return (
        <FieldGroup
          label="Condição"
          hint="Operadores: contains, equals, not equals, >, <, starts with, ends with, matches (regex)"
        >
          <TextInput
            value={(local.condition as string) || ""}
            onChange={(v) => set("condition", v)}
            placeholder="{{message.text|lower}} contains 'sim'"
            mono
          />
        </FieldGroup>
      );

    case "wait":
      return (
        <FieldGroup label="Pausar (segundos)" hint="60 = 1 min · 3600 = 1h · 86400 = 1 dia">
          <NumberInput
            value={(local.duration_seconds as number) || 0}
            onChange={(v) => set("duration_seconds", v)}
            min={1}
            max={86400 * 30}
          />
        </FieldGroup>
      );

    case "set_var":
      return (
        <>
          <FieldGroup label="Nome da variável">
            <TextInput
              value={(local.key as string) || ""}
              onChange={(v) => set("key", v)}
              placeholder="pedido_id"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Valor" hint="Suporta {{vars.X}} e filtros">
            <TextInput
              value={String(local.value ?? "")}
              onChange={(v) => set("value", v)}
              placeholder="{{message.text|trim}}"
            />
          </FieldGroup>
        </>
      );

    case "llm_step":
      return (
        <>
          <FieldGroup label="Instrução (system)" hint="Como o agente deve responder. Suporta {{vars}}. Ignorado se A/B variants ativos.">
            <TextareaInput
              value={(local.system_prompt as string) || ""}
              onChange={(v) => set("system_prompt", v)}
              placeholder="Você é um vendedor experiente. Responda em pt-BR..."
              rows={4}
            />
          </FieldGroup>
          <FieldGroup label="Mensagem (user)" hint="Por padrão usa {{message.text}}">
            <TextareaInput
              value={(local.user_prompt as string) || ""}
              onChange={(v) => set("user_prompt", v)}
              placeholder="{{message.text}}"
              rows={2}
            />
          </FieldGroup>
          <FieldGroup label="Salvar resposta em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="resposta_ia"
              mono
            />
          </FieldGroup>
          <FieldGroup label="">
            <CheckboxInput
              checked={local.send_text !== false}
              onChange={(v) => set("send_text", v)}
              label="Enviar resposta automaticamente pelo canal"
            />
          </FieldGroup>
          <VariantsEditor
            variants={(local.variants as any[]) || []}
            onChange={(variants) => set("variants", variants)}
          />
        </>
      );

    case "knowledge_lookup":
      return (
        <>
          <FieldGroup label="Pergunta (query)" hint="O que buscar na knowledge base. Suporta {{vars}}.">
            <TextareaInput
              value={(local.query as string) || ""}
              onChange={(v) => set("query", v)}
              placeholder="{{message.text}}"
              rows={3}
            />
          </FieldGroup>
          <FieldGroup label="Top K (chunks)" hint="Quantos trechos buscar (3-5 é ideal)">
            <NumberInput
              value={(local.top_k as number) ?? 3}
              onChange={(v) => set("top_k", v)}
              min={1}
              max={20}
            />
          </FieldGroup>
          <FieldGroup label="Salvar texto em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="kb_result"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Salvar fontes em" hint="Lista [{title, score, position}] pra usar em send_text">
            <TextInput
              value={(local.save_sources_as as string) || ""}
              onChange={(v) => set("save_sources_as", v)}
              placeholder="kb_sources"
              mono
            />
          </FieldGroup>
          <FieldGroup label="">
            <CheckboxInput
              checked={local.synthesize !== false}
              onChange={(v) => set("synthesize", v)}
              label="Sintetizar resposta com IA (recomendado)"
            />
            <CheckboxInput
              checked={!!local.send_text}
              onChange={(v) => set("send_text", v)}
              label="Enviar resposta automaticamente pelo canal"
            />
          </FieldGroup>
          <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded">
            💡 RAG real com pgvector + Cohere Rerank. Citações aparecem como 📄 badge no test mode.
          </div>
        </>
      );

    case "code_step":
      return (
        <>
          <FieldGroup label="Código Python" hint="Sandbox E2B isolado. Suporta {{vars.X}}. stdout/result salvos em save_as.">
            <TextareaInput
              value={(local.code as string) || ""}
              onChange={(v) => set("code", v)}
              placeholder="import pandas as pd&#10;result = ..."
              rows={10}
            />
          </FieldGroup>
          <FieldGroup label="Timeout (segundos)">
            <NumberInput
              value={(local.timeout_s as number) ?? 30}
              onChange={(v) => set("timeout_s", v)}
              min={1}
              max={300}
            />
          </FieldGroup>
          <FieldGroup label="Salvar result em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="code_result"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Salvar stdout em (opcional)">
            <TextInput
              value={(local.save_stdout_as as string) || ""}
              onChange={(v) => set("save_stdout_as", v)}
              placeholder="code_stdout"
              mono
            />
          </FieldGroup>
          <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded">
            ⚡ E2B Firecracker microVMs isoladas. Sem RCE. Precisa E2B_API_KEY env. Libs default: pandas, requests, numpy.
          </div>
        </>
      );

    case "call_api":
      return (
        <>
          <FieldGroup label="Método">
            <SelectInput
              value={(local.method as string) || "POST"}
              onChange={(v) => set("method", v)}
              options={[
                { value: "GET", label: "GET" },
                { value: "POST", label: "POST" },
                { value: "PUT", label: "PUT" },
                { value: "PATCH", label: "PATCH" },
                { value: "DELETE", label: "DELETE" },
              ]}
            />
          </FieldGroup>
          <FieldGroup label="URL" hint="Suporta {{vars.X}}">
            <TextInput
              value={(local.url as string) || ""}
              onChange={(v) => set("url", v)}
              placeholder="https://api.exemplo.com/leads"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Headers (JSON)" hint='{"Authorization":"Bearer X"}'>
            <JsonInput
              value={local.headers_json}
              onChange={(v) => set("headers_json", v)}
            />
          </FieldGroup>
          <FieldGroup label="Body (JSON)">
            <JsonInput value={local.body_json} onChange={(v) => set("body_json", v)} />
          </FieldGroup>
          <FieldGroup label="Salvar resposta em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="api_response"
              mono
            />
          </FieldGroup>
        </>
      );

    case "tier_pay":
      return (
        <>
          <FieldGroup label="Valor (centavos)" hint="19900 = R$ 199,00">
            <NumberInput
              value={(local.valor_cents as number) || 0}
              onChange={(v) => set("valor_cents", v)}
              min={100}
            />
          </FieldGroup>
          <FieldGroup label="Descrição da cobrança">
            <TextInput
              value={(local.descricao as string) || ""}
              onChange={(v) => set("descricao", v)}
              placeholder="Pedido {{vars.pedido_id}}"
            />
          </FieldGroup>
          <FieldGroup label="Método">
            <SelectInput
              value={(local.metodo as string) || "pix"}
              onChange={(v) => set("metodo", v)}
              options={[
                { value: "pix", label: "Pix" },
                { value: "cartao", label: "Cartão" },
                { value: "both", label: "Pix + Cartão" },
              ]}
            />
          </FieldGroup>
          <FieldGroup label="Salvar URL gerada em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="payment_link"
              mono
            />
          </FieldGroup>
          <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded">
            💳 Integração real Pagar.me ativada. Link aceita Pix + Cartão + Boleto. Precisa TIER_PAY_SECRET_KEY env.
          </div>
        </>
      );

    case "route_to_specialist":
      return (
        <SpecialistsEditor
          specialists={(local.specialists as any[]) || []}
          defaultName={(local.default_specialist as string) || ""}
          saveAs={(local.save_as as string) || ""}
          onChange={(specs, def, save) => {
            const next: Record<string, unknown> = { ...local, specialists: specs };
            if (def !== undefined) next.default_specialist = def;
            if (save !== undefined) next.save_as = save;
            setLocal(next);
            onChange(next);
          }}
        />
      );

    case "memory_lookup":
      return (
        <>
          <FieldGroup label="Query (o que buscar)" hint="Suporta {{vars}}">
            <TextareaInput
              value={(local.query as string) || ""}
              onChange={(v) => set("query", v)}
              placeholder="{{message.text}}"
              rows={2}
            />
          </FieldGroup>
          <FieldGroup label="Top K">
            <NumberInput
              value={(local.top_k as number) ?? 5}
              onChange={(v) => set("top_k", v)}
              min={1}
              max={20}
            />
          </FieldGroup>
          <FieldGroup label="Salvar lista em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="memories"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Salvar texto formatado em">
            <TextInput
              value={(local.save_text_as as string) || ""}
              onChange={(v) => set("save_text_as", v)}
              placeholder="memory_block"
              mono
            />
          </FieldGroup>
          <div className="text-[10px] text-blue-700 bg-blue-50 px-2 py-1.5 rounded">
            💡 Memória é auto-injetada em todo inbound. Use este nó só quando quiser buscar em ponto custom do fluxo (ex: após qualificação).
          </div>
        </>
      );

    case "mcp_tool_call":
      return (
        <>
          <FieldGroup label="Server URL" hint="Endpoint MCP (ex: https://mcp.notion.com/messages)">
            <TextInput
              value={(local.server_url as string) || ""}
              onChange={(v) => set("server_url", v)}
              placeholder="https://mcp.exemplo.com/messages"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Tool name" hint="Nome da tool a chamar (ex: search, create_page)">
            <TextInput
              value={(local.tool_name as string) || ""}
              onChange={(v) => set("tool_name", v)}
              placeholder="search"
              mono
            />
          </FieldGroup>
          <FieldGroup label="Arguments (JSON)" hint="Args da tool. Valores suportam {{vars}}">
            <JsonInput value={local.arguments} onChange={(v) => set("arguments", v)} />
          </FieldGroup>
          <FieldGroup label="Authorization header (opcional)" hint='Ex: "Bearer xxx" ou "Token abc"'>
            <TextInput
              value={(local.auth_header as string) || ""}
              onChange={(v) => set("auth_header", v)}
              placeholder="Bearer ..."
              mono
            />
          </FieldGroup>
          <FieldGroup label="Salvar resultado em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="mcp_result"
              mono
            />
          </FieldGroup>
        </>
      );

    case "handoff_human":
      return (
        <>
          <FieldGroup label="Fila / setor">
            <TextInput
              value={(local.queue as string) || ""}
              onChange={(v) => set("queue", v)}
              placeholder="vendas / suporte / financeiro"
            />
          </FieldGroup>
          <FieldGroup label="Mensagem pro contato (opcional)">
            <TextareaInput
              value={(local.msg as string) || ""}
              onChange={(v) => set("msg", v)}
              placeholder="Um atendente humano vai continuar daqui, ok?"
              rows={3}
            />
          </FieldGroup>
          <FieldGroup label="Pausar IA por (minutos)" hint="0 = pausa permanente até admin reativar">
            <NumberInput
              value={(local.pause_minutes as number) ?? 60}
              onChange={(v) => set("pause_minutes", v)}
              min={0}
              max={43200}
            />
          </FieldGroup>
        </>
      );

    default:
      return (
        <div className="text-[12px] text-[#262626]/[0.56] dark:text-[#8b93a0] italic">
          Configuração deste nó chega em breve.
        </div>
      );
  }
}

function JsonInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [raw, setRaw] = useState(() => safeStringify(value));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRaw(safeStringify(value));
  }, [value]);

  function handleChange(next: string) {
    setRaw(next);
    if (!next.trim()) {
      setErr(null);
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(next);
      setErr(null);
      onChange(parsed);
    } catch (e) {
      setErr("JSON inválido");
    }
  }

  return (
    <>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        className={`w-full px-3 py-2 text-[12px] rounded-md bg-white dark:bg-[#14171c] text-[#262626] dark:text-[#e6e8eb] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] transition-shadow resize-none font-mono ${
          err ? "shadow-[0_0_0_1px_#fca5a5]" : ""
        }`}
        spellCheck={false}
      />
      {err && <p className="text-[10px] text-red-500">{err}</p>}
    </>
  );
}

function safeStringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ─── Form primitives ───
function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[12px] font-medium text-[#262626] dark:text-[#e6e8eb]">{label}</label>
      )}
      {children}
      {hint && <p className="text-[10px] text-[#262626]/[0.56] dark:text-[#8b93a0] leading-relaxed">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full h-7 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] text-[#262626] dark:text-[#e6e8eb] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] transition-shadow ${
        mono ? "font-mono text-[12px]" : ""
      }`}
    />
  );
}

function TextareaInput({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 text-[13px] rounded-md bg-white dark:bg-[#14171c] text-[#262626] dark:text-[#e6e8eb] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] transition-shadow resize-none"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      className="w-full h-7 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] text-[#262626] dark:text-[#e6e8eb] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] transition-shadow font-mono"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-7 px-3 text-[13px] rounded-md bg-white dark:bg-[#14171c] text-[#262626] dark:text-[#e6e8eb] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxInput({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-[#262626] dark:text-[#e6e8eb] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded text-[#003083] focus:ring-[#003083]/30"
      />
      {label}
    </label>
  );
}

// ─── Specialists editor (route_to_specialist)
interface SpecConfig {
  name: string;
  description: string;
  system_prompt: string;
  auto_reply?: boolean;
}

function SpecialistsEditor({
  specialists,
  defaultName,
  saveAs,
  onChange,
}: {
  specialists: SpecConfig[];
  defaultName: string;
  saveAs: string;
  onChange: (specs: SpecConfig[], defaultName?: string, saveAs?: string) => void;
}) {
  function update(idx: number, patch: Partial<SpecConfig>) {
    const next = specialists.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  }

  function add() {
    const next = [
      ...specialists,
      {
        name: `specialist_${specialists.length + 1}`,
        description: "Quando o cliente...",
        system_prompt: "Você é um especialista que...",
        auto_reply: true,
      },
    ];
    onChange(next);
  }

  function remove(idx: number) {
    const next = specialists.filter((_, i) => i !== idx);
    onChange(next);
  }

  function normalizeName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  return (
    <>
      <FieldGroup
        label="Especialistas"
        hint="Cada um vira uma saída do nó. Lead agent classifica intent e roteia."
      >
        <div className="space-y-2">
          {specialists.map((s, idx) => (
            <div
              key={idx}
              className="border border-[#EDEDED] dark:border-[#23272e] rounded-md p-2.5 space-y-1.5 bg-black/[0.035] dark:bg-white/[0.05]"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => update(idx, { name: normalizeName(e.target.value) })}
                  placeholder="vendas"
                  className="flex-1 h-6 px-2 text-[12px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] font-mono"
                />
                <button
                  onClick={() => remove(idx)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                  title="Remover"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <input
                type="text"
                value={s.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="Quando o cliente quer..."
                className="w-full h-6 px-2 text-[11px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083]"
              />
              <textarea
                value={s.system_prompt}
                onChange={(e) => update(idx, { system_prompt: e.target.value })}
                placeholder="Persona/instrução pro motor quando este specialist responder"
                rows={2}
                className="w-full px-2 py-1.5 text-[11px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] resize-none font-mono"
              />
              <label className="flex items-center gap-1.5 text-[10px] text-[#262626]/[0.56] dark:text-[#8b93a0]">
                <input
                  type="checkbox"
                  checked={s.auto_reply !== false}
                  onChange={(e) => update(idx, { auto_reply: e.target.checked })}
                  className="w-3 h-3"
                />
                Responder automaticamente (senão só roteia)
              </label>
            </div>
          ))}
          <button
            onClick={add}
            className="w-full h-8 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-white dark:bg-[#14171c] text-[#003083] shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] hover:shadow-[0_0_0_1px_#003083]"
          >
            <Plus className="w-3 h-3" />
            Adicionar especialista
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Especialista padrão (fallback)">
        <SelectInput
          value={defaultName || (specialists[0]?.name ?? "")}
          onChange={(v) => onChange(specialists, v, undefined)}
          options={specialists.map((s) => ({ value: s.name, label: s.name }))}
        />
      </FieldGroup>

      <FieldGroup label="Salvar nome escolhido em">
        <TextInput
          value={saveAs || "specialist"}
          onChange={(v) => onChange(specialists, undefined, v)}
          placeholder="specialist"
          mono
        />
      </FieldGroup>

      <div className="text-[10px] text-purple-700 bg-purple-50 px-2 py-1.5 rounded">
        💡 Cada specialist vira uma saída do nó. Conecte cada saída a fluxos diferentes ou deixe só "auto_reply" pro especialista responder direto.
      </div>
    </>
  );
}

// ─── A/B Testing variants editor (llm_step)
interface Variant {
  name: string;
  system_prompt: string;
  weight: number;
}

function VariantsEditor({
  variants,
  onChange,
}: {
  variants: Variant[];
  onChange: (v: Variant[]) => void;
}) {
  const [expanded, setExpanded] = useState((variants?.length || 0) > 0);

  function update(idx: number, patch: Partial<Variant>) {
    const next = variants.map((v, i) => (i === idx ? { ...v, ...patch } : v));
    onChange(next);
  }

  function add() {
    onChange([
      ...variants,
      {
        name: String.fromCharCode(65 + variants.length), // A, B, C
        system_prompt: "",
        weight: 50,
      },
    ]);
  }

  function remove(idx: number) {
    onChange(variants.filter((_, i) => i !== idx));
  }

  const totalWeight = variants.reduce((sum, v) => sum + (Number(v.weight) || 0), 0);

  return (
    <div className="border-t border-[#EDEDED] dark:border-[#23272e] pt-3 mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[12px] font-semibold text-[#262626] dark:text-[#e6e8eb] mb-2"
      >
        <span>🧪 A/B Testing {variants.length > 0 && `(${variants.length} variants)`}</span>
        <span className="text-[#262626]/40 dark:text-[#6b7280]">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="space-y-2">
          {variants.length === 0 ? (
            <p className="text-[11px] text-[#262626]/[0.56] dark:text-[#8b93a0] italic">
              Sem variants. Quando ativo, system_prompt principal é ignorado e engine sorteia uma variant por mensagem.
            </p>
          ) : (
            variants.map((v, idx) => (
              <div key={idx} className="border border-[#EDEDED] dark:border-[#23272e] rounded-md p-2 space-y-1.5 bg-black/[0.035] dark:bg-white/[0.05]">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={v.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                    placeholder="A"
                    className="flex-1 h-6 px-2 text-[12px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] font-mono"
                  />
                  <input
                    type="number"
                    value={v.weight}
                    onChange={(e) => update(idx, { weight: Number(e.target.value) })}
                    min={1}
                    max={1000}
                    title="Peso (probabilidade relativa)"
                    className="w-14 h-6 px-2 text-[12px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] font-mono"
                  />
                  {totalWeight > 0 && (
                    <span className="text-[10px] text-[#262626]/[0.56] dark:text-[#8b93a0] font-mono w-10">
                      {Math.round(((v.weight || 0) / totalWeight) * 100)}%
                    </span>
                  )}
                  <button
                    onClick={() => remove(idx)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <textarea
                  value={v.system_prompt}
                  onChange={(e) => update(idx, { system_prompt: e.target.value })}
                  placeholder="System prompt da variant..."
                  rows={2}
                  className="w-full px-2 py-1.5 text-[11px] rounded-md bg-white dark:bg-[#14171c] outline-none shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] focus:shadow-[0_0_0_2px_#003083] resize-none font-mono"
                />
              </div>
            ))
          )}
          <button
            onClick={add}
            className="w-full h-8 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-white dark:bg-[#14171c] text-[#003083] shadow-[0_0_0_1px_#EDEDED] dark:shadow-[0_0_0_1px_#23272e] hover:shadow-[0_0_0_1px_#003083]"
          >
            <Plus className="w-3 h-3" />
            Adicionar variant
          </button>
          {variants.length > 0 && (
            <div className="text-[10px] text-blue-700 bg-blue-50 px-2 py-1.5 rounded">
              💡 Performance por variant em /admin/metricas (em breve aba A/B). Cada execução salva `variant_name` no step log.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

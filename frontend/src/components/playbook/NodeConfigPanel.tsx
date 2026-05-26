import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

import { getNodeMeta, type PlaybookNode } from "@/lib/playbookSchema";

interface Props {
  node: PlaybookNode | null;
  onChange: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function NodeConfigPanel({ node, onChange, onDelete, onClose }: Props) {
  if (!node) {
    return (
      <div
        className="w-[320px] shrink-0 bg-white border-l border-slate-200 p-6 text-center text-[13px] text-[#697386] h-full overflow-y-auto"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
      >
        <div className="opacity-50">Selecione um nó pra editar</div>
      </div>
    );
  }

  const meta = getNodeMeta(node.type);
  if (!meta) return null;

  const Icon = meta.icon;

  return (
    <div
      className="w-[320px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div
          className="w-6 h-6 rounded flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}1f` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[#1a2c44] truncate">{meta.label}</div>
          <div className="text-[10px] text-[#697386] truncate">{node.id}</div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body — form por kind */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <NodeForm node={node} onChange={onChange} />
      </div>

      {/* Footer — delete */}
      <div className="border-t border-slate-100 p-3">
        <button
          onClick={onDelete}
          className="w-full h-7 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
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
          <div className="text-[10px] text-[#697386] bg-slate-50 px-2 py-2 rounded space-y-1">
            <div className="font-semibold text-[#1a2c44]">Como disparar:</div>
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
          <FieldGroup label="Instrução (system)" hint="Como o agente deve responder. Suporta {{vars}}.">
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
        </>
      );

    case "knowledge_lookup":
      return (
        <>
          <FieldGroup label="Pergunta (query)" hint="O que buscar na knowledge base do agente">
            <TextareaInput
              value={(local.query as string) || ""}
              onChange={(v) => set("query", v)}
              placeholder="{{message.text}}"
              rows={3}
            />
          </FieldGroup>
          <FieldGroup label="Salvar resultado em">
            <TextInput
              value={(local.save_as as string) || ""}
              onChange={(v) => set("save_as", v)}
              placeholder="kb_result"
              mono
            />
          </FieldGroup>
          <FieldGroup label="">
            <CheckboxInput
              checked={!!local.send_text}
              onChange={(v) => set("send_text", v)}
              label="Enviar resultado automaticamente pelo canal"
            />
          </FieldGroup>
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
          <div className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1.5 rounded">
            ⚠ MVP — gera URL placeholder. Integração real com Pagar.me chega no Sprint 4.
          </div>
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
        <div className="text-[12px] text-[#697386] italic">
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
        className={`w-full px-3 py-2 text-[12px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow resize-none font-mono ${
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
        <label className="block text-[12px] font-medium text-[#1a2c44]">{label}</label>
      )}
      {children}
      {hint && <p className="text-[10px] text-[#697386] leading-relaxed">{hint}</p>}
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
      className={`w-full h-7 px-3 text-[13px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow ${
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
      className="w-full px-3 py-2 text-[13px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow resize-none"
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
      className="w-full h-7 px-3 text-[13px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow font-mono"
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
      className="w-full h-7 px-3 text-[13px] rounded-md bg-white text-[#1a2c44] outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
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
    <label className="flex items-center gap-2 text-[12px] text-[#1a2c44] cursor-pointer">
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

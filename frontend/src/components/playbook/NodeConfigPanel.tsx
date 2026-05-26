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

    default:
      return (
        <div className="text-[12px] text-[#697386] italic">
          Configuração deste nó chega em breve.
        </div>
      );
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

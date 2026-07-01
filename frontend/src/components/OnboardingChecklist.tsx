import { useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ArrowRight, Sparkles, Cpu, Database, BookOpen, Radio } from "lucide-react";

import { api } from "@/lib/api";
import { FC, Row } from "@/components/ds/fc";

interface SetupStatus {
  has_agent: boolean;
  has_persona: boolean;
  has_llm: boolean;
  has_embedding: boolean;
  has_knowledge: boolean;
  has_channel: boolean;
  ready: boolean;
}

interface Step {
  key: string;
  label: string;
  desc: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  done: boolean;
  required: boolean;
}

// Checklist de onboarding — mostra o que falta configurar pro agente funcionar 100%.
// Some sozinho quando tudo está feito. Embedding/RAG é automático (não entra aqui).
export default function OnboardingChecklist() {
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    api.get<SetupStatus>("/auth/me/setup-status").then(({ data }) => setStatus(data)).catch(() => {});
  }, []);

  if (!status) return null;

  const steps: Step[] = [
    {
      key: "persona",
      label: "Crie seu agente e a persona",
      desc: "Personalidade, tom e regras — sem isso o agente não sabe como agir.",
      to: "/admin/agentes",
      icon: Sparkles,
      done: status.has_agent && status.has_persona,
      required: true,
    },
    {
      key: "llm",
      label: "Conecte a LLM (o cérebro)",
      desc: "É o que faz o agente pensar. Sem LLM configurada, ele não responde.",
      to: "/admin/configuracoes/llm",
      icon: Cpu,
      done: status.has_llm,
      required: true,
    },
    {
      key: "embedding",
      label: "Configure o embedding (RAG)",
      desc: "Liga o RAG e a memória. Sem ele, o agente responde mas não consulta seu conhecimento nem lembra dos clientes.",
      to: "/admin/configuracoes/embedding",
      icon: Database,
      done: status.has_embedding,
      required: true,
    },
    {
      key: "knowledge",
      label: "Adicione conhecimento",
      desc: "O agente responde certo sobre o seu negócio (indexa sozinho — RAG automático).",
      to: "/admin/knowledge",
      icon: BookOpen,
      done: status.has_knowledge,
      required: false,
    },
    {
      key: "channel",
      label: "Conecte um canal",
      desc: "Pra falar com seus clientes (WhatsApp, Telegram, etc).",
      to: "/admin/canais",
      icon: Radio,
      done: status.has_channel,
      required: false,
    },
  ];

  const allDone = steps.every((s) => s.done);
  if (allDone) return null; // configurado 100% → checklist some

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Row>
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={`text-[18px] font-[550] ${FC.ink}`}>Configure seu agente</h2>
            <p className={`text-[13px] mt-1 ${FC.sub}`}>
              Complete os passos pra ele funcionar no potencial máximo.{" "}
              {status.ready ? (
                <span className="text-[#0a8f5a] font-medium">Agente ativo ✓</span>
              ) : (
                <span className="text-[#9a6700] dark:text-[#e0a94a] font-medium">Falta LLM + persona pra ativar.</span>
              )}
            </p>
          </div>
          <div className={`text-[12px] tabular-nums shrink-0 ${FC.sub}`}>{doneCount}/{steps.length}</div>
        </div>

        <div className="mt-4 space-y-2">
          {steps.map((s) => (
            <div
              key={s.key}
              className={`flex items-start gap-3 rounded-[10px] border ${FC.hair} px-4 py-3 ${s.done ? "bg-[#0a8f5a]/[0.03]" : ""}`}
            >
              {s.done ? (
                <CheckCircle2 className="w-5 h-5 text-[#0a8f5a] shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-[#c9ced6] dark:text-[#3a3f47] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[14px] font-medium ${FC.ink} ${s.done ? "line-through opacity-60" : ""}`}>{s.label}</span>
                  {s.required ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#003083]/[0.08] text-[#003083] dark:bg-[#5b9bff]/[0.16] dark:text-[#5b9bff]">obrigatório</span>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06] ${FC.sub}`}>recomendado</span>
                  )}
                </div>
                <p className={`text-[12.5px] mt-0.5 ${FC.sub}`}>{s.desc}</p>
              </div>
              {!s.done && (
                <Link
                  to={s.to}
                  className="shrink-0 h-8 px-3 inline-flex items-center gap-1 rounded-[10px] text-[12px] font-medium text-[#003083] dark:text-[#5b9bff] hover:bg-[#003083]/[0.06] dark:hover:bg-[#5b9bff]/[0.12] transition-colors"
                >
                  Configurar <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className={`text-[12px] mt-3 ${FC.mut}`}>
          O embedding/RAG já roda no automático — você não precisa configurar nada disso.
        </p>
      </div>
    </Row>
  );
}

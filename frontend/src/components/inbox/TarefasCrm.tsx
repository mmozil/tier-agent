/**
 * Tarefas do card no CRM, de dentro da conversa (15/10/2026, M7-258).
 *
 * Pedido do dono: «ter campos de criar uma tarefa dentro de Atendimento › dentro da
 * conversa, que fique associada ao card». O card é o do CONTATO desta conversa: o
 * ERP acha pelo número (DDD + 8 últimos) e pelo ponteiro da conversa, e recusa card
 * de outra pessoa. A tarefa aparece no card, em «Próximas tarefas» e no Hoje do CRM.
 *
 * Sem lista suspensa de propósito: esta seção mora dentro de uma sanfona com
 * `overflow: hidden`, e o menu do `Select` (absolute) seria cortado. Tipo, duração e
 * card são botões.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, ExternalLink, Loader2, Video } from "lucide-react";
import { api } from "@/lib/api";
import { Button, FC } from "@/components/ds/fc";

type Tarefa = {
  id: number;
  tipo: string;
  titulo: string;
  data_agendada: string | null;
  duracao_minutos: number | null;
  reuniao_link: string | null;
  reuniao_provedor: string | null;
};
type Card = {
  id: number;
  titulo: string;
  situacao: string;
  numero: string | null;
  funil: string | null;
  etapa: string | null;
  desta_conversa: boolean;
  tarefas: Tarefa[];
};

const TIPOS = [
  { v: "LIGACAO", t: "Ligação" },
  { v: "REUNIAO", t: "Reunião" },
  { v: "TAREFA", t: "Tarefa" },
  { v: "WHATSAPP", t: "WhatsApp" },
  { v: "EMAIL", t: "E-mail" },
  { v: "VISITA", t: "Visita" },
];
const DURACOES = [15, 30, 60];

/** `datetime-local` quer a hora LOCAL; o CRM guarda UTC (a conversão é no envio). */
function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function quando(iso: string | null): string {
  if (!iso) return "sem data";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const CAMPO =
  "w-full h-8 px-2.5 rounded-[8px] border border-[#E4E4E4] dark:border-[#2a2f37] bg-white dark:bg-[#11141a] " +
  "text-[12.5px] text-[#262626] dark:text-[#e6e8eb] outline-none focus:border-[#003083] dark:focus:border-[#5b9bff]";

export default function TarefasCrm({ conversaId, crmOpportunityId }: { conversaId: number; crmOpportunityId?: number | null }) {
  const [carregando, setCarregando] = useState(true);
  const [disponivel, setDisponivel] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [cardId, setCardId] = useState<number | null>(null);
  const [tipo, setTipo] = useState("LIGACAO");
  const [titulo, setTitulo] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get<{ disponivel: boolean; cards: Card[] }>(`/conversations/${conversaId}/crm/tarefas`);
      setDisponivel(data.disponivel !== false);
      setCards(data.cards || []);
      setErro(null);
      setCardId((atual) => {
        const lista = data.cards || [];
        if (atual && lista.some((c) => c.id === atual)) return atual;
        return (
          lista.find((c) => c.id === crmOpportunityId)?.id
          ?? lista.find((c) => c.desta_conversa)?.id
          ?? lista[0]?.id
          ?? null
        );
      });
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setErro(typeof d === "string" ? d : "Não consegui falar com o CRM.");
    } finally {
      setCarregando(false);
    }
  }, [conversaId, crmOpportunityId]);

  useEffect(() => {
    setTitulo("");
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    setDataHora(paraCampoLocal(d));
    void carregar();
  }, [carregar]);

  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId]);

  async function criar() {
    if (!card) return;
    if (!titulo.trim()) {
      toast.error("Escreva o que é a tarefa");
      return;
    }
    setSalvando(true);
    try {
      await api.post(`/conversations/${conversaId}/crm/tarefas`, {
        oportunidade_id: card.id,
        tipo,
        titulo: titulo.trim(),
        // Campo é hora LOCAL; vai em UTC com Z — o CRM guarda UTC.
        data_agendada: dataHora ? new Date(dataHora).toISOString() : null,
        duracao_minutos: duracao,
      });
      toast.success("Tarefa criada no card do CRM");
      setTitulo("");
      await carregar();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui criar a tarefa");
    } finally {
      setSalvando(false);
    }
  }

  if (!disponivel) return null;
  if (carregando && cards.length === 0) {
    return (
      <p className={`flex items-center gap-1.5 text-[12px] ${FC.sub}`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Procurando o card no CRM…
      </p>
    );
  }
  if (erro) return <p className="text-[12px] text-amber-700 dark:text-amber-400">{erro}</p>;
  if (cards.length === 0) {
    return (
      <p className={`text-[12px] leading-relaxed ${FC.sub}`}>
        Este contato ainda não tem card no CRM. Use «Enviar para CRM» no topo da conversa e a tarefa pode ser criada aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* O card — mais de um, escolhe; um só, mostra. */}
      <div className="space-y-1.5">
        {cards.map((c) => {
          const ativo = c.id === cardId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCardId(c.id)}
              aria-pressed={ativo}
              className={`w-full text-left rounded-[8px] border px-2.5 py-2 transition-colors ${
                ativo
                  ? "border-[#003083] dark:border-[#5b9bff] bg-[#003083]/[0.04] dark:bg-[#5b9bff]/[0.08]"
                  : `${FC.hair} ${FC.hover}`
              }`}
            >
              <span className={`block truncate text-[12.5px] font-medium ${FC.ink}`}>{c.titulo}</span>
              <span className={`block truncate text-[11.5px] ${FC.sub}`}>
                {[c.funil, c.etapa].filter(Boolean).join(" › ") || "—"}
                {c.situacao && c.situacao !== "ABERTA" ? ` · ${c.situacao.toLowerCase()}` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* As pendentes do card escolhido. */}
      {card && card.tarefas.length > 0 && (
        <ul className="space-y-1">
          {card.tarefas.map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-[12px]">
              <CalendarClock className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${FC.mut}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${FC.ink}`}>{t.titulo}</span>
                <span className={`block ${FC.sub}`}>{quando(t.data_agendada)}</span>
              </span>
              {t.reuniao_link && (
                <a href={t.reuniao_link} target="_blank" rel="noopener noreferrer" title="Entrar na reunião"
                   className="shrink-0 inline-flex items-center gap-1 text-[11.5px] text-[#003083] dark:text-[#5b9bff] hover:underline">
                  <Video className="w-3 h-3" /> Entrar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Nova tarefa */}
      <div className={`rounded-[10px] border ${FC.hair} p-2.5 space-y-2`}>
        <div className="flex flex-wrap gap-1">
          {TIPOS.map((x) => (
            <button
              key={x.v}
              type="button"
              onClick={() => setTipo(x.v)}
              aria-pressed={tipo === x.v}
              className={`h-6 px-2 rounded-full text-[11.5px] transition-colors ${
                tipo === x.v ? "bg-[#262626] text-white dark:bg-[#e6e8eb] dark:text-[#0c0e12]" : `${FC.sub} ${FC.hover}`
              }`}
            >
              {x.t}
            </button>
          ))}
        </div>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void criar(); } }}
          maxLength={200}
          placeholder="O que fazer — ex.: ligar para fechar a proposta"
          className={CAMPO}
        />
        <div className="flex items-center gap-1.5">
          <input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} className={`${CAMPO} flex-1 min-w-0`} />
          {DURACOES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDuracao(m)}
              aria-pressed={duracao === m}
              title={`${m} minutos`}
              className={`h-8 px-2 rounded-[8px] border text-[11.5px] tabular-nums transition-colors ${
                duracao === m ? "border-[#003083] dark:border-[#5b9bff] text-[#003083] dark:text-[#5b9bff]" : `${FC.hair} ${FC.sub}`
              }`}
            >
              {m}′
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 text-[11px] ${FC.mut}`}>
            <ExternalLink className="w-3 h-3" /> vai para o card no CRM
          </span>
          <Button size="sm" onClick={criar} disabled={salvando || !card}>
            {salvando ? "Criando…" : "Criar tarefa"}
          </Button>
        </div>
      </div>
    </div>
  );
}

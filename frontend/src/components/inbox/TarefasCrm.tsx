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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, ExternalLink, Loader2, Video } from "lucide-react";
import { api } from "@/lib/api";
import { Button, FC, SegToggle, campoCls, pilulaCls, rotuloCls } from "@/components/ds/fc";

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

/** O CRM de onde o Atendimento foi aberto (o Agent mora num iframe do crm./erp.).
 *  Aberto direto, sem moldura, cai no crm. — a rota do card existe nos dois. */
function baseDoCrm(): string {
  const candidatos = [window.location.ancestorOrigins?.[0], document.referrer];
  for (const c of candidatos) {
    try {
      const origem = c ? new URL(c).origin : "";
      if (/^https:\/\/(crm|erp)\.tier\.finance$/.test(origem)) return origem;
    } catch {
      /* referrer vazio ou estranho: tenta o próximo */
    }
  }
  return "https://crm.tier.finance";
}

/** «qua., 12/11 · 13:00» — o que o campo de data mostra (o valor do `datetime-local` é técnico). */
function rotuloDaData(valor: string): string {
  if (!valor) return "Escolher dia e hora";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} · ${hora}`;
}

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
  const dataRef = useRef<HTMLInputElement>(null);
  // O calendário é o do navegador (acessível, no idioma do sistema), aberto por um campo no
  // padrão do painel — o campo nativo, com o ícone do Chrome, destoava de todo o resto.
  const abrirCalendario = () => {
    const el = dataRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

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
      <p className={`flex items-center gap-1.5 text-[13px] ${FC.sub}`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Procurando o card no CRM…
      </p>
    );
  }
  if (erro) return <p className="text-[13px] text-amber-700 dark:text-amber-400">{erro}</p>;
  if (cards.length === 0) {
    return (
      <p className={`text-[13px] leading-relaxed ${FC.sub}`}>
        Este contato ainda não tem card no CRM. Use «Enviar para CRM» no topo da conversa e a tarefa pode ser criada aqui.
      </p>
    );
  }

  return (
    // `pt-1`: a sanfona corta o que encosta no topo (overflow hidden) — sem o respiro,
    // a borda do card selecionado sumia em cima.
    <div className="space-y-4 pt-1">
      {/* O card — mais de um, escolhe; um só, mostra. O NOME abre o card no CRM em
          outra aba (21/10/2026, pedido do dono); o resto da linha escolhe o card. */}
      <div className="space-y-1.5">
        {cards.map((c) => {
          const ativo = c.id === cardId;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setCardId(c.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCardId(c.id); } }}
              aria-pressed={ativo}
              className={`w-full text-left rounded-[10px] border px-3 py-2 cursor-pointer transition-colors ${
                ativo
                  ? "border-[#003083]/30 bg-[#003083]/[0.04] dark:border-[#5b9bff]/40 dark:bg-[#5b9bff]/[0.08]"
                  : `${FC.hair} ${FC.hover}`
              }`}
            >
              <a
                href={`${baseDoCrm()}/tier-empresas/vendas/crm/negocio/${c.id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Abrir o card no CRM (outra aba)"
                className={`group inline-flex items-center gap-1 min-w-0 max-w-full text-[13px] font-medium ${FC.ink} hover:underline`}
              >
                <span className="truncate">{c.titulo}</span>
                <ExternalLink className={`w-3 h-3 shrink-0 ${FC.mut} group-hover:text-[#003083] dark:group-hover:text-[#5b9bff]`} />
              </a>
              <span className={`block truncate text-[12px] ${FC.sub}`}>
                {[c.funil, c.etapa].filter(Boolean).join(" › ") || "—"}
                {c.situacao && c.situacao !== "ABERTA" ? ` · ${c.situacao.toLowerCase()}` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* As pendentes do card escolhido. */}
      {card && card.tarefas.length > 0 && (
        <ul className={`divide-y ${FC.hair}`}>
          {card.tarefas.map((t) => (
            <li key={t.id} className="flex items-start gap-2.5 py-2 first:pt-0 text-[13px]">
              <CalendarClock className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${FC.mut}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${FC.ink}`}>{t.titulo}</span>
                <span className={`block text-[12px] ${FC.sub}`}>{quando(t.data_agendada)}</span>
              </span>
              {t.reuniao_link && (
                <a href={t.reuniao_link} target="_blank" rel="noopener noreferrer" title="Entrar na reunião"
                   className="shrink-0 inline-flex items-center gap-1 text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline">
                  <Video className="w-3 h-3" /> Entrar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Nova tarefa — os campos no padrão do painel (campoCls), a escolha em pílula. */}
      <div className={`rounded-[12px] border ${FC.hair} p-3 space-y-3`}>
        <div>
          <span className={rotuloCls}>Nova tarefa</span>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS.map((x) => (
              <button key={x.v} type="button" onClick={() => setTipo(x.v)} aria-pressed={tipo === x.v} className={pilulaCls(tipo === x.v)}>
                {x.t}
              </button>
            ))}
          </div>
        </div>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void criar(); } }}
          maxLength={200}
          placeholder="O que fazer — ex.: ligar para a família"
          aria-label="O que fazer"
          className={campoCls}
        />
        <div className="relative">
          <button type="button" onClick={abrirCalendario} className={`${campoCls} flex items-center gap-2 text-left`}>
            <CalendarClock className={`w-3.5 h-3.5 shrink-0 ${FC.mut}`} />
            <span className="truncate">{rotuloDaData(dataHora)}</span>
          </button>
          {/* Invisível e por baixo do botão: o calendário do navegador abre ancorado no campo. */}
          <input
            ref={dataRef}
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 opacity-0 pointer-events-none"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[12px] ${FC.sub}`}>Duração</span>
          <SegToggle
            compacto
            value={duracao}
            onChange={setDuracao}
            options={DURACOES.map((m) => ({ value: m, label: m === 60 ? "1 h" : `${m} min` }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className={`flex items-center gap-1 text-[12px] ${FC.mut}`}>
            <ExternalLink className="w-3 h-3" /> Vai para o card no CRM
          </span>
          <Button size="sm" onClick={criar} disabled={salvando || !card}>
            {salvando ? "Criando…" : "Criar tarefa"}
          </Button>
        </div>
      </div>
    </div>
  );
}

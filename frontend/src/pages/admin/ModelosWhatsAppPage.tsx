import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { FileText, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { api } from "@/lib/api";
import BalaoDoModelo from "@/components/whatsapp/BalaoDoModelo";
import { formatPhone } from "@/lib/phone";
import {
  Button,
  EmptyHint,
  FC,
  Field,
  Input,
  PageFrame,
  PageHero,
  Row,
  SegToggle,
  Select,
  SkeletonBar,
  Textarea,
  iconBtn,
  useConfirmar,
} from "@/components/ds/fc";

// Modelos de mensagem do WhatsApp OFICIAL (11/11/2026). Para iniciar conversa com quem não
// escreveu nas últimas 24 h, a Meta só aceita modelo aprovado. Antes daqui o modelo era criado
// no Gerenciador do WhatsApp, fora do sistema.

interface Numero {
  id: number;
  agente: string;
  telefone: string | null;
  nome_verificado: string | null;
  ativo: boolean;
}
interface Modelo {
  id: string;
  nome: string;
  status: string;
  status_pt: string;
  categoria: string;
  idioma: string;
  corpo: string;
  rodape: string;
  cabecalho: string | null;
  cabecalho_midia: string | null;
  botoes: string[];
  variaveis: number;
  motivo_recusa: string | null;
}

const CATEGORIAS = [
  { value: "MARKETING" as const, label: "Marketing" },
  { value: "UTILITY" as const, label: "Utilidade" },
];
const CUSTO: Record<string, string> = {
  MARKETING: "Convite, oferta, divulgação. A Meta cobra cerca de R$ 0,32 por mensagem entregue.",
  UTILITY: "Confirmação, lembrete, aviso de algo que a pessoa já pediu. Cerca de R$ 0,035 por mensagem.",
};
const COR_STATUS: Record<string, string> = {
  APPROVED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  IN_APPEAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function nomeTecnico(t: string) {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}
function variaveis(texto: string): number[] {
  return Array.from(new Set(Array.from(texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => Number(m[1])))).sort((a, b) => a - b);
}
function preencher(texto: string, valores: string[]) {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => valores[Number(n) - 1] || m);
}

export default function ModelosWhatsAppPage() {
  const [params, setParams] = useSearchParams();
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [podeCriar, setPodeCriar] = useState(false);
  const [numeroId, setNumeroId] = useState<number | null>(null);
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, dialogo] = useConfirmar();

  // formulário
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [corpo, setCorpo] = useState("");
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [rodape, setRodape] = useState("");
  const [botoes, setBotoes] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .get<{ numeros: Numero[]; pode_criar: boolean }>("/whatsapp-oficial/numeros")
      .then(({ data }) => {
        setNumeros(data.numeros);
        setPodeCriar(data.pode_criar);
        const pedido = Number(params.get("numero"));
        const ini = data.numeros.find((n) => n.id === pedido) ?? data.numeros[0];
        setNumeroId(ini?.id ?? null);
      })
      .catch(() => setNumeros([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar(id = numeroId) {
    if (!id) return;
    setModelos(null);
    setErro(null);
    try {
      const { data } = await api.get<{ modelos: Modelo[] }>("/whatsapp-oficial/modelos", { params: { connector_id: id } });
      setModelos(data.modelos);
    } catch (e: any) {
      setErro(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Não consegui buscar os modelos na Meta");
      setModelos([]);
    }
  }
  useEffect(() => {
    if (numeroId) {
      void carregar(numeroId);
      setParams({ numero: String(numeroId) }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroId]);

  const nums = useMemo(() => variaveis(corpo), [corpo]);
  useEffect(() => {
    setExemplos((ex) => nums.map((_, i) => ex[i] ?? ""));
  }, [nums]);

  function inserirVariavel() {
    const n = (nums[nums.length - 1] ?? 0) + 1;
    setCorpo((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}{{${n}}}`);
  }

  async function enviar() {
    if (!numeroId || enviando) return;
    setEnviando(true);
    try {
      const { data } = await api.post<{ nome: string; status_pt: string }>("/whatsapp-oficial/modelos", {
        connector_id: numeroId,
        titulo,
        categoria,
        corpo,
        exemplos,
        rodape: rodape || null,
        botoes: botoes.filter((b) => b.trim()),
      });
      toast.success(`Modelo «${data.nome}» enviado à Meta — ${data.status_pt.toLowerCase()}`);
      setTitulo("");
      setCorpo("");
      setExemplos([]);
      setRodape("");
      setBotoes([]);
      void carregar();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui enviar o modelo");
    } finally {
      setEnviando(false);
    }
  }

  async function apagar(m: Modelo) {
    const ok = await confirmar({
      titulo: `Apagar o modelo «${m.nome}»?`,
      texto: "Ele é apagado na Meta e não pode mais ser usado. O nome fica bloqueado por 30 dias para um modelo novo.",
      confirmar: "Apagar",
      perigo: true,
    });
    if (!ok || !numeroId) return;
    try {
      await api.delete("/whatsapp-oficial/modelos", { params: { connector_id: numeroId, nome: m.nome } });
      toast.success("Modelo apagado");
      void carregar();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui apagar");
    }
  }

  const slug = nomeTecnico(titulo);
  const podeEnviar = !!slug && !!corpo.trim() && exemplos.every((e) => e.trim()) && !enviando;
  const atual = numeros?.find((n) => n.id === numeroId);

  return (
    <div className="-mx-8 pb-10">
      {dialogo}
      <PageFrame>
        <PageHero
          title="Modelos de mensagem"
          subtitle="No WhatsApp oficial, para falar primeiro com quem não escreveu nas últimas 24 horas, a Meta só aceita modelo aprovado. Crie o modelo aqui, acompanhe a aprovação e use em Conversas › Nova conversa."
          right={
            numeros && numeros.length > 0 ? (
              <div className="flex items-center gap-2">
                {numeros.length > 1 && (
                  <Select
                    value={numeroId}
                    onChange={setNumeroId}
                    className="w-[260px]"
                    options={numeros.map((n) => ({ value: n.id, label: `${formatPhone(n.telefone)} · ${n.agente}` }))}
                  />
                )}
                <button type="button" onClick={() => void carregar()} className={iconBtn} title="Atualizar">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            ) : undefined
          }
        />

        {numeros === null ? (
          <Row last>
            <div className="px-6 py-8 space-y-3">
              <SkeletonBar className="h-4 w-64" />
              <SkeletonBar className="h-4 w-80" />
            </div>
          </Row>
        ) : numeros.length === 0 ? (
          <Row last>
            <EmptyHint
              icon={FileText}
              text="Você não tem número do WhatsApp oficial. Conecte um em Canais › Conectar canal › WhatsApp Oficial."
              ctaLabel="Ir para Canais"
              ctaTo="/admin/canais"
              className="py-10"
            />
          </Row>
        ) : (
          <Row last>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
              {/* lista */}
              <div className={`min-w-0 lg:border-r ${FC.hair}`}>
                <div className={`px-6 py-3 border-b ${FC.hair} flex items-center justify-between`}>
                  <p className={`text-[12px] ${FC.sub}`}>
                    {atual ? (
                      <>
                        <span className={`tabular-nums ${FC.ink}`}>{formatPhone(atual.telefone)}</span>
                        {atual.nome_verificado ? ` · ${atual.nome_verificado}` : ""} · agente {atual.agente}
                      </>
                    ) : null}
                  </p>
                  {modelos && <p className={`text-[12px] ${FC.mut}`}>{modelos.length} modelo{modelos.length === 1 ? "" : "s"}</p>}
                </div>
                {erro && <p className="px-6 py-4 text-[12.5px] text-red-700 dark:text-red-400">{erro}</p>}
                {modelos === null ? (
                  <div className="px-6 py-6 space-y-3">
                    <SkeletonBar className="h-4 w-56" />
                    <SkeletonBar className="h-4 w-72" />
                  </div>
                ) : modelos.length === 0 && !erro ? (
                  <EmptyHint icon={FileText} text="Este número ainda não tem modelo. Crie o primeiro ao lado." className="py-12" />
                ) : (
                  <ul>
                    {modelos.map((m) => (
                      <li key={`${m.nome}-${m.idioma}`} className={`px-6 py-4 border-b ${FC.hair} last:border-b-0`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-mono text-[12.5px] ${FC.ink}`}>{m.nome}</span>
                              <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded ${COR_STATUS[m.status] ?? "bg-black/[0.05] dark:bg-white/[0.08] " + FC.sub}`}>
                                {m.status_pt}
                              </span>
                              <span className={`text-[11px] ${FC.mut}`}>
                                {m.categoria === "MARKETING" ? "Marketing" : m.categoria === "UTILITY" ? "Utilidade" : m.categoria} · {m.idioma}
                              </span>
                            </div>
                            {m.motivo_recusa && (
                              <p className="mt-1 text-[11.5px] text-red-700 dark:text-red-400">Motivo da Meta: {m.motivo_recusa}</p>
                            )}
                            <div className="mt-2.5">
                              <BalaoDoModelo corpo={m.corpo} rodape={m.rodape} botoes={m.botoes} />
                            </div>
                            {m.cabecalho_midia && (
                              <p className={`mt-1.5 text-[11px] ${FC.mut}`}>Tem {m.cabecalho_midia.toLowerCase()} no topo — ainda não é enviado pela tela de Conversas.</p>
                            )}
                          </div>
                          {podeCriar && (
                            <button type="button" onClick={() => void apagar(m)} className={iconBtn} title="Apagar o modelo">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* novo modelo */}
              <div className={`px-6 py-5 border-t lg:border-t-0 ${FC.hair}`}>
                <h3 className={`text-[14px] font-medium ${FC.ink}`}>Novo modelo</h3>
                {!podeCriar ? (
                  <p className={`mt-2 text-[12.5px] ${FC.sub}`}>Só o dono da conta e os administradores criam modelos. Os aprovados aparecem para todos.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <Field label="Nome" hint={slug ? `Na Meta: ${slug}` : "Só para identificar. Ex.: Boas-vindas"}>
                      <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder="Boas-vindas" />
                    </Field>
                    <Field label="Categoria" hint={CUSTO[categoria]}>
                      <SegToggle value={categoria} onChange={setCategoria} options={CATEGORIAS} />
                    </Field>
                    <Field
                      label="Texto"
                      right={`${corpo.length}/1024`}
                      hint="Use {{1}}, {{2}}… para o que muda em cada envio (ex.: o nome). A Meta não aceita variável no começo nem no fim."
                    >
                      <Textarea
                        value={corpo}
                        onChange={(e) => setCorpo(e.target.value)}
                        maxLength={1024}
                        rows={5}
                        placeholder="Olá {{1}}, aqui é a Cinthia, do CCDA. Recebemos seu interesse em conhecer a escola. Posso te ajudar?"
                      />
                      <button type="button" onClick={inserirVariavel} className={`mt-1.5 text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline`}>
                        + Inserir variável
                      </button>
                    </Field>
                    {nums.length > 0 && (
                      <Field label="Exemplos (a Meta usa para aprovar)">
                        <div className="space-y-2">
                          {nums.map((n, i) => (
                            <div key={n} className="flex items-center gap-2">
                              <span className={`w-10 shrink-0 font-mono text-[12px] ${FC.mut}`}>{`{{${n}}}`}</span>
                              <Input
                                value={exemplos[i] ?? ""}
                                onChange={(e) => setExemplos((ex) => ex.map((v, j) => (j === i ? e.target.value : v)))}
                                placeholder={i === 0 ? "Maria" : "exemplo"}
                              />
                            </div>
                          ))}
                        </div>
                      </Field>
                    )}
                    <Field label="Rodapé (opcional)" right={`${rodape.length}/60`}>
                      <Input value={rodape} onChange={(e) => setRodape(e.target.value)} maxLength={60} placeholder="CCDA Diadema" />
                    </Field>
                    <Field label="Botões de resposta (opcional)" hint="Até 3. A resposta do contato abre a janela de 24 h.">
                      <div className="space-y-2">
                        {botoes.map((b, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={b}
                              maxLength={25}
                              onChange={(e) => setBotoes((bs) => bs.map((v, j) => (j === i ? e.target.value : v)))}
                              placeholder={i === 0 ? "Quero agendar uma visita" : "Texto do botão"}
                            />
                            <button type="button" onClick={() => setBotoes((bs) => bs.filter((_, j) => j !== i))} className={iconBtn} title="Tirar o botão">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        {botoes.length < 3 && (
                          <button type="button" onClick={() => setBotoes((bs) => [...bs, ""])} className={`inline-flex items-center gap-1 text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline`}>
                            <Plus className="w-3 h-3" /> Adicionar botão
                          </button>
                        )}
                      </div>
                    </Field>
                    <Field label="Como chega no WhatsApp">
                      <div className={`rounded-xl p-3 ${FC.base}`}>
                        <BalaoDoModelo corpo={preencher(corpo, exemplos)} rodape={rodape} botoes={botoes.filter((b) => b.trim())} />
                      </div>
                    </Field>
                    <Button onClick={() => void enviar()} disabled={!podeEnviar} className="w-full justify-center">
                      {enviando ? "Enviando…" : "Enviar para aprovação"}
                    </Button>
                    <p className={`text-[11px] leading-4 ${FC.mut}`}>
                      A Meta costuma responder em minutos, às vezes em horas. O status aparece na lista ao lado.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Row>
        )}
      </PageFrame>
    </div>
  );
}

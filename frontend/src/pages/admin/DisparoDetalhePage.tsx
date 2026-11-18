// Um disparo (11/11/2026): andamento, os números, o modelo enviado e o resultado contato a contato.
// Entregue e lido vêm do retorno da Meta (webhook), então continuam mudando depois de concluído.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Megaphone, RefreshCw, Search } from "lucide-react";

import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import BalaoDoModelo from "@/components/whatsapp/BalaoDoModelo";
import {
  Button,
  EmptyHint,
  FC,
  HairCells,
  Input,
  PageFrame,
  PageHero,
  Row,
  SkeletonBar,
  iconBtn,
  useConfirmar,
} from "@/components/ds/fc";
import { BarraDoDisparo, PARTES_DA_BARRA, Pilula, partesDaBarra } from "@/components/disparos/PartesDoDisparo";
import { useAvisarRota, useModoEmbutido } from "@/lib/modoEmbutido";
import {
  type DisparoDetalhe,
  type Envio,
  type Situacao,
  SITUACAO,
  brl,
  comNome,
  duracao,
  ehDeTexto,
  inteiro,
  mensagemDeErro,
  nomeDaCategoria,
  precoDaCategoria,
  preencher,
  quando,
  statusDoDisparo,
} from "@/lib/disparos";

const POR_PAGINA = 100;

// Os filtros da lista contato a contato (contagem exclusiva: «Enviado» = saiu e ainda sem confirmação).
// «Respondeu» atravessa os outros (quem respondeu também está em Lido) — por isso fica por último.
type Filtro = Situacao | "respondeu";
const FILTROS: { valor: Filtro | null; rotulo: string; conta: (d: DisparoDetalhe) => number }[] = [
  { valor: null, rotulo: "Todos", conta: (d) => d.total },
  { valor: "pendente", rotulo: "Na fila", conta: (d) => d.contagens.pendentes },
  { valor: "enviado", rotulo: "Enviado", conta: (d) => d.contagens.enviados - d.contagens.entregues },
  { valor: "entregue", rotulo: "Entregue", conta: (d) => d.contagens.entregues - d.contagens.lidos },
  { valor: "lido", rotulo: "Lido", conta: (d) => d.contagens.lidos },
  { valor: "falhou", rotulo: "Falhou", conta: (d) => d.contagens.falhas },
  { valor: "descadastrado", rotulo: "Pediu para não receber", conta: (d) => d.contagens.descadastrados },
  { valor: "sem_nome", rotulo: "Sem nome", conta: (d) => d.contagens.sem_nome },
  { valor: "cancelado", rotulo: "Cancelado", conta: (d) => d.contagens.cancelados },
  { valor: "respondeu", rotulo: "Respondeu", conta: (d) => d.contagens.respondidos ?? 0 },
];

// 18/11/2026 — disparo pelo número não oficial (QR): sem custo da Meta, com risco de bloqueio.
const AVISO_NAO_OFICIAL =
  "Sai pelo número não oficial, sem custo da Meta — mas o WhatsApp pode bloquear número que manda muita mensagem para quem não o tem salvo. ";

function pct(parte: number, total: number) {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : "—";
}

export default function DisparoDetalhePage() {
  const { id } = useParams();
  const nav = useNavigate();
  // 16/11/2026 — aberto pelo CRM («Atendimento › Disparos») é só consulta: nenhuma ação.
  const { embed, consulta, sufixo } = useModoEmbutido();
  useAvisarRota();
  const [confirmar, dialogo] = useConfirmar();
  const [d, setD] = useState<DisparoDetalhe | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [totalEnvios, setTotalEnvios] = useState(0);
  // 16/11/2026 — filtro e página moram no ENDEREÇO (`?situacao=falhou&pagina=2`): voltar a esta
  // tela (pelo «voltar» do navegador ou pelo CRM recriando o quadro) reabre no mesmo ponto.
  const [qs, setQs] = useSearchParams();
  const [filtro, setFiltro] = useState<Filtro | null>(() => {
    const v = qs.get("situacao");
    return FILTROS.some((f) => f.valor === v) ? (v as Filtro) : null;
  });
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(() => Math.max(0, Math.floor(Number(qs.get("pagina")) || 1) - 1));
  useEffect(() => {
    const p = new URLSearchParams(qs);
    if (filtro) p.set("situacao", filtro);
    else p.delete("situacao");
    if (pagina > 0) p.set("pagina", String(pagina + 1));
    else p.delete("pagina");
    if (p.toString() !== qs.toString()) setQs(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, pagina]);
  const [agindo, setAgindo] = useState(false);
  // Agendar um rascunho já salvo (15/11/2026): antes ele só podia sair na hora.
  const [agendando, setAgendando] = useState(false);
  const [agendarPara, setAgendarPara] = useState("");

  async function carregar() {
    try {
      const { data } = await api.get<DisparoDetalhe>(`/disparos-oficiais/${id}`);
      setD(data);
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) setNaoAchou(true);
      else toast.error(mensagemDeErro(e, "Não consegui carregar o disparo"));
    }
  }
  async function carregarEnvios() {
    try {
      const { data } = await api.get<{ envios: Envio[]; total: number }>(`/disparos-oficiais/${id}/envios`, {
        params: { situacao: filtro || undefined, busca: buscaAplicada || undefined, offset: pagina * POR_PAGINA, limite: POR_PAGINA },
      });
      setEnvios(data.envios);
      setTotalEnvios(data.total);
    } catch (e) {
      setEnvios([]);
      toast.error(mensagemDeErro(e, "Não consegui carregar os contatos"));
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    void carregarEnvios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filtro, buscaAplicada, pagina]);
  // Só busca NOVA volta para a página 1 — ao abrir a tela isto rodava e apagava a página guardada.
  const buscaAnterior = useRef("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      const nova = busca.trim();
      if (nova === buscaAnterior.current) return;
      buscaAnterior.current = nova;
      setBuscaAplicada(nova);
      setPagina(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [busca]);

  // Enquanto envia, a tela acompanha sozinha (a cada 5 s).
  const andando = d?.status === "em_andamento";
  useEffect(() => {
    if (!andando) return;
    const t = window.setInterval(() => {
      void carregar();
      void carregarEnvios();
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [andando, filtro, buscaAplicada, pagina]);

  async function acao(nome: "iniciar" | "pausar" | "retomar" | "cancelar") {
    if (!d || agindo) return;
    if (nome === "cancelar") {
      const ok = await confirmar({
        titulo: "Cancelar o disparo?",
        texto: `Os ${inteiro(d.contagens.pendentes)} contatos que ainda estão na fila não recebem. O que já saiu continua na conversa de cada contato. Não dá para desfazer.`,
        confirmar: "Cancelar disparo",
        cancelar: "Voltar",
        perigo: true,
      });
      if (!ok) return;
    }
    if (nome === "iniciar") {
      const preco = ehDeTexto(d) ? null : precoDaCategoria(d.categoria);
      const ok = await confirmar({
        titulo: `Enviar «${ehDeTexto(d) ? d.nome : d.modelo}» para ${inteiro(d.contagens.pendentes)} contato${d.contagens.pendentes === 1 ? "" : "s"}?`,
        texto:
          (ehDeTexto(d) ? AVISO_NAO_OFICIAL : "") +
          (preco !== null ? `Custo estimado de até ${brl(d.contagens.pendentes * preco)}, cobrado pela Meta na conta do número. ` : "") +
          `Leva cerca de ${duracao(d.contagens.pendentes * d.intervalo_s)}.`,
        confirmar: "Iniciar disparo",
      });
      if (!ok) return;
    }
    setAgindo(true);
    try {
      const { data } = await api.post<DisparoDetalhe>(`/disparos-oficiais/${d.id}/${nome}`);
      setD(data);
      void carregarEnvios();
      toast.success(
        { iniciar: "Disparo iniciado", pausar: "Disparo pausado", retomar: "Disparo retomado", cancelar: "Disparo cancelado" }[nome],
      );
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui fazer isso agora"));
      void carregar();
    } finally {
      setAgindo(false);
    }
  }

  function abrirAgenda() {
    if (!agendarPara) {
      // o horário que veio da criação (se ainda vale) ou, senão, amanhã às 08:00 — no fuso do navegador
      const salvo = d?.agendado_para ? new Date(d.agendado_para) : null;
      const t = salvo && salvo.getTime() > Date.now() ? salvo : new Date();
      if (t !== salvo) {
        t.setDate(t.getDate() + 1);
        t.setHours(8, 0, 0, 0);
      }
      const p = (n: number) => String(n).padStart(2, "0");
      setAgendarPara(`${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`);
    }
    setAgendando(true);
  }

  async function agendar() {
    if (!d || agindo) return;
    const quandoComeca = agendarPara ? new Date(agendarPara) : null;
    if (!quandoComeca || Number.isNaN(quandoComeca.getTime()) || quandoComeca.getTime() <= Date.now()) {
      toast.error("Escolha um horário no futuro");
      return;
    }
    const preco = ehDeTexto(d) ? null : precoDaCategoria(d.categoria);
    const ok = await confirmar({
      titulo: `Agendar «${ehDeTexto(d) ? d.nome : d.modelo}» para ${quando(quandoComeca.toISOString())}?`,
      texto:
        (ehDeTexto(d) ? AVISO_NAO_OFICIAL : "") +
        `Vai para ${inteiro(d.contagens.pendentes)} contato${d.contagens.pendentes === 1 ? "" : "s"} a partir desse horário` +
        (preco !== null ? `, com custo estimado de até ${brl(d.contagens.pendentes * preco)} cobrado pela Meta` : "") +
        `, e leva cerca de ${duracao(d.contagens.pendentes * d.intervalo_s)}. Até lá dá para cancelar.`,
      confirmar: "Agendar disparo",
    });
    if (!ok) return;
    setAgindo(true);
    try {
      const { data } = await api.post<DisparoDetalhe>(`/disparos-oficiais/${d.id}/iniciar`, {
        agendar_para: quandoComeca.toISOString(),
      });
      setD(data);
      setAgendando(false);
      void carregarEnvios();
      toast.success(`Disparo agendado para ${quando(quandoComeca.toISOString())}`);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui agendar"));
      void carregar();
    } finally {
      setAgindo(false);
    }
  }

  async function apagar() {
    if (!d) return;
    const ok = await confirmar({
      titulo: "Apagar este rascunho?",
      texto: "Nada foi enviado. A lista colada é descartada.",
      confirmar: "Apagar",
      perigo: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/disparos-oficiais/${d.id}`);
      toast.success("Rascunho apagado");
      nav(`/admin/disparos${sufixo}`);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui apagar"));
    }
  }

  const voltar = (
    <Link to={`/admin/disparos${sufixo}`} className={`inline-flex items-center gap-1 text-[12.5px] ${FC.sub} hover:text-[#262626] dark:hover:text-white`}>
      <ArrowLeft className="w-3.5 h-3.5" /> Disparos
    </Link>
  );

  if (naoAchou) {
    return (
      <div className="-mx-8 pb-10">
        <PageFrame>
          <PageHero title="Disparo" right={voltar} />
          <Row last>
            <EmptyHint icon={Megaphone} text="Este disparo não existe ou é de um número que não é seu." ctaLabel="Ver os disparos" ctaTo={`/admin/disparos${sufixo}`} className="py-12" />
          </Row>
        </PageFrame>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="-mx-8 pb-10">
        <PageFrame>
          <PageHero title="Disparo" right={voltar} />
          <Row last>
            <div className="px-6 py-8 space-y-3">
              <SkeletonBar className="h-4 w-72" />
              <SkeletonBar className="h-4 w-96" />
            </div>
          </Row>
        </PageFrame>
      </div>
    );
  }

  const st = statusDoDisparo(d);
  const c = d.contagens;
  // 18/11/2026 — número não oficial: texto no lugar do modelo, sem custo e sem entregue/lido.
  const texto = ehDeTexto(d);
  const preco = texto ? null : precoDaCategoria(d.categoria);
  const modelo = d.modelo_resumo;
  const valoresDoBalao = d.variaveis.map((v) => (v.fonte === "nome" ? "[primeiro nome]" : v.valor));
  const partes = partesDaBarra(c);
  const paginas = Math.max(1, Math.ceil(totalEnvios / POR_PAGINA));
  const podeMexer = d.status !== "concluido" && d.status !== "cancelado";
  const agir = !consulta;

  return (
    <div className="-mx-8 pb-10">
      {dialogo}
      <PageFrame>
        <PageHero
          title={d.nome}
          subtitle={
            <>
              {texto ? (
                <>
                  Texto pelo número não oficial · {formatPhone(d.telefone)}
                  {d.dono ? ` · celular de ${d.dono}` : d.agente ? ` · agente ${d.agente}` : ""}
                </>
              ) : (
                <>
                  Modelo <span className="font-mono">{d.modelo}</span> ({nomeDaCategoria(d.categoria)}) · {formatPhone(d.telefone)}
                  {d.agente ? ` · agente ${d.agente}` : ""}
                </>
              )}
              {d.criado_por ? ` · criado por ${d.criado_por} em ${quando(d.criado_em)}` : ` · criado em ${quando(d.criado_em)}`}
            </>
          }
          right={
            <div className="flex flex-col items-end gap-3">
              {voltar}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { void carregar(); void carregarEnvios(); }} className={iconBtn} title="Atualizar">
                  <RefreshCw className="w-4 h-4" />
                </button>
                {agir && d.status === "rascunho" && (
                  <>
                    <Button variant="danger" onClick={() => void apagar()} disabled={agindo}>
                      Apagar rascunho
                    </Button>
                    <Button variant="secondary" onClick={abrirAgenda} disabled={agindo || agendando}>
                      Agendar
                    </Button>
                    <Button onClick={() => void acao("iniciar")} disabled={agindo}>
                      Iniciar disparo
                    </Button>
                  </>
                )}
                {agir && d.status === "em_andamento" && (
                  <Button variant="secondary" onClick={() => void acao("pausar")} disabled={agindo}>
                    Pausar
                  </Button>
                )}
                {agir && d.status === "pausado" && (
                  <Button onClick={() => void acao("retomar")} disabled={agindo}>
                    Retomar
                  </Button>
                )}
                {agir && podeMexer && d.status !== "rascunho" && (
                  <Button variant="danger" onClick={() => void acao("cancelar")} disabled={agindo}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          }
        />

        <Row>
          <div className="px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Pilula texto={st.texto} tom={st.tom} />
            {d.status === "pausado" && d.motivo_pausa && (
              <p className="text-[12.5px] text-amber-700 dark:text-amber-400">{d.motivo_pausa}</p>
            )}
            {d.comeca_em && <p className={`text-[12.5px] ${FC.sub}`}>Começa {quando(d.comeca_em)}.</p>}
            {d.status === "rascunho" && !agendando && (
              <p className={`text-[12.5px] ${FC.sub}`}>
                {agir ? (
                  <>
                    Rascunho: não sai sozinho. Use <b className="font-medium">Agendar</b> para escolher o horário ou{" "}
                    <b className="font-medium">Iniciar disparo</b> para enviar agora.
                  </>
                ) : (
                  "Rascunho: ainda não foi enviado nem agendado."
                )}
              </p>
            )}
            {agir && d.status === "rascunho" && agendando && (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[12.5px] ${FC.sub}`}>Começar em</span>
                <Input
                  type="datetime-local"
                  value={agendarPara}
                  onChange={(e) => setAgendarPara(e.target.value)}
                  className="w-[200px]"
                  aria-label="Data e hora do disparo"
                />
                <Button onClick={() => void agendar()} disabled={agindo || !agendarPara}>
                  Agendar disparo
                </Button>
                <Button variant="secondary" onClick={() => setAgendando(false)} disabled={agindo}>
                  Voltar
                </Button>
              </div>
            )}
            {d.status === "em_andamento" && !d.comeca_em && c.pendentes > 0 && (
              <p className={`text-[12.5px] ${FC.sub}`}>
                Faltam {inteiro(c.pendentes)} · ≈ {duracao(c.pendentes * d.intervalo_s)} no ritmo de {d.intervalo_s} s (±
                {String(d.variacao_s).replace(".", ",")} s)
              </p>
            )}
            {d.numero_ativo === false && podeMexer && (
              <p className="text-[12.5px] text-red-700 dark:text-red-400">O número está desconectado — reconecte em Canais para continuar.</p>
            )}
            <div className="w-full">
              <BarraDoDisparo contagens={c} total={d.total} alta />
              <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] ${FC.sub}`}>
                {PARTES_DA_BARRA.filter((p) => partes[p.chave] > 0).map((p) => (
                  <span key={p.chave} className="inline-flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${p.cor}`} />
                    {p.rotulo} <span className="tabular-nums">{inteiro(partes[p.chave])}</span>
                  </span>
                ))}
                {c.pendentes > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-black/[0.08] dark:bg-white/[0.12]" />
                    Na fila <span className="tabular-nums">{inteiro(c.pendentes)}</span>
                  </span>
                )}
              </div>
              {/* 16/11/2026 (CCDA) — «por que não chegaram»: quantas por motivo, em português, com o que
                  fazer. Antes só havia «Falhou» por contato e o texto cru da Meta em inglês. */}
              {(d.motivos_falha?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl border border-red-200/70 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.05] px-3.5 py-2.5">
                  <p className="text-[12.5px] font-medium text-red-800 dark:text-red-300">
                    Por que {inteiro(d.motivos_falha!.reduce((s, x) => s + x.total, 0))} não chegaram
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {d.motivos_falha!.map((x) => (
                      <li key={String(x.codigo)} className="flex gap-2 text-[12px] leading-snug text-red-900/80 dark:text-red-200/80">
                        <span className="tabular-nums font-medium shrink-0 w-7 text-right">{inteiro(x.total)}</span>
                        <span>
                          {x.motivo}
                          {x.codigo ? <span className="text-red-900/45 dark:text-red-200/45"> · código {x.codigo}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Row>

        <Row>
          <HairCells cols={6}>
            {(texto
              ? [
                  { rotulo: "Enviados", valor: c.enviados, nota: `${pct(c.enviados, d.total)} da lista` },
                  { rotulo: "Entregues", valor: null, texto: "—", nota: "o número não oficial não confirma" },
                  { rotulo: "Lidos", valor: null, texto: "—", nota: "o número não oficial não confirma" },
                  {
                    rotulo: "Responderam",
                    valor: c.respondidos ?? 0,
                    nota: `${pct(c.respondidos ?? 0, c.enviados)} dos enviados`,
                  },
                  { rotulo: "Falharam", valor: c.falhas, nota: c.falhas ? "veja o motivo na lista" : "nenhuma falha" },
                  { rotulo: "Custo", valor: null, texto: "—", nota: "sem custo da Meta" },
                ]
              : [
                  { rotulo: "Enviados", valor: c.enviados, nota: `${pct(c.enviados, d.total)} da lista` },
                  { rotulo: "Entregues", valor: c.entregues, nota: `${pct(c.entregues, c.enviados)} dos enviados` },
                  { rotulo: "Lidos", valor: c.lidos, nota: `${pct(c.lidos, c.entregues)} dos entregues` },
                  {
                    rotulo: "Responderam",
                    valor: c.respondidos ?? 0,
                    nota: `${pct(c.respondidos ?? 0, c.entregues)} dos entregues`,
                  },
                  { rotulo: "Falharam", valor: c.falhas, nota: c.falhas ? "veja o motivo na lista" : "nenhuma falha" },
                  {
                    rotulo: "Custo até agora",
                    valor: null,
                    texto: preco !== null ? brl(c.entregues * preco) : "—",
                    nota: preco !== null ? `${inteiro(c.entregues)} entregues × ${brl(preco)}` : "categoria sem preço conhecido",
                  },
                ]
            ).map((k: { rotulo: string; valor: number | null; texto?: string; nota: string }) => (
              <div key={k.rotulo} className="px-6 py-5">
                <p className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${FC.mut}`}>{k.rotulo}</p>
                <p className={`mt-1.5 text-[24px] font-medium tabular-nums leading-8 ${FC.ink}`}>
                  {k.valor !== null ? inteiro(k.valor) : k.texto}
                </p>
                <p className={`mt-0.5 text-[11.5px] ${FC.mut}`}>{k.nota}</p>
              </div>
            ))}
          </HairCells>
        </Row>

        <Row last>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* contato a contato */}
            <div className={`min-w-0 lg:border-r ${FC.hair}`}>
              <div className={`px-6 py-3 border-b ${FC.hair} space-y-3`}>
                <div className="flex flex-wrap gap-1.5">
                  {FILTROS.map((f) => {
                    const n = f.conta(d);
                    if (f.valor && !n && filtro !== f.valor) return null;
                    const ativo = filtro === f.valor;
                    return (
                      <button
                        key={f.rotulo}
                        type="button"
                        onClick={() => {
                          setFiltro(f.valor);
                          setPagina(0);
                        }}
                        className={`h-7 px-2.5 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5 transition-all active:scale-[0.98] border ${
                          ativo
                            ? "border-transparent bg-[#003083]/[0.07] text-[#003083] dark:bg-[#5b9bff]/[0.14] dark:text-[#8ab4ff]"
                            : `${FC.hair} ${FC.sub} ${FC.hover}`
                        }`}
                      >
                        {f.rotulo}
                        <span className="tabular-nums opacity-70">{inteiro(Math.max(0, n))}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative max-w-[320px]">
                  <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${FC.mut}`} />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou número" className="pl-8" />
                </div>
              </div>
              {envios === null ? (
                <div className="px-6 py-6 space-y-3">
                  <SkeletonBar className="h-4 w-80" />
                  <SkeletonBar className="h-4 w-72" />
                </div>
              ) : envios.length === 0 ? (
                <EmptyHint icon={Search} text="Nenhum contato com esse filtro." className="py-10" />
              ) : (
                <ul>
                  {envios.map((e) => {
                    const s = SITUACAO[e.situacao] ?? { texto: e.situacao, tom: "neutro" as const };
                    return (
                      <li key={e.id} className={`px-6 py-2.5 border-b ${FC.hair} last:border-b-0 grid grid-cols-[minmax(0,1fr)_auto] gap-3`}>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                            <span className={`tabular-nums ${FC.ink}`}>{formatPhone(e.numero)}</span>
                            {e.nome && <span className={`truncate ${FC.sub}`}>{e.nome}</span>}
                            <Pilula texto={s.texto} tom={s.tom} />
                            {e.respondeu_em && <Pilula texto={`Respondeu ${quando(e.respondeu_em)}`} tom="ok" />}
                          </p>
                          {e.motivo && (
                            <p
                              className={`mt-0.5 text-[11.5px] leading-4 ${
                                e.situacao === "falhou" ? "text-red-700 dark:text-red-400" : FC.mut
                              }`}
                            >
                              {e.motivo}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`text-[11.5px] tabular-nums ${FC.mut}`}>
                            {e.status_em && e.situacao !== "enviado" ? quando(e.status_em) : quando(e.enviado_em)}
                          </p>
                          {(e.conversation_id || e.crm_url) && (
                            <p className="flex items-center justify-end gap-3">
                              {e.conversation_id && (
                                <a
                                  href={`/admin/conversas?open=${e.conversation_id}${embed ? "&embed=1" : ""}`}
                                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#003083] dark:text-[#5b9bff] hover:underline"
                                >
                                  Conversa <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              {e.crm_url && (
                                <a
                                  href={e.crm_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Abre o card da família no CRM"
                                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#003083] dark:text-[#5b9bff] hover:underline"
                                >
                                  Card no CRM <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {totalEnvios > POR_PAGINA && (
                <div className={`px-6 py-3 border-t ${FC.hair} flex items-center justify-between text-[12px] ${FC.sub}`}>
                  <span className="tabular-nums">
                    {inteiro(pagina * POR_PAGINA + 1)}–{inteiro(Math.min(totalEnvios, (pagina + 1) * POR_PAGINA))} de {inteiro(totalEnvios)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" className={iconBtn} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} title="Anterior">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={pagina + 1 >= paginas}
                      onClick={() => setPagina((p) => p + 1)}
                      title="Próxima"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* o que foi enviado */}
            <aside className={`px-6 py-5 border-t lg:border-t-0 ${FC.hair} space-y-5`}>
              <div>
                <h3 className={`text-[13px] font-medium ${FC.ink}`}>O que foi enviado</h3>
                <div className={`mt-2 rounded-xl p-3 ${FC.base}`}>
                  {texto ? (
                    <BalaoDoModelo corpo={comNome(d.texto || "", "[primeiro nome]")} />
                  ) : modelo ? (
                    <BalaoDoModelo
                      corpo={[modelo.cabecalho, preencher(modelo.corpo, valoresDoBalao)].filter(Boolean).join("\n\n")}
                      rodape={modelo.rodape}
                      botoes={modelo.botoes}
                    />
                  ) : (
                    <p className={`text-[12px] ${FC.mut}`}>Modelo {d.modelo}</p>
                  )}
                </div>
              </div>
              {!texto && d.variaveis.length > 0 && (
                <dl className="space-y-1.5 text-[12px]">
                  {d.variaveis.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <dt className={`w-10 shrink-0 font-mono ${FC.mut}`}>{`{{${i + 1}}}`}</dt>
                      <dd className={FC.sub}>{v.fonte === "nome" ? "primeiro nome da lista" : `«${v.valor}»`}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <dl className={`divide-y ${FC.hair} border-y ${FC.hair} text-[12.5px]`}>
                <div className="flex justify-between gap-3 py-2">
                  <dt className={FC.sub}>Contatos na lista</dt>
                  <dd className={`tabular-nums ${FC.ink}`}>{inteiro(d.total)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2">
                  <dt className={FC.sub}>Ritmo</dt>
                  <dd className={`tabular-nums ${FC.ink}`}>
                    {d.intervalo_s} s ± {String(d.variacao_s).replace(".", ",")} s
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-2">
                  <dt className={FC.sub}>Iniciado</dt>
                  <dd className={`tabular-nums ${FC.ink}`}>{quando(d.iniciado_em)}</dd>
                </div>
                {d.concluido_em && (
                  <div className="flex justify-between gap-3 py-2">
                    <dt className={FC.sub}>Concluído</dt>
                    <dd className={`tabular-nums ${FC.ink}`}>{quando(d.concluido_em)}</dd>
                  </div>
                )}
                {d.cancelado_em && (
                  <div className="flex justify-between gap-3 py-2">
                    <dt className={FC.sub}>Cancelado</dt>
                    <dd className={`tabular-nums ${FC.ink}`}>{quando(d.cancelado_em)}</dd>
                  </div>
                )}
              </dl>
              {texto ? (
                <p className={`text-[11px] leading-4 ${FC.mut}`}>
                  Pelo número não oficial o WhatsApp não confirma entrega nem leitura para o sistema: conta-se enviado e quem
                  respondeu. Antes de cada envio o sistema confere se o número tem WhatsApp — quem não tem fica como falha.
                </p>
              ) : (
                <p className={`text-[11px] leading-4 ${FC.mut}`}>
                  Entregue e lido chegam pelo retorno da Meta e continuam mudando depois que o disparo termina. Custo = entregues ×
                  a tabela da Meta para o Brasil{preco !== null ? ` (${nomeDaCategoria(d.categoria)}, ${brl(preco)})` : ""}; quem
                  paga é a conta da Meta do número.
                </p>
              )}
            </aside>
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

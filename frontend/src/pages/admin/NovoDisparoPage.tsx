// Novo disparo (11/11/2026): número oficial + modelo aprovado + lista colada + de onde vem cada
// variável. A lista é lida no servidor (a mesma regra que cria o disparo), e a tela mostra o
// que vai acontecer antes: quantos recebem, quem fica de fora, o balão e o custo.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Megaphone } from "lucide-react";

import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import BalaoDoModelo from "@/components/whatsapp/BalaoDoModelo";
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
  useConfirmar,
} from "@/components/ds/fc";
import {
  type ModeloResumo,
  type Variavel,
  brl,
  duracao,
  inteiro,
  mensagemDeErro,
  nomeDaCategoria,
  precoDaCategoria,
  preencher,
  quando,
} from "@/lib/disparos";

interface Numero {
  id: number;
  agente: string;
  telefone: string | null;
  nome_verificado: string | null;
  ativo: boolean;
}
interface ModeloDoDisparo extends ModeloResumo {
  bloqueio: string | null;
}
interface Previa {
  validos: number;
  duplicados: number;
  invalidas: { linha: number; texto: string; motivo: string }[];
  total_invalidas: number;
  com_nome: number;
  descadastrados: number;
  descadastrados_sem_nome: number;
  limite: number;
  acima_do_limite: boolean;
  amostra: { numero: string; nome: string | null; primeiro_nome: string | null; descadastrado: boolean }[];
}

const INTERVALO_MIN = 2;
const INTERVALO_MAX = 300;
const FONTES = [
  { value: "nome" as const, label: "Primeiro nome da lista" },
  { value: "fixo" as const, label: "Texto fixo" },
];
const QUANDO = [
  { value: "agora" as const, label: "Assim que iniciar" },
  { value: "agendar" as const, label: "Agendar" },
];

function chave(m: { nome: string; idioma: string }) {
  return `${m.nome}|${m.idioma}`;
}

export default function NovoDisparoPage() {
  const nav = useNavigate();
  const [confirmar, dialogo] = useConfirmar();

  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [podeCriar, setPodeCriar] = useState(true);
  const [numeroId, setNumeroId] = useState<number | null>(null);
  const [modelos, setModelos] = useState<ModeloDoDisparo[] | null>(null);
  const [erroModelos, setErroModelos] = useState<string | null>(null);
  const [modeloChave, setModeloChave] = useState<string | null>(null);
  const [fontes, setFontes] = useState<Variavel[]>([]);
  const [lista, setLista] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [lendo, setLendo] = useState(false);
  const [intervalo, setIntervalo] = useState("8");
  const [modoInicio, setModoInicio] = useState<"agora" | "agendar">("agora");
  const [agendarPara, setAgendarPara] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  // números oficiais ligados
  useEffect(() => {
    api
      .get<{ numeros: Numero[]; pode_criar: boolean }>("/whatsapp-oficial/numeros")
      .then(({ data }) => {
        const ativos = data.numeros.filter((n) => n.ativo);
        setNumeros(ativos);
        setPodeCriar(data.pode_criar);
        setNumeroId(ativos[0]?.id ?? null);
      })
      .catch(() => setNumeros([]));
  }, []);

  // modelos aprovados do número
  useEffect(() => {
    if (!numeroId || !podeCriar) return;
    setModelos(null);
    setErroModelos(null);
    api
      .get<{ modelos: ModeloDoDisparo[] }>("/disparos-oficiais/modelos", { params: { connector_id: numeroId } })
      .then(({ data }) => {
        setModelos(data.modelos);
        const primeiro = data.modelos.find((m) => !m.bloqueio);
        setModeloChave(primeiro ? chave(primeiro) : null);
      })
      .catch((e) => {
        setModelos([]);
        setModeloChave(null);
        setErroModelos(mensagemDeErro(e, "Não consegui buscar os modelos na Meta"));
      });
  }, [numeroId, podeCriar]);

  const usaveis = useMemo(() => (modelos || []).filter((m) => !m.bloqueio), [modelos]);
  const bloqueados = useMemo(() => (modelos || []).filter((m) => m.bloqueio), [modelos]);
  const modelo = useMemo(() => usaveis.find((m) => chave(m) === modeloChave) ?? null, [usaveis, modeloChave]);

  // {{1}} costuma ser o nome; as outras começam como texto fixo.
  useEffect(() => {
    const n = modelo?.variaveis ?? 0;
    setFontes(Array.from({ length: n }, (_, i): Variavel => (i === 0 ? { fonte: "nome" } : { fonte: "fixo", valor: "" })));
  }, [modelo]);

  // prévia da lista (no servidor, a mesma leitura que cria o disparo)
  const pedido = useRef(0);
  useEffect(() => {
    const texto = lista.trim();
    if (!texto) {
      setPrevia(null);
      setLendo(false);
      return;
    }
    setLendo(true);
    const meu = ++pedido.current;
    const t = window.setTimeout(() => {
      api
        .post<Previa>("/disparos-oficiais/ler-lista", { texto: lista })
        .then(({ data }) => meu === pedido.current && setPrevia(data))
        .catch((e) => meu === pedido.current && toast.error(mensagemDeErro(e, "Não consegui ler a lista")))
        .finally(() => meu === pedido.current && setLendo(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [lista]);

  // ── contas ──
  const usaNome = fontes.some((f) => f.fonte === "nome");
  const semNome = previa && usaNome ? Math.max(0, previa.validos - previa.com_nome - previa.descadastrados_sem_nome) : 0;
  const vaoReceber = previa ? Math.max(0, previa.validos - previa.descadastrados - semNome) : 0;
  const preco = precoDaCategoria(modelo?.categoria);
  const intervaloN = Number(intervalo);
  const intervaloOk = Number.isInteger(intervaloN) && intervaloN >= INTERVALO_MIN && intervaloN <= INTERVALO_MAX;
  const variacao = intervaloOk ? Math.round(intervaloN * 0.25 * 10) / 10 : 0;
  const quandoComeca = modoInicio === "agendar" && agendarPara ? new Date(agendarPara) : null;
  const agendaOk = modoInicio === "agora" || (!!quandoComeca && quandoComeca.getTime() > Date.now());
  const fixosOk = fontes.every((f) => f.fonte === "nome" || !!f.valor?.trim());

  const exemplo =
    previa?.amostra.find((a) => !a.descadastrado && (!usaNome || a.primeiro_nome)) ?? previa?.amostra[0] ?? null;
  const valoresExemplo = fontes.map((f) =>
    f.fonte === "nome" ? exemplo?.primeiro_nome || "[primeiro nome]" : f.valor?.trim() || "",
  );
  const corpoExemplo = modelo
    ? [modelo.cabecalho, preencher(modelo.corpo, valoresExemplo)].filter(Boolean).join("\n\n")
    : "";

  const pendencias: string[] = [];
  if (!numeroId) pendencias.push("escolha o número");
  if (!modelo) pendencias.push("escolha um modelo aprovado");
  if (!previa || previa.validos === 0) pendencias.push("cole a lista de contatos");
  else if (previa.acima_do_limite) pendencias.push(`a lista passa de ${inteiro(previa.limite)} contatos`);
  else if (vaoReceber === 0) pendencias.push("ninguém da lista vai receber");
  if (!fixosOk) pendencias.push("escreva o texto fixo de cada variável");
  if (!intervaloOk) pendencias.push(`intervalo entre ${INTERVALO_MIN} e ${INTERVALO_MAX} segundos`);
  if (!agendaOk) pendencias.push("escolha um horário futuro");
  const pronto = pendencias.length === 0 && !lendo && !salvando;

  async function salvar(iniciar: boolean) {
    if (!pronto || !modelo || !numeroId) return;
    if (iniciar) {
      const ok = await confirmar({
        titulo: `Enviar «${modelo.nome}» para ${inteiro(vaoReceber)} contato${vaoReceber === 1 ? "" : "s"}?`,
        texto: (
          <>
            {preco !== null && (
              <p>
                Custo estimado de até <b className="tabular-nums">{brl(vaoReceber * preco)}</b>, cobrado pela Meta na conta do
                número ({nomeDaCategoria(modelo.categoria)}, por mensagem entregue).
              </p>
            )}
            <p className="mt-2">
              {quandoComeca ? `Começa ${quando(quandoComeca.toISOString())}` : "Começa agora"} e leva cerca de{" "}
              {duracao(vaoReceber * intervaloN)}. Dá para pausar ou cancelar a qualquer momento.
            </p>
          </>
        ),
        confirmar: "Iniciar disparo",
      });
      if (!ok) return;
    }
    setSalvando(true);
    let id: number | null = null;
    try {
      const { data } = await api.post<{ id: number }>("/disparos-oficiais", {
        connector_id: numeroId,
        modelo: modelo.nome,
        idioma: modelo.idioma,
        nome: nome.trim() || null,
        variaveis: fontes.map((f) => (f.fonte === "nome" ? { fonte: "nome" } : { fonte: "fixo", valor: f.valor.trim() })),
        lista,
        intervalo_s: intervaloN,
        agendar_para: quandoComeca ? quandoComeca.toISOString() : null,
      });
      id = data.id;
      if (iniciar) {
        await api.post(`/disparos-oficiais/${id}/iniciar`);
        toast.success(quandoComeca ? "Disparo agendado" : "Disparo iniciado");
      } else {
        toast.success("Rascunho salvo — inicie quando quiser");
      }
      nav(`/admin/disparos/${id}`);
    } catch (e) {
      toast.error(mensagemDeErro(e, id ? "O disparo foi salvo, mas não começou" : "Não consegui criar o disparo"));
      if (id) nav(`/admin/disparos/${id}`);
    } finally {
      setSalvando(false);
    }
  }

  const voltar = (
    <Link to="/admin/disparos" className={`inline-flex items-center gap-1 text-[12.5px] ${FC.sub} hover:text-[#262626] dark:hover:text-white`}>
      <ArrowLeft className="w-3.5 h-3.5" /> Disparos
    </Link>
  );

  return (
    <div className="-mx-8 pb-10">
      {dialogo}
      <PageFrame>
        <PageHero
          title="Novo disparo"
          subtitle="Um modelo aprovado pela Meta, pelo número oficial, para a lista que você colar. Antes de começar você vê quem recebe, como chega e quanto custa."
          right={voltar}
        />

        {numeros === null ? (
          <Row last>
            <div className="px-6 py-8 space-y-3">
              <SkeletonBar className="h-4 w-64" />
              <SkeletonBar className="h-4 w-80" />
            </div>
          </Row>
        ) : !podeCriar ? (
          <Row last>
            <EmptyHint icon={Megaphone} text="Só o dono da conta e os administradores criam disparos." className="py-12" />
          </Row>
        ) : numeros.length === 0 ? (
          <Row last>
            <EmptyHint
              icon={Megaphone}
              text="Disparo sai pelo WhatsApp oficial (API da Meta), e não há número oficial ligado. Conecte um em Canais › Conectar canal › WhatsApp Oficial."
              ctaLabel="Ir para Canais"
              ctaTo="/admin/canais"
              className="py-12"
            />
          </Row>
        ) : (
          <Row last>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* ── formulário ── */}
              <div className={`min-w-0 lg:border-r ${FC.hair}`}>
                <section className={`px-6 py-5 border-b ${FC.hair} grid grid-cols-1 md:grid-cols-2 gap-4`}>
                  <Field label="Número oficial">
                    <Select
                      value={numeroId}
                      onChange={setNumeroId}
                      options={numeros.map((n) => ({ value: n.id, label: `${formatPhone(n.telefone)} · ${n.agente}` }))}
                    />
                  </Field>
                  <Field
                    label="Modelo aprovado"
                    hint={
                      modelo ? (
                        <>
                          {nomeDaCategoria(modelo.categoria)}
                          {preco !== null ? ` · cerca de ${brl(preco)} por mensagem entregue` : ""} ·{" "}
                          <Link to={`/admin/canais/modelos?numero=${numeroId}`} className="text-[#003083] dark:text-[#5b9bff] hover:underline">
                            criar modelo
                          </Link>
                        </>
                      ) : undefined
                    }
                  >
                    {modelos === null ? (
                      <SkeletonBar className="h-8 w-full" />
                    ) : usaveis.length === 0 ? (
                      <p className={`text-[12.5px] leading-5 ${FC.sub}`}>
                        {erroModelos || "Este número não tem modelo aprovado que sirva para disparo. "}
                        <Link to={`/admin/canais/modelos?numero=${numeroId}`} className="text-[#003083] dark:text-[#5b9bff] hover:underline">
                          Criar um modelo
                        </Link>
                      </p>
                    ) : (
                      <Select
                        value={modeloChave}
                        onChange={setModeloChave}
                        options={usaveis.map((m) => ({ value: chave(m), label: m.nome, busca: `${m.nome} ${m.corpo}` }))}
                      />
                    )}
                  </Field>
                  {bloqueados.length > 0 && (
                    <div className="md:col-span-2">
                      <details className={`text-[11.5px] leading-4 ${FC.mut}`}>
                        <summary className="cursor-pointer select-none">
                          {bloqueados.length} modelo{bloqueados.length === 1 ? "" : "s"} aprovado{bloqueados.length === 1 ? "" : "s"} não
                          entra{bloqueados.length === 1 ? "" : "m"} em disparo por aqui
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {bloqueados.map((m) => (
                            <li key={chave(m)}>
                              <span className="font-mono">{m.nome}</span> — {m.bloqueio}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  )}
                </section>

                <section className={`px-6 py-5 border-b ${FC.hair}`}>
                  <Field
                    label="Contatos"
                    right={previa ? `${inteiro(previa.validos)}/${inteiro(previa.limite)}` : undefined}
                    hint="Uma linha por contato: nome e telefone (coluna copiada da planilha, ou «Maria Silva 11 98765-4321») ou só o número. Número repetido sai uma vez."
                  >
                    <Textarea
                      value={lista}
                      onChange={(e) => setLista(e.target.value)}
                      rows={9}
                      spellCheck={false}
                      placeholder={"Maria Silva\t11 98765-4321\nJoão Pereira 21 99999-8888\n11 91234-5678"}
                    />
                  </Field>
                  {(previa || lendo) && (
                    <div className="mt-3 space-y-2">
                      {lendo && !previa ? (
                        <SkeletonBar className="h-4 w-72" />
                      ) : previa ? (
                        <>
                          <p className={`text-[12.5px] leading-5 ${FC.sub}`}>
                            <b className={`tabular-nums ${FC.ink}`}>{inteiro(previa.validos)}</b> número{previa.validos === 1 ? "" : "s"}
                            {previa.duplicados > 0 && <> · {inteiro(previa.duplicados)} repetido{previa.duplicados === 1 ? "" : "s"} (sai uma vez)</>}
                            {previa.total_invalidas > 0 && (
                              <span className="text-red-700 dark:text-red-400">
                                {" "}· {inteiro(previa.total_invalidas)} linha{previa.total_invalidas === 1 ? "" : "s"} sem número válido
                              </span>
                            )}
                            {semNome > 0 && (
                              <span className="text-amber-700 dark:text-amber-400"> · {inteiro(semNome)} sem nome (não recebem)</span>
                            )}
                            {previa.descadastrados > 0 && (
                              <span className="text-amber-700 dark:text-amber-400">
                                {" "}· {inteiro(previa.descadastrados)} pediu{previa.descadastrados === 1 ? "" : "ram"} para não receber
                              </span>
                            )}
                            {lendo && <span className={FC.mut}> · lendo…</span>}
                          </p>
                          {previa.acima_do_limite && (
                            <p className="text-[12px] text-red-700 dark:text-red-400">
                              O limite é de {inteiro(previa.limite)} contatos por disparo — divida a lista.
                            </p>
                          )}
                          {previa.invalidas.length > 0 && (
                            <ul className="text-[11.5px] leading-4 text-red-700/90 dark:text-red-400/90">
                              {previa.invalidas.slice(0, 5).map((l) => (
                                <li key={l.linha}>
                                  Linha {l.linha}: «{l.texto}» — {l.motivo}
                                </li>
                              ))}
                              {previa.total_invalidas > 5 && <li>e mais {inteiro(previa.total_invalidas - 5)}</li>}
                            </ul>
                          )}
                          {previa.amostra.length > 0 && (
                            <div className={`rounded-[10px] border ${FC.hair}`}>
                              <p className={`px-3 py-1.5 border-b ${FC.hair} text-[11px] font-medium uppercase tracking-[0.06em] ${FC.mut}`}>
                                Como a lista foi lida
                              </p>
                              <ul>
                                {previa.amostra.map((a) => (
                                  <li
                                    key={a.numero}
                                    className={`grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5 border-b ${FC.hair} last:border-b-0 text-[12px]`}
                                  >
                                    <span className={`tabular-nums ${FC.ink}`}>{formatPhone(a.numero)}</span>
                                    <span className={`truncate ${a.nome ? FC.sub : FC.mut}`}>{a.nome || "sem nome"}</span>
                                    <span className={`text-[11px] ${FC.mut}`}>
                                      {a.descadastrado
                                        ? "pediu para não receber"
                                        : usaNome
                                          ? a.primeiro_nome
                                            ? `nome: ${a.primeiro_nome}`
                                            : "não recebe (sem nome)"
                                          : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </section>

                {fontes.length > 0 && modelo && (
                  <section className={`px-6 py-5 border-b ${FC.hair}`}>
                    <h3 className={`text-[13px] font-medium ${FC.ink}`}>Variáveis do modelo</h3>
                    <p className={`mt-1 text-[12px] ${FC.sub}`}>
                      De onde vem cada {"{{n}}"}. Quem está sem nome na lista não recebe quando a variável é o nome — nenhum nome é
                      inventado.
                    </p>
                    <div className="mt-4 space-y-3">
                      {fontes.map((f, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <span className={`w-10 shrink-0 font-mono text-[12px] ${FC.mut}`}>{`{{${i + 1}}}`}</span>
                          <SegToggle
                            value={f.fonte}
                            onChange={(v) =>
                              setFontes((fs) =>
                                fs.map((x, j) => (j !== i ? x : v === "nome" ? { fonte: "nome" } : { fonte: "fixo", valor: "" })),
                              )
                            }
                            options={FONTES}
                          />
                          {f.fonte === "fixo" && (
                            <Input
                              value={f.valor}
                              onChange={(e) =>
                                setFontes((fs) => fs.map((x, j) => (j === i ? { fonte: "fixo", valor: e.target.value } : x)))
                              }
                              maxLength={1000}
                              placeholder="O mesmo texto para todos"
                              className="flex-1 min-w-[200px]"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field
                    label="Intervalo entre envios (segundos)"
                    hint={
                      intervaloOk
                        ? `Varia ±${String(variacao).replace(".", ",")} s de um envio para o outro — ritmo regular demais parece robô.`
                        : `Entre ${INTERVALO_MIN} e ${INTERVALO_MAX} segundos.`
                    }
                  >
                    <Input
                      type="number"
                      min={INTERVALO_MIN}
                      max={INTERVALO_MAX}
                      value={intervalo}
                      onChange={(e) => setIntervalo(e.target.value)}
                      className="w-32"
                    />
                  </Field>
                  <Field label="Começar">
                    <div className="flex flex-wrap items-center gap-2">
                      <SegToggle value={modoInicio} onChange={setModoInicio} options={QUANDO} />
                      {modoInicio === "agendar" && (
                        <Input
                          type="datetime-local"
                          value={agendarPara}
                          onChange={(e) => setAgendarPara(e.target.value)}
                          className="w-[200px]"
                        />
                      )}
                    </div>
                  </Field>
                  <Field label="Nome do disparo (opcional)" hint="Só para achar depois na lista. Sem nome, vira «modelo · data».">
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Convite para a visita de sábado" />
                  </Field>
                </section>
              </div>

              {/* ── prévia e resumo ── */}
              <aside className={`px-6 py-5 border-t lg:border-t-0 ${FC.hair}`}>
                <div className="lg:sticky lg:top-4 space-y-5">
                  <div>
                    <h3 className={`text-[13px] font-medium ${FC.ink}`}>Como chega</h3>
                    <div className={`mt-2 rounded-xl p-3 ${FC.base}`}>
                      {modelo ? (
                        <BalaoDoModelo corpo={corpoExemplo} rodape={modelo.rodape} botoes={modelo.botoes} />
                      ) : (
                        <p className={`text-[12px] ${FC.mut}`}>Escolha o modelo para ver a mensagem.</p>
                      )}
                    </div>
                    {modelo && exemplo && (
                      <p className={`mt-1.5 text-[11px] ${FC.mut}`}>
                        Com o primeiro contato da lista: {exemplo.nome || formatPhone(exemplo.numero)}.
                      </p>
                    )}
                  </div>

                  <dl className={`divide-y ${FC.hair} border-y ${FC.hair} text-[12.5px]`}>
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className={FC.sub}>Vão receber</dt>
                      <dd className={`tabular-nums font-medium ${FC.ink}`}>
                        {inteiro(vaoReceber)}
                        {previa && previa.validos !== vaoReceber && (
                          <span className={`font-normal ${FC.mut}`}> de {inteiro(previa.validos)}</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className={FC.sub}>Custo estimado</dt>
                      <dd className={`tabular-nums font-medium ${FC.ink}`}>{preco !== null ? `até ${brl(vaoReceber * preco)}` : "—"}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className={FC.sub}>Duração</dt>
                      <dd className={`tabular-nums ${FC.ink}`}>{intervaloOk && vaoReceber ? `≈ ${duracao(vaoReceber * intervaloN)}` : "—"}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className={FC.sub}>Começa</dt>
                      <dd className={`tabular-nums ${FC.ink}`}>{quandoComeca ? quando(quandoComeca.toISOString()) : "ao iniciar"}</dd>
                    </div>
                  </dl>
                  <p className={`text-[11px] leading-4 ${FC.mut}`}>
                    A Meta cobra por mensagem <b>entregue</b>, na conta do número
                    {modelo ? ` (${nomeDaCategoria(modelo.categoria)}${preco !== null ? `, ${brl(preco)} cada` : ""})` : ""} — valor da
                    tabela da Meta para o Brasil, pode mudar. A Meta também limita quantas pessoas por dia um número pode abordar
                    primeiro; acima disso os envios falham — e com mais de 30% de falha o disparo pausa sozinho.
                  </p>

                  <div className="space-y-2">
                    <Button onClick={() => void salvar(true)} disabled={!pronto} className="w-full">
                      {salvando ? "Criando…" : quandoComeca ? "Agendar disparo" : "Iniciar disparo"}
                    </Button>
                    <Button variant="secondary" onClick={() => void salvar(false)} disabled={!pronto} className="w-full">
                      Salvar como rascunho
                    </Button>
                    {pendencias.length > 0 && !lendo && (
                      <p className={`text-[11.5px] leading-4 ${FC.mut}`}>Falta: {pendencias.join(" · ")}.</p>
                    )}
                    <p className={`text-[11px] leading-4 ${FC.mut}`}>
                      Dá para pausar ou cancelar a qualquer momento. Quem pedir para parar sai da lista na hora.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </Row>
        )}
      </PageFrame>
    </div>
  );
}

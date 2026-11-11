// Relatórios › WhatsApp oficial (12/11/2026) — volume, entrega e cobrança da Meta por número oficial.
// Pedido do dono: «as infos de tudo… até das mensagens que temos, contando as gratuitas».
// Fonte: GET /reports/whatsapp-oficial (services/relatorio_whatsapp_oficial.py) e, sob pedido,
// GET /reports/whatsapp-oficial/meta (pricing_analytics da própria Meta, só leitura, com cache).
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RefreshCw, Send, Inbox, CheckCheck, Eye, Wallet, Megaphone, AlertTriangle, ArrowUpRight } from "lucide-react";

import { api } from "@/lib/api";
import { FC, Row, HairCells, Button, EmptyHint, SkeletonBar, Select, SegToggle } from "@/components/ds/fc";

interface Funil {
  aguardando: number;
  enviadas: number;
  entregues: number;
  lidas: number;
  falhas: number;
  taxa_entrega: number | null;
  taxa_leitura: number | null;
}
interface Bloco {
  enviadas_registro: number;
  recebidas: number;
  com_status_meta: number;
  funil: Funil;
  falhas_motivos: { codigo: number | null; motivo: string; texto_meta: string | null; n: number }[];
  cobranca: {
    com_dado: number;
    sem_dado: number;
    cobranca_desde: string | null;
    pagas: number;
    gratis: number;
    por_tipo: { tipo: string; rotulo: string; n: number }[];
    por_categoria: { categoria: string; rotulo: string; total: number; pagas: number; gratis: number; custo_estimado: number }[];
    custo_estimado: number;
    pagas_sem_estimativa: number;
  };
  anuncio: { contatos: number; mensagens: number; respostas_na_janela_gratis: number; contatos_na_janela_gratis: number };
  franquia_servico_mes: { limite: number; gratis: number; pagas: number };
}
interface Relatorio {
  periodo: { dias: number; de: string; ate: string; fuso: string };
  numeros: { id: number; rotulo: string; agente: string | null }[];
  connector_id: number | null;
  total: Bloco;
  por_numero: (Bloco & { connector_id: number | null; rotulo: string })[];
  anuncios: { anuncio_id: string | null; titulo: string | null; mensagens: number }[];
  tarifa: { url: string; url_servico: string; vigencia: string; conferido_em: string; observacao: string; por_categoria: Record<string, number> };
}
interface DaMeta {
  disponivel: boolean;
  motivo?: string;
  volume?: number;
  custo?: number | null;
  so_deste_numero?: boolean;
  por_tipo?: { tipo: string; rotulo: string; n: number; custo: number | null }[];
  por_categoria?: { categoria: string; rotulo: string; n: number }[];
  moeda?: string;
  aviso?: string;
  fonte?: string;
}

const TODOS = 0; // valor do Select para «todos os números»
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dataBr = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "—");
const num = (v: number) => v.toLocaleString("pt-BR");

// Cor por tipo de cobrança: paga = marca; grátis = verde; o resto, neutro.
const COR_TIPO: Record<string, string> = {
  regular: "#003083",
  free_customer_service: "#0a8f5a",
  free_entry_point: "#0f9d8a",
  free_group_customer_service: "#0a8f5a",
};
const DICA_TIPO: Record<string, string> = {
  regular: "Cobrada pela Meta. Desde 01/10/2026 inclui serviço depois da franquia e utilidade dentro da janela de 24 h.",
  free_customer_service: "Dentro das 1.000 mensagens de serviço grátis do mês, por número.",
  free_entry_point: "Dentro da janela grátis aberta por anúncio Click-to-WhatsApp (até 7 dias).",
};

function Kpi({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className={`text-[12px] ${FC.sub}`}>{label}</span>
      </div>
      <div className={`tabular-nums text-[24px] font-medium ${FC.ink}`}>{value}</div>
      {sub && <div className={`text-[11.5px] mt-0.5 tabular-nums ${FC.mut}`}>{sub}</div>}
    </div>
  );
}

function SubCard({ title, children, dica }: { title: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="p-6">
      <h3 className={`text-[20px] font-[500] leading-7 fc-crisp tracking-[-0.1px] ${dica ? "mb-1" : "mb-3"} ${FC.ink}`}>{title}</h3>
      {dica && <p className={`text-[12px] leading-snug mb-3 ${FC.mut}`}>{dica}</p>}
      {children}
    </div>
  );
}

function Barra({ rotulo, n, max, cor, dica }: { rotulo: string; n: number; max: number; cor: string; dica?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]" title={dica}>
      <span className={`w-[190px] shrink-0 truncate ${FC.sub}`}>{rotulo}</span>
      <div className="flex-1 h-2 bg-[#262626]/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%`, background: cor }} />
      </div>
      <span className={`w-12 text-right tabular-nums ${FC.ink}`}>{num(n)}</span>
    </div>
  );
}

function Esqueleto() {
  return (
    <>
      <Row>
        <HairCells cols={5}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5">
              <SkeletonBar className="h-3 w-20 mb-3" />
              <SkeletonBar className="h-6 w-14" />
            </div>
          ))}
        </HairCells>
      </Row>
      <Row last>
        <HairCells cols={2} gridLines>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="p-6">
              <SkeletonBar className="h-4 w-36 mb-4" />
              {[0, 1, 2].map((j) => (
                <SkeletonBar key={j} className="h-3 w-full mb-2.5" />
              ))}
            </div>
          ))}
        </HairCells>
      </Row>
    </>
  );
}

export default function WhatsAppOficialRelatorio() {
  const [dias, setDias] = useState(30);
  const [numero, setNumero] = useState<number>(TODOS);
  const [data, setData] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<DaMeta | null>(null);
  const [buscandoMeta, setBuscandoMeta] = useState(false);

  async function load(d = dias, n = numero) {
    setLoading(true);
    setMeta(null);
    try {
      const params: Record<string, number> = { days: d };
      if (n !== TODOS) params.connector_id = n;
      const { data } = await api.get<Relatorio>("/reports/whatsapp-oficial", { params });
      setData(data);
    } catch {
      toast.error("Falha ao carregar o relatório do WhatsApp oficial");
    } finally {
      setLoading(false);
    }
  }

  async function buscarMeta() {
    if (numero === TODOS) return;
    setBuscandoMeta(true);
    try {
      const { data } = await api.get<DaMeta>("/reports/whatsapp-oficial/meta", { params: { connector_id: numero, days: dias } });
      setMeta(data);
    } catch {
      toast.error("Falha ao consultar a Meta");
    } finally {
      setBuscandoMeta(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opcoesNumero = [
    { value: TODOS, label: "Todos os números" },
    ...(data?.numeros || []).map((n) => ({ value: n.id, label: n.agente ? `${n.rotulo} · ${n.agente}` : n.rotulo })),
  ];
  const t = data?.total;
  const c = t?.cobranca;
  const maxTipo = c ? Math.max(1, ...c.por_tipo.map((x) => x.n), c.sem_dado) : 1;
  const maxFunil = t ? Math.max(1, t.funil.enviadas + t.funil.falhas + t.funil.aguardando) : 1;

  return (
    <>
      <Row>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <SegToggle
            value={dias}
            onChange={(d) => {
              setDias(d);
              load(d, numero);
            }}
            options={[
              { value: 7, label: "7 dias" },
              { value: 30, label: "30 dias" },
              { value: 90, label: "90 dias" },
            ]}
          />
          <Select
            value={numero}
            options={opcoesNumero}
            onChange={(n) => {
              setNumero(n);
              load(dias, n);
            }}
            className="w-[300px]"
          />
          <Button variant="secondary" onClick={() => load()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          {data && (
            <span className={`ml-auto text-[12px] tabular-nums ${FC.mut}`}>
              {dataBr(data.periodo.de)} a {dataBr(data.periodo.ate)} · horário de Brasília
            </span>
          )}
        </div>
      </Row>

      {loading ? (
        <Esqueleto />
      ) : !data ? null : data.numeros.length === 0 ? (
        <Row last>
          <div className="py-16">
            <EmptyHint
              icon={Send}
              text="Nenhum número oficial (API da Meta) conectado — este relatório nasce quando o primeiro número oficial começar a falar."
              ctaLabel="Conectar número oficial"
              ctaTo="/admin/canais"
            />
          </div>
        </Row>
      ) : t && c ? (
        <>
          {/* Pagas × grátis — o número que o dono pediu */}
          <Row>
            <div className="flex flex-wrap items-center gap-6 p-6">
              <div className="shrink-0">
                <div className={`text-[40px] font-[450] leading-none tracking-[-1px] tabular-nums ${FC.ink}`}>{brl(c.custo_estimado)}</div>
                <div className={`text-[12px] mt-1 ${FC.sub}`}>custo estimado das pagas</div>
              </div>
              <div className={`h-12 w-px ${FC.hairBg}`} />
              <div className="flex-1 grid grid-cols-3 gap-4 min-w-[320px]">
                <div>
                  <div className="text-[20px] tabular-nums font-medium text-[#003083] dark:text-[#5b9bff]">{num(c.pagas)}</div>
                  <div className={`text-[12px] ${FC.sub}`}>pagas</div>
                </div>
                <div>
                  <div className="text-[20px] tabular-nums font-medium text-[#0a8f5a]">{num(c.gratis)}</div>
                  <div className={`text-[12px] ${FC.sub}`}>grátis</div>
                </div>
                <div>
                  <div className={`text-[20px] tabular-nums font-medium ${FC.mut}`}>{num(c.sem_dado)}</div>
                  <div className={`text-[12px] ${FC.sub}`}>sem dado de cobrança</div>
                </div>
              </div>
            </div>
            <p className={`px-6 pb-4 -mt-2 text-[11.5px] leading-snug ${FC.mut}`}>
              {c.cobranca_desde
                ? `A cobrança de cada mensagem vem da própria Meta e é gravada desde ${dataBr(c.cobranca_desde)}. `
                : "A Meta ainda não mandou a cobrança de nenhuma mensagem deste período. "}
              «Sem dado» = mensagem de antes disso, ainda sem retorno, ou que falhou (falha não é cobrada) — nunca é contada como grátis.
              {c.pagas_sem_estimativa > 0 && ` ${num(c.pagas_sem_estimativa)} paga(s) sem estimativa (contato fora do Brasil ou preço por lance).`}
            </p>
          </Row>

          <Row>
            <HairCells cols={5}>
              <Kpi icon={Send} label="Enviadas por nós" value={num(t.enviadas_registro)} sub={`${num(t.com_status_meta)} com retorno da Meta`} color="#003083" />
              <Kpi icon={Inbox} label="Recebidas dos contatos" value={num(t.recebidas)} color="#003083" />
              <Kpi icon={CheckCheck} label="Entregues" value={pct(t.funil.taxa_entrega)} sub={`${num(t.funil.entregues)} de ${num(t.funil.enviadas + t.funil.falhas)}`} color="#0a8f5a" />
              <Kpi icon={Eye} label="Lidas" value={pct(t.funil.taxa_leitura)} sub={`${num(t.funil.lidas)} das entregues`} color="#7c3aed" />
              <Kpi icon={Wallet} label="Custo estimado" value={brl(c.custo_estimado)} sub={`${num(c.pagas)} pagas`} color="#F5A300" />
            </HairCells>
          </Row>

          <Row>
            <HairCells cols={2} gridLines>
              <SubCard title="Grátis e pagas" dica="Pelo tipo que a Meta informa em cada mensagem. Desde 01/10/2026 a janela de 24 h, sozinha, não deixa mais grátis.">
                {c.com_dado === 0 && c.sem_dado === 0 ? (
                  <p className={`text-[12px] ${FC.sub}`}>Nenhuma mensagem enviada no período.</p>
                ) : (
                  <div className="space-y-2">
                    {c.por_tipo.map((x) => (
                      <Barra key={x.tipo} rotulo={x.rotulo} n={x.n} max={maxTipo} cor={COR_TIPO[x.tipo] || "#8b93a0"} dica={DICA_TIPO[x.tipo]} />
                    ))}
                    <Barra rotulo="Sem dado de cobrança" n={c.sem_dado} max={maxTipo} cor="#c4c8cf" />
                  </div>
                )}
              </SubCard>

              <SubCard title="Por categoria" dica="Categoria da tarifa aplicada pela Meta. Custo = pagas × tabela BRL da Meta para +55.">
                {c.por_categoria.length === 0 ? (
                  <p className={`text-[12px] ${FC.sub}`}>Sem cobrança informada ainda.</p>
                ) : (
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className={`text-[11px] ${FC.mut}`}>
                        <th className="text-left font-normal pb-1.5">Categoria</th>
                        <th className="text-right font-normal pb-1.5">Total</th>
                        <th className="text-right font-normal pb-1.5">Pagas</th>
                        <th className="text-right font-normal pb-1.5">Grátis</th>
                        <th className="text-right font-normal pb-1.5">Custo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.por_categoria.map((x) => (
                        <tr key={x.categoria} className={`border-t ${FC.hair}`}>
                          <td className={`py-1.5 pr-2 ${FC.ink}`}>{x.rotulo}</td>
                          <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{num(x.total)}</td>
                          <td className={`py-1.5 text-right tabular-nums font-medium ${FC.ink}`}>{num(x.pagas)}</td>
                          <td className="py-1.5 text-right tabular-nums text-[#0a8f5a]">{num(x.gratis)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{brl(x.custo_estimado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </SubCard>

              <SubCard title="Entrega" dica="«Lida» depende de o contato ter a confirmação de leitura ligada.">
                <div className="space-y-2">
                  <Barra rotulo="Saíram (enviada ou além)" n={t.funil.enviadas} max={maxFunil} cor="#003083" />
                  <Barra rotulo="Entregues" n={t.funil.entregues} max={maxFunil} cor="#0a8f5a" />
                  <Barra rotulo="Lidas" n={t.funil.lidas} max={maxFunil} cor="#7c3aed" />
                  <Barra rotulo="Falharam" n={t.funil.falhas} max={maxFunil} cor="#E5484D" />
                  {t.funil.aguardando > 0 && <Barra rotulo="Aguardando retorno da Meta" n={t.funil.aguardando} max={maxFunil} cor="#c4c8cf" />}
                </div>
              </SubCard>

              <SubCard title="Por que falharam">
                {t.falhas_motivos.length === 0 ? (
                  <p className={`text-[12px] ${FC.sub}`}>Nenhuma falha no período.</p>
                ) : (
                  <div className="space-y-2">
                    {t.falhas_motivos.map((f, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 text-[12.5px]" title={f.texto_meta || undefined}>
                        <span className={`flex items-start gap-1.5 ${FC.sub}`}>
                          <AlertTriangle className="w-3.5 h-3.5 mt-[2px] shrink-0 text-[#E5484D]" />
                          <span>
                            {f.motivo}
                            {f.codigo != null && <span className={`ml-1 text-[10.5px] tabular-nums ${FC.mut}`}>({f.codigo})</span>}
                          </span>
                        </span>
                        <span className={`tabular-nums font-medium ${FC.ink}`}>{num(f.n)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SubCard>

              <SubCard title="Anúncios" dica="Click-to-WhatsApp: a mensagem que chega do anúncio traz a marca do anúncio; a resposta nossa dentro da janela grátis vem marcada pela Meta.">
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div>
                    <div className={`text-[20px] tabular-nums font-medium ${FC.ink}`}>{num(t.anuncio.contatos)}</div>
                    <div className={`text-[12px] ${FC.sub}`}>contatos chegaram por anúncio</div>
                  </div>
                  <div>
                    <div className={`text-[20px] tabular-nums font-medium ${FC.ink}`}>{num(t.anuncio.contatos_na_janela_gratis)}</div>
                    <div className={`text-[12px] ${FC.sub}`}>atendidos na janela grátis</div>
                  </div>
                  <div>
                    <div className="text-[20px] tabular-nums font-medium text-[#0a8f5a]">{num(t.anuncio.respostas_na_janela_gratis)}</div>
                    <div className={`text-[12px] ${FC.sub}`}>respostas grátis</div>
                  </div>
                </div>
                {data.anuncios.length > 0 ? (
                  <div className="space-y-1.5">
                    {data.anuncios.map((a, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className={`flex items-center gap-1.5 truncate ${FC.sub}`}>
                          <Megaphone className="w-3.5 h-3.5 shrink-0 text-[#003083] dark:text-[#5b9bff]" />
                          <span className="truncate">{a.titulo || `Anúncio ${a.anuncio_id || "sem id"}`}</span>
                        </span>
                        <span className={`tabular-nums ${FC.ink}`}>{num(a.mensagens)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={`text-[12px] ${FC.sub}`}>Nenhuma mensagem chegou de anúncio no período.</p>
                )}
              </SubCard>

              <SubCard title="Franquia de serviço do mês" dica="Desde 01/10/2026 cada número tem 1.000 mensagens de serviço (resposta livre) grátis por mês; a partir da 1.001ª, a Meta cobra.">
                {data.por_numero.filter((n) => n.connector_id != null).length === 0 ? (
                  <p className={`text-[12px] ${FC.sub}`}>—</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.por_numero
                      .filter((n) => n.connector_id != null)
                      .map((n) => {
                        const f = n.franquia_servico_mes;
                        const usado = f.gratis + f.pagas;
                        return (
                          <div key={n.connector_id ?? "x"}>
                            <div className="flex items-center justify-between text-[12px] mb-1">
                              <span className={`truncate ${FC.sub}`}>{n.rotulo}</span>
                              <span className={`tabular-nums ${FC.ink}`}>
                                {num(Math.min(usado, f.limite))} de {num(f.limite)}
                                {f.pagas > 0 && <span className="ml-1 text-[#003083] dark:text-[#5b9bff]">· {num(f.pagas)} pagas</span>}
                              </span>
                            </div>
                            <div className="h-2 bg-[#262626]/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-[#0a8f5a]" style={{ width: `${Math.min(100, (usado / f.limite) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    <p className={`text-[11px] ${FC.mut}`}>Conta o que a Meta já informou neste mês (horário de Brasília; a Meta vira o mês no fuso da conta).</p>
                  </div>
                )}
              </SubCard>
            </HairCells>
          </Row>

          {data.connector_id == null && data.por_numero.length > 1 && (
            <Row>
              <SubCard title="Por número">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className={`text-[11px] ${FC.mut}`}>
                      <th className="text-left font-normal pb-1.5">Número</th>
                      <th className="text-right font-normal pb-1.5">Enviadas</th>
                      <th className="text-right font-normal pb-1.5">Recebidas</th>
                      <th className="text-right font-normal pb-1.5">Entregues</th>
                      <th className="text-right font-normal pb-1.5">Pagas</th>
                      <th className="text-right font-normal pb-1.5">Grátis</th>
                      <th className="text-right font-normal pb-1.5">Sem dado</th>
                      <th className="text-right font-normal pb-1.5">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_numero.map((n) => (
                      <tr key={n.connector_id ?? "sem"} className={`border-t ${FC.hair}`}>
                        <td className={`py-1.5 pr-2 tabular-nums ${FC.ink}`}>{n.rotulo}</td>
                        <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{num(n.enviadas_registro)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{num(n.recebidas)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{pct(n.funil.taxa_entrega)}</td>
                        <td className={`py-1.5 text-right tabular-nums font-medium ${FC.ink}`}>{num(n.cobranca.pagas)}</td>
                        <td className="py-1.5 text-right tabular-nums text-[#0a8f5a]">{num(n.cobranca.gratis)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${FC.mut}`}>{num(n.cobranca.sem_dado)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${FC.sub}`}>{brl(n.cobranca.custo_estimado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SubCard>
            </Row>
          )}

          <Row last>
            <SubCard title="O número da própria Meta" dica="Para conferir o nosso: o que a Meta registra como entregue e cobrado no período (dado aproximado, pode diferir da fatura).">
              {numero === TODOS ? (
                <p className={`text-[12.5px] ${FC.sub}`}>Escolha um número acima para consultar a Meta.</p>
              ) : !meta ? (
                <Button variant="secondary" onClick={buscarMeta} disabled={buscandoMeta}>
                  <RefreshCw className={`w-3.5 h-3.5 ${buscandoMeta ? "animate-spin motion-reduce:animate-none" : ""}`} /> Consultar a Meta
                </Button>
              ) : !meta.disponivel ? (
                <p className={`text-[12.5px] ${FC.sub}`}>Não deu para consultar: {meta.motivo}</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <div className={`text-[20px] tabular-nums font-medium ${FC.ink}`}>{num(meta.volume || 0)}</div>
                      <div className={`text-[12px] ${FC.sub}`}>entregues segundo a Meta</div>
                    </div>
                    <div>
                      <div className={`text-[20px] tabular-nums font-medium ${FC.ink}`}>
                        {meta.custo == null ? "—" : meta.custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                      <div className={`text-[12px] ${FC.sub}`}>custo {meta.moeda}</div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {(meta.por_tipo || []).map((x) => (
                      <div key={x.tipo} className="flex items-center justify-between text-[12.5px]">
                        <span className={FC.sub}>{x.rotulo}</span>
                        <span className={`tabular-nums ${FC.ink}`}>{num(x.n)}</span>
                      </div>
                    ))}
                  </div>
                  <p className={`text-[11px] ${FC.mut}`}>
                    {meta.so_deste_numero ? "Só deste número." : "A Meta não separou por número: é a conta inteira."} {meta.aviso}
                  </p>
                </div>
              )}
            </SubCard>
            <p className={`px-6 pb-5 -mt-2 text-[11px] leading-snug ${FC.mut}`}>
              Tabela de preço usada na estimativa: Meta, mercado Brasil em R$, vigente desde {dataBr(data.tarifa.vigencia)}, conferida em{" "}
              {dataBr(data.tarifa.conferido_em)}. {data.tarifa.observacao}{" "}
              <a href={data.tarifa.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#003083] dark:text-[#5b9bff] hover:underline">
                Fonte <ArrowUpRight className="w-3 h-3" />
              </a>
            </p>
          </Row>
        </>
      ) : null}
    </>
  );
}

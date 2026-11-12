// Disparos (11/11/2026) — um modelo aprovado, pelo número oficial, para uma lista de contatos.
// Até aqui o disparo pela API oficial só existia no ERP; esta é a lista dos feitos pelo Agent.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, Plus, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { Button, EmptyHint, FC, PageFrame, PageHero, Row, SkeletonBar, iconBtn } from "@/components/ds/fc";
import { BarraDoDisparo, Pilula } from "@/components/disparos/PartesDoDisparo";
import { type Disparo, inteiro, mensagemDeErro, quando, statusDoDisparo } from "@/lib/disparos";

export default function DisparosPage() {
  const nav = useNavigate();
  const [disparos, setDisparos] = useState<Disparo[] | null>(null);
  const [podeCriar, setPodeCriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const { data } = await api.get<{ disparos: Disparo[]; pode_criar: boolean }>("/disparos-oficiais");
      setDisparos(data.disparos);
      setPodeCriar(data.pode_criar);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui carregar os disparos"));
      setDisparos((d) => d ?? []);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  // Enquanto algum disparo anda, a lista se atualiza sozinha (a cada 5 s).
  const andando = !!disparos?.some((d) => d.status === "em_andamento");
  useEffect(() => {
    if (!andando) return;
    const t = window.setInterval(() => void carregar(), 5000);
    return () => window.clearInterval(t);
  }, [andando]);

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero
          title="Disparos"
          subtitle="Um modelo aprovado, pelo número oficial, para uma lista de contatos. Cada envio entra na conversa do contato — quem responder é atendido pela IA do número ou pela equipe."
          right={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void carregar()} className={iconBtn} title="Atualizar">
                <RefreshCw className="w-4 h-4" />
              </button>
              {podeCriar && (
                <Button onClick={() => nav("/admin/disparos/novo")}>
                  <Plus className="w-3.5 h-3.5" /> Novo disparo
                </Button>
              )}
            </div>
          }
        />
        <Row last>
          {erro && <p className="px-6 pt-4 text-[12.5px] text-red-700 dark:text-red-400">{erro}</p>}
          {disparos === null ? (
            <div className="px-6 py-8 space-y-3">
              <SkeletonBar className="h-4 w-72" />
              <SkeletonBar className="h-4 w-96" />
              <SkeletonBar className="h-4 w-64" />
            </div>
          ) : disparos.length === 0 ? (
            <EmptyHint
              icon={Megaphone}
              text={
                podeCriar
                  ? "Nenhum disparo ainda. Escolha o número oficial, um modelo aprovado e cole a lista de contatos."
                  : "Nenhum disparo pelos seus números. Quem cria disparos é o dono da conta ou um administrador."
              }
              ctaLabel={podeCriar ? "Novo disparo" : undefined}
              ctaTo={podeCriar ? "/admin/disparos/novo" : undefined}
              className="py-14"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className={`border-b ${FC.hair} text-[12px] ${FC.sub}`}>
                    <th className="px-6 py-3 font-medium">Disparo</th>
                    <th className="px-3 py-3 font-medium">Situação</th>
                    <th className="px-3 py-3 font-medium min-w-[180px]">Andamento</th>
                    <th className="px-3 py-3 font-medium text-right">Entregues</th>
                    <th className="px-3 py-3 font-medium text-right">Lidos</th>
                    <th className="px-3 py-3 font-medium text-right" title="Mandaram mensagem na conversa depois do envio">
                      Responderam
                    </th>
                    <th className="px-3 py-3 font-medium text-right">Falhas</th>
                    <th className="px-3 py-3 font-medium text-right" title="Pediram para não receber + sem nome na lista">
                      Fora
                    </th>
                    <th className="px-6 py-3 font-medium text-right">Criado</th>
                  </tr>
                </thead>
                <tbody>
                  {disparos.map((d) => {
                    const st = statusDoDisparo(d);
                    const c = d.contagens;
                    const feitos = d.total - c.pendentes;
                    return (
                      <tr
                        key={d.id}
                        onClick={() => nav(`/admin/disparos/${d.id}`)}
                        className={`cursor-pointer border-b ${FC.hair} last:border-b-0 ${FC.hover} align-top`}
                      >
                        <td className="px-6 py-3.5 max-w-[340px]">
                          <p className={`truncate text-[13px] font-medium ${FC.ink}`}>{d.nome}</p>
                          <p className={`mt-0.5 truncate text-[11.5px] ${FC.mut}`}>
                            <span className="font-mono">{d.modelo}</span> · {formatPhone(d.telefone)}
                            {d.agente ? ` · ${d.agente}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          <Pilula texto={st.texto} tom={st.tom} />
                          {d.status === "pausado" && d.motivo_pausa && (
                            <p className="mt-1 max-w-[220px] text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                              {d.motivo_pausa}
                            </p>
                          )}
                          {d.comeca_em && <p className={`mt-1 text-[11px] ${FC.mut}`}>começa {quando(d.comeca_em)}</p>}
                        </td>
                        <td className="px-3 py-3.5">
                          <BarraDoDisparo contagens={c} total={d.total} />
                          <p className={`mt-1 text-[11px] tabular-nums ${FC.mut}`}>
                            {inteiro(feitos)} de {inteiro(d.total)}
                          </p>
                        </td>
                        <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${FC.ink}`}>{inteiro(c.entregues)}</td>
                        <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${FC.ink}`}>{inteiro(c.lidos)}</td>
                        <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${FC.ink}`}>
                          {inteiro(c.respondidos ?? 0)}
                        </td>
                        <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${c.falhas ? "text-red-700 dark:text-red-400" : FC.ink}`}>
                          {inteiro(c.falhas)}
                        </td>
                        <td className={`px-3 py-3.5 text-right text-[13px] tabular-nums ${FC.ink}`}>
                          {inteiro(c.descadastrados + c.sem_nome)}
                        </td>
                        <td className={`px-6 py-3.5 text-right text-[12px] tabular-nums ${FC.sub}`}>
                          {quando(d.criado_em)}
                          {d.criado_por && <p className={`text-[11px] ${FC.mut}`}>{d.criado_por}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Row>
      </PageFrame>
    </div>
  );
}

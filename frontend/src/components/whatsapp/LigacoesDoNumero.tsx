import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { FC, Interruptor } from "@/components/ds/fc";

/**
 * «Receber ligações» no número oficial (14/11/2026). Decisão do dono: o número cadastrado já nasce
 * com ligação ligada; esta chave desliga (e liga de novo). O estado vem da META na hora — não de um
 * campo nosso que poderia desatualizar. Se a Meta recusar, o motivo dela aparece aqui.
 */
type Estado = { ligado: boolean; estado: string; motivo?: string | null };

export default function LigacoesDoNumero({ connectorId, gestor }: { connectorId: number; gestor: boolean }) {
  const [est, setEst] = useState<Estado | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .get<Estado>(`/ligacoes/numeros/${connectorId}`)
      .then((r) => vivo && setEst(r.data))
      .catch(() => vivo && setEst({ ligado: false, estado: "desconhecido", motivo: "Não consegui ler na Meta" }));
    return () => {
      vivo = false;
    };
  }, [connectorId]);

  const mudar = async (ligado: boolean) => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await api.put<Estado>(`/ligacoes/numeros/${connectorId}`, { ligado });
      setEst(r.data);
      toast.success(ligado ? "Ligações ligadas neste número" : "Ligações desligadas neste número");
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setErro(typeof d === "string" ? d : "Não consegui mudar");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div>
      <div className={`text-[11px] uppercase tracking-[0.06em] font-semibold mb-2 ${FC.ink}`}>Ligações</div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`text-[13px] ${FC.ink}`}>Receber ligações pelo WhatsApp</div>
          <p className={`text-[12px] leading-snug mt-0.5 ${FC.sub}`}>
            {est === null
              ? "Lendo na Meta…"
              : est.ligado
                ? "Ligado: o botão de ligar aparece para os contatos e a ligação toca no painel. A conversa é gravada, com aviso no começo."
                : "Desligado: os contatos não veem o botão de ligar."}
          </p>
          {(erro || (est && !est.ligado && est.motivo)) && (
            <p className="text-[12px] leading-snug mt-1 text-[#e5484d]">{erro || est?.motivo}</p>
          )}
        </div>
        <Interruptor
          ligado={!!est?.ligado}
          onChange={mudar}
          disabled={!gestor || est === null || salvando}
          label="Receber ligações pelo WhatsApp"
          title={gestor ? undefined : "Só quem administra a conta muda isso"}
        />
      </div>
    </div>
  );
}

/**
 * Nova conversa (21/10/2026, pedido do dono) — o WhatsApp do contato no CRM abre o
 * Atendimento pelo número; se ainda não há conversa, abre ESTA tela com o campo para
 * escrever, como o WhatsApp faz pelo link. A primeira mensagem cria a conversa.
 *
 * Uma conversa por vez, digitada pela pessoa (não é disparo). Só números conectados
 * por QR — na API oficial a Meta só deixa iniciar com modelo aprovado. O servidor
 * decide de quais números a pessoa pode mandar; aqui só aparecem esses.
 */
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, SendHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { FC } from "@/components/ds/fc";

type Numero = {
  id: number;
  kind: string;
  enabled: boolean;
  modo?: string;
  config_summary?: { status?: string; phone?: string } | null;
};

export default function NovaConversa({
  telefone,
  onCriada,
  onCancelar,
}: {
  telefone: string;
  onCriada: (conversaId: number) => void;
  onCancelar: () => void;
}) {
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .get<Numero[]>("/connectors")
      .then(({ data }) => {
        const prontos = (data || []).filter(
          (c) => c.kind === "whatsapp" && c.enabled && c.config_summary?.status === "connected",
        );
        setNumeros(prontos);
        setEscolhido(prontos[0]?.id ?? null);
      })
      .catch(() => setNumeros([]));
  }, []);

  const rotulo = useMemo(() => formatPhone(telefone.replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1")), [telefone]);

  async function enviar() {
    const msg = texto.trim();
    if (!msg || !escolhido || enviando) return;
    setEnviando(true);
    try {
      const { data } = await api.post<{ id: number }>("/conversations/iniciar", {
        telefone,
        connector_id: escolhido,
        content: msg,
      });
      toast.success("Conversa iniciada");
      onCriada(data.id);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Não consegui enviar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`flex items-center justify-between px-5 py-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] shrink-0`}>
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
            +
          </div>
          <div className="min-w-0">
            <p className={`text-[14px] font-medium tabular-nums ${FC.ink}`}>{rotulo}</p>
            <p className={`text-[12px] ${FC.sub}`}>Nova conversa — ainda não falou com a escola por WhatsApp</p>
          </div>
        </div>
        <button type="button" onClick={onCancelar} className={`text-[12px] ${FC.sub} hover:underline`}>
          Cancelar
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className={`text-[13px] ${FC.sub} max-w-[340px]`}>
          Escreva a primeira mensagem. Ela sai pelo número escolhido e a conversa aparece na lista, com o seu nome.
        </p>
      </div>

      <div className={`border-t ${FC.hair} bg-white dark:bg-[#0c0e12] px-4 py-3 shrink-0`}>
        {numeros === null ? (
          <p className={`flex items-center gap-1.5 text-[12px] ${FC.sub}`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Procurando os seus números…
          </p>
        ) : numeros.length === 0 ? (
          <p className="text-[12.5px] text-amber-700 dark:text-amber-400">
            Você não tem número do WhatsApp conectado para começar a conversa. Peça ao administrador para colocar
            você como responsável de um número.
          </p>
        ) : (
          <>
            {numeros.length > 1 && (
              <div className={`mb-2 flex flex-wrap items-center gap-1.5 text-[11.5px] ${FC.sub}`}>
                <span>Enviar pelo</span>
                {numeros.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setEscolhido(n.id)}
                    aria-pressed={escolhido === n.id}
                    className={`h-6 rounded-full border px-2 tabular-nums transition-colors ${
                      escolhido === n.id
                        ? "border-[#003083] text-[#003083] dark:border-[#5b9bff] dark:text-[#5b9bff]"
                        : `${FC.hair} ${FC.hover}`
                    }`}
                  >
                    {formatPhone(n.config_summary?.phone)}
                  </button>
                ))}
              </div>
            )}
            <div className={`flex items-end gap-2 rounded-xl border ${FC.hair} px-2 py-1.5 focus-within:border-[#003083] dark:focus-within:border-[#5b9bff]`}>
              <textarea
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                rows={Math.min(5, Math.max(1, texto.split("\n").length))}
                maxLength={4000}
                placeholder="Escreva a primeira mensagem…"
                className={`flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] leading-[20px] outline-none ${FC.ink}`}
              />
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={!texto.trim() || !escolhido || enviando}
                title="Enviar (Enter)"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003083] text-white disabled:opacity-40 dark:bg-[#5b9bff] dark:text-[#0c0e12]"
              >
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
              </button>
            </div>
            {escolhido && numeros.length === 1 && (
              <p className={`mt-1 text-[10.5px] ${FC.mut}`}>
                Sai pelo {formatPhone(numeros[0].config_summary?.phone)} · Enter envia · Shift+Enter quebra a linha
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

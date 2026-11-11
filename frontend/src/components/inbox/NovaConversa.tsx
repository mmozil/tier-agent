/**
 * Nova conversa (21/10/2026, pedido do dono) — o WhatsApp do contato no CRM abre o
 * Atendimento pelo número; se ainda não há conversa, abre ESTA tela com o campo para
 * escrever, como o WhatsApp faz pelo link. A primeira mensagem cria a conversa.
 *
 * Uma conversa por vez, digitada pela pessoa (não é disparo). O servidor decide de quais
 * números a pessoa pode mandar; aqui só aparecem esses.
 *
 * 11/11/2026 — número OFICIAL (API da Meta) também: lá a Meta só deixa falar primeiro com
 * MODELO APROVADO, então em vez do campo de texto a pessoa escolhe o modelo e preenche as
 * variáveis. Os modelos nascem em Canais › Modelos.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Loader2, SendHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { FC, Input, Select } from "@/components/ds/fc";
import BalaoDoModelo from "@/components/whatsapp/BalaoDoModelo";

type Numero = {
  id: number;
  kind: "whatsapp" | "whatsapp_cloud";
  telefone: string | null | undefined;
  agente?: string;
};
type Modelo = {
  nome: string;
  status: string;
  idioma: string;
  corpo: string;
  rodape: string;
  botoes: string[];
  variaveis: number;
  cabecalho_midia: string | null;
};

function preencher(texto: string, valores: string[]) {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => valores[Number(n) - 1] || m);
}

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
  // 09/11/2026 (M7): o nome do contato no CRM. Sem ele a tela mostrava só o número.
  const [nome, setNome] = useState<string | null>(null);
  // número oficial
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);
  const [valores, setValores] = useState<string[]>([]);

  useEffect(() => {
    api
      .get<{ nome?: string | null }>("/conversations/nome-do-contato", { params: { telefone } })
      .then(({ data }) => setNome((data?.nome || "").trim() || null))
      .catch(() => setNome(null));
  }, [telefone]);

  useEffect(() => {
    Promise.all([
      api.get<any[]>("/connectors").catch(() => ({ data: [] as any[] })),
      api.get<{ numeros: any[] }>("/whatsapp-oficial/numeros").catch(() => ({ data: { numeros: [] as any[] } })),
    ]).then(([qr, oficial]) => {
      const porQr: Numero[] = (qr.data || [])
        .filter((c) => c.kind === "whatsapp" && c.enabled && c.config_summary?.status === "connected")
        .map((c) => ({ id: c.id, kind: "whatsapp", telefone: c.config_summary?.phone }));
      const oficiais: Numero[] = (oficial.data?.numeros || [])
        .filter((n) => n.ativo)
        .map((n) => ({ id: n.id, kind: "whatsapp_cloud", telefone: n.telefone, agente: n.agente }));
      const todos = [...porQr, ...oficiais];
      setNumeros(todos);
      setEscolhido(todos[0]?.id ?? null);
    });
  }, []);

  const atual = numeros?.find((n) => n.id === escolhido) ?? null;
  const oficial = atual?.kind === "whatsapp_cloud";

  useEffect(() => {
    if (!oficial || !escolhido) return;
    setModelos(null);
    setModelo(null);
    api
      .get<{ modelos: Modelo[] }>("/whatsapp-oficial/modelos", { params: { connector_id: escolhido } })
      .then(({ data }) => {
        const ok = data.modelos.filter((m) => m.status === "APPROVED" && !m.cabecalho_midia);
        setModelos(ok);
        setModelo(ok[0] ? `${ok[0].nome}|${ok[0].idioma}` : null);
      })
      .catch(() => setModelos([]));
  }, [oficial, escolhido]);

  const modeloAtual = useMemo(
    () => modelos?.find((m) => `${m.nome}|${m.idioma}` === modelo) ?? null,
    [modelos, modelo],
  );
  useEffect(() => {
    // {{1}} costuma ser o nome: já vem preenchido com o primeiro nome do contato, se houver.
    const n = modeloAtual?.variaveis ?? 0;
    setValores(Array.from({ length: n }, (_, i) => (i === 0 && nome ? nome.split(" ")[0] : "")));
  }, [modeloAtual, nome]);

  const rotulo = useMemo(() => formatPhone(telefone.replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1")), [telefone]);

  async function enviar() {
    if (!escolhido || enviando) return;
    if (oficial) {
      if (!modeloAtual || valores.some((v) => !v.trim())) return;
      setEnviando(true);
      try {
        const { data } = await api.post<{ conversation_id: number }>("/whatsapp-oficial/iniciar-conversa", {
          connector_id: escolhido,
          telefone,
          modelo: modeloAtual.nome,
          idioma: modeloAtual.idioma,
          variaveis: valores,
          nome_contato: nome,
        });
        toast.success("Modelo enviado — a conversa começou");
        onCriada(data.conversation_id);
      } catch (e: any) {
        const d = e?.response?.data?.detail;
        toast.error(typeof d === "string" ? d : "Não consegui enviar");
      } finally {
        setEnviando(false);
      }
      return;
    }
    const msg = texto.trim();
    if (!msg) return;
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

  const btnEnviar =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003083] text-white disabled:opacity-40 dark:bg-[#5b9bff] dark:text-[#0c0e12]";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`flex items-center justify-between px-5 py-3 border-b ${FC.hair} bg-white dark:bg-[#0c0e12] shrink-0`}>
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[13px] font-semibold text-[#003083] dark:text-[#5b9bff] shrink-0">
            {nome ? nome.charAt(0).toUpperCase() : "+"}
          </div>
          <div className="min-w-0">
            <p className={`text-[14px] font-medium truncate ${FC.ink}`}>{nome || <span className="tabular-nums">{rotulo}</span>}</p>
            <p className={`text-[12px] ${FC.sub}`}>
              {nome && <span className="tabular-nums">{rotulo} · </span>}Nova conversa
            </p>
          </div>
        </div>
        <button type="button" onClick={onCancelar} className={`text-[12px] ${FC.sub} hover:underline`}>
          Cancelar
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 text-center overflow-y-auto">
        {oficial && modeloAtual ? (
          <div className="py-6 flex flex-col items-end">
            <BalaoDoModelo corpo={preencher(modeloAtual.corpo, valores)} rodape={modeloAtual.rodape} botoes={modeloAtual.botoes} />
            <p className={`mt-2 text-[11px] ${FC.mut}`}>Assim chega no WhatsApp do contato</p>
          </div>
        ) : (
          <p className={`text-[13px] ${FC.sub} max-w-[360px]`}>
            {oficial
              ? "No WhatsApp oficial a primeira mensagem é um modelo aprovado pela Meta. Quando o contato responder, a conversa segue normal."
              : "Escreva a primeira mensagem. Ela sai pelo número escolhido e a conversa aparece na lista, com o seu nome."}
          </p>
        )}
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
                    className={`h-6 rounded-full border px-2 tabular-nums transition-colors inline-flex items-center gap-1 ${
                      escolhido === n.id
                        ? "border-[#003083] text-[#003083] dark:border-[#5b9bff] dark:text-[#5b9bff]"
                        : `${FC.hair} ${FC.hover}`
                    }`}
                  >
                    {formatPhone(n.telefone)}
                    {n.kind === "whatsapp_cloud" && <span className="text-[9px] font-semibold uppercase tracking-wide">oficial</span>}
                  </button>
                ))}
              </div>
            )}

            {oficial ? (
              modelos === null ? (
                <p className={`flex items-center gap-1.5 text-[12px] ${FC.sub}`}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando os modelos aprovados…
                </p>
              ) : modelos.length === 0 ? (
                <p className="text-[12.5px] text-amber-700 dark:text-amber-400">
                  Este número ainda não tem modelo aprovado pela Meta.{" "}
                  <Link to={`/admin/canais/modelos?numero=${escolhido}`} className="underline">
                    Criar um modelo
                  </Link>
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11.5px] shrink-0 ${FC.sub}`}>Modelo</span>
                    <Select
                      value={modelo}
                      onChange={setModelo}
                      className="flex-1"
                      options={modelos.map((m) => ({ value: `${m.nome}|${m.idioma}`, label: m.nome }))}
                    />
                  </div>
                  {valores.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`w-12 shrink-0 font-mono text-[11.5px] ${FC.mut}`}>{`{{${i + 1}}}`}</span>
                      <Input
                        value={v}
                        onChange={(e) => setValores((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder={i === 0 ? "Nome do contato" : "Texto"}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[10.5px] ${FC.mut}`}>
                      Sai pelo {formatPhone(atual?.telefone)} · a IA do agente {atual?.agente} segue a conversa quando o contato responder
                    </p>
                    <button
                      type="button"
                      onClick={() => void enviar()}
                      disabled={!modeloAtual || valores.some((x) => !x.trim()) || enviando}
                      title="Enviar o modelo"
                      className={btnEnviar}
                    >
                      {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <>
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
                    className={btnEnviar}
                  >
                    {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
                  </button>
                </div>
                {escolhido && numeros.length === 1 && (
                  <p className={`mt-1 text-[10.5px] ${FC.mut}`}>
                    Sai pelo {formatPhone(numeros[0].telefone)} · Enter envia · Shift+Enter quebra a linha
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

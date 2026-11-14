import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { ChevronDown, Download, Upload } from "lucide-react";

import { FC } from "@/components/ds/fc";
import { api } from "@/lib/api";
import { mensagemDeErro } from "@/lib/disparos";

// Lista do disparo por arquivo + o formato à vista (14/11/2026). Pedido do dono: «como tem que
// mandar? primeiro nome depois telefone, tem vírgula ou não? … importar xls e csv … e um para
// baixar com um padrão». O arquivo é lido no SERVIDOR e volta como texto para a mesma caixa —
// passa pela mesma leitura da lista colada (uma regra só).

type Importado = { texto: string; linhas: number; cortado: boolean; arquivo: string; colunas: { nome: string | null; telefone: string | null } };

const link = "inline-flex items-center gap-1 text-[12px] text-[#003083] dark:text-[#5b9bff] hover:underline disabled:opacity-50";

export default function ListaPorArquivo({ onTexto }: { onTexto: (texto: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  async function importar(arquivo: File) {
    setLendo(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      const { data } = await api.post<Importado>("/disparos-oficiais/importar-lista", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      onTexto(data.texto);
      const cols =
        data.colunas.nome || data.colunas.telefone
          ? ` — colunas usadas: ${[data.colunas.nome, data.colunas.telefone].filter(Boolean).join(" e ")}`
          : "";
      toast.success(`${data.linhas} linha(s) de ${data.arquivo}${cols}`);
      if (data.cortado) toast("O arquivo tinha mais linhas do que cabe num disparo; veio só o começo.");
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui ler o arquivo"));
    } finally {
      setLendo(false);
      if (input.current) input.current.value = "";
    }
  }

  async function baixar(formato: "xlsx" | "csv") {
    try {
      const { data } = await api.get<Blob>("/disparos-oficiais/modelo-lista", { params: { formato }, responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelo-lista-disparo.${formato}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui baixar o modelo"));
    }
  }

  return (
    <div className="mb-2 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importar(f);
          }}
        />
        <button type="button" className={link} disabled={lendo} onClick={() => input.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> {lendo ? "Lendo o arquivo…" : "Importar planilha (.xlsx, .xls, .csv)"}
        </button>
        <span className={`inline-flex items-center gap-2 text-[12px] ${FC.mut}`}>
          <Download className="w-3.5 h-3.5" /> Baixar modelo:
          <button type="button" className={link} onClick={() => void baixar("xlsx")}>Excel</button>
          <button type="button" className={link} onClick={() => void baixar("csv")}>CSV</button>
        </span>
        <button type="button" className={`${link} ml-auto`} onClick={() => setAjuda((v) => !v)} aria-expanded={ajuda}>
          Como montar a lista <ChevronDown className={`w-3.5 h-3.5 transition-transform ${ajuda ? "rotate-180" : ""}`} />
        </button>
      </div>
      {ajuda && (
        <div className={`rounded-[10px] border px-3.5 py-3 ${FC.hair} ${FC.base}`}>
          <ul className={`space-y-1 text-[12px] leading-5 ${FC.sub}`}>
            <li>· <b className={FC.ink}>Uma linha por contato</b>, com <b className={FC.ink}>nome e telefone</b> — a ordem não importa.</li>
            <li>· Telefone <b className={FC.ink}>com DDD</b>: «11 98765-4321», «(11) 98765-4321» ou «5511987654321», tanto faz.</li>
            <li>· Colando da planilha, as colunas já vêm separadas. Digitando, separe por vírgula, ponto e vírgula ou espaço.</li>
            <li>· Na planilha, deixe a 1ª linha com os títulos «nome» e «telefone»: com eles, o sistema pega as colunas certas mesmo com outras no meio (cidade, e-mail…).</li>
            <li>· Sem nome também vale, mas quem está sem nome não recebe modelo que usa o nome.</li>
            <li>· Número repetido sai uma vez; quem pediu para parar sai sozinho.</li>
          </ul>
          <table className={`mt-2.5 text-[12px] font-mono ${FC.sub}`}>
            <thead>
              <tr className={FC.ink}>
                <th className="pr-6 text-left font-medium">nome</th>
                <th className="text-left font-medium">telefone</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="pr-6">Maria Silva</td><td>11 98765-4321</td></tr>
              <tr><td className="pr-6">João Pereira</td><td>(21) 99999-8888</td></tr>
              <tr><td className="pr-6">Ana Souza</td><td>5511912345678</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

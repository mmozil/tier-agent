/**
 * Motivo legível de um erro de chamada à API (14/11/2026).
 *
 * Antes cada tela fazia `typeof detail === "string" ? detail : "Não consegui enviar"` — e todo erro que
 * não vinha como texto (validação do servidor, rede caída, 413, sessão vencida) virava a mesma frase
 * sem motivo. O dono pediu o motivo real.
 */
const TRADUCAO: Record<string, string> = {
  "Field required": "obrigatório",
  "field required": "obrigatório",
  "Input should be a valid string": "precisa ser texto",
  "Input should be a valid integer": "precisa ser número",
};

export function motivoDoErro(e: any, padrao = "Não deu certo"): string {
  const r = e?.response;
  if (!r) {
    if (e?.code === "ECONNABORTED") return `${padrao}: o servidor demorou demais para responder. Tente de novo.`;
    return `${padrao}: sem resposta do servidor (confira a internet e tente de novo).`;
  }
  const d = r.data?.detail;
  if (typeof d === "string" && d.trim()) return d;
  if (Array.isArray(d) && d.length) {
    const partes = d
      .map((x: any) => {
        const campo = Array.isArray(x?.loc) ? x.loc.filter((p: unknown) => p !== "body").join(".") : "";
        const msg = TRADUCAO[x?.msg] || x?.msg || "inválido";
        return campo ? `${campo}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (partes.length) return `${padrao}: ${partes.join(" · ")}`;
  }
  if (d && typeof d === "object") return `${padrao}: ${d.mensagem || d.message || JSON.stringify(d).slice(0, 200)}`;
  if (r.status === 401) return "Sua sessão expirou — entre de novo.";
  if (r.status === 403) return `${padrao}: sem permissão para isso.`;
  if (r.status === 413) return `${padrao}: arquivo grande demais.`;
  if (r.status === 429) return `${padrao}: muitas tentativas seguidas — espere um pouco.`;
  return `${padrao} (erro ${r.status}${r.status >= 500 ? " no servidor" : ""}).`;
}

// Disparos dentro do CRM (16/11/2026). O «Atendimento › Disparos» do CRM abre a lista de disparos
// do Agent num iframe, em modo CONSULTA: quantidade, lista, contato a contato e o motivo de cada
// falha — sem criar, iniciar, agendar, pausar, retomar, cancelar nem apagar.
//
// 🚨 O modo mora no ENDEREÇO (`?embed=1&consulta=1`). Navegar da lista para o detalhe sem repassar
// os parâmetros fazia o detalhe abrir com a casca inteira do Agent (menu lateral e topo) dentro do
// CRM — por isso toda navegação destas telas leva o `sufixo`.
// 🚨 Consulta é da TELA, não da permissão: quem pode criar disparo continua podendo no Agent; quem
// não pode já é barrado pelo servidor (`exigir_gestor`).
import { useLocation } from "react-router-dom";

const MANTER = ["embed", "consulta", "bg"] as const;

export function modoEmbutido(search: string) {
  const p = new URLSearchParams(search);
  const manter = new URLSearchParams();
  for (const k of MANTER) {
    const v = p.get(k);
    if (v) manter.set(k, v);
  }
  const s = manter.toString();
  return {
    embed: p.get("embed") === "1",
    consulta: p.get("consulta") === "1",
    /** `?embed=1&consulta=1` (ou vazio) — para acrescentar a um caminho sem query. */
    sufixo: s ? `?${s}` : "",
  };
}

export function useModoEmbutido() {
  return modoEmbutido(useLocation().search);
}

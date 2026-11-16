// Disparos dentro do CRM (16/11/2026). O «Atendimento › Disparos» do CRM abre a lista de disparos
// do Agent num iframe, em modo CONSULTA: quantidade, lista, contato a contato e o motivo de cada
// falha — sem criar, iniciar, agendar, pausar, retomar, cancelar nem apagar.
//
// 🚨 O modo mora no ENDEREÇO (`?embed=1&consulta=1`). Navegar da lista para o detalhe sem repassar
// os parâmetros fazia o detalhe abrir com a casca inteira do Agent (menu lateral e topo) dentro do
// CRM — por isso toda navegação destas telas leva o `sufixo`.
// 🚨 Consulta é da TELA, não da permissão: quem pode criar disparo continua podendo no Agent; quem
// não pode já é barrado pelo servidor (`exigir_gestor`).
import { useEffect } from "react";
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

/** A página que embute este quadro — só se for da Tier (o CRM). Fora disso, ninguém é avisado. */
export function origemDoPai(referrer: string): string | null {
  try {
    const o = new URL(referrer).origin;
    if (/^https:\/\/([a-z0-9-]+\.)*tier\.finance$/.test(o)) return o;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  } catch {
    /* sem referrer legível: não avisa */
  }
  return null;
}

/** 16/11/2026 (CCDA) — embutido no CRM, avisa a página de fora em que ponto dos Disparos a
 * pessoa está (disparo, filtro e página). O CRM guarda e, quando recria o quadro — trocou de aba
 * e voltou —, reabre no MESMO ponto, em vez da lista do começo. Só caminho e filtro: nada digitado. */
export function useAvisarRota() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (window.parent === window) return;
    const alvo = origemDoPai(document.referrer);
    if (!alvo) return;
    window.parent.postMessage({ tipo: "tier-agent:rota", rota: pathname + search }, alvo);
  }, [pathname, search]);
}

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * O painel se atualiza sozinho quando sai versão nova (14/11/2026).
 *
 * Por quê: a aba aberta antes de uma publicação continua rodando o código velho até alguém
 * recarregar. Na ligação pelo WhatsApp isso fez o dono atender DUAS vezes sem gravação — e não dá
 * para pedir a cada cliente «aperte Ctrl+Shift+R».
 *
 * Como: a página (`/`) sai sem cache (nginx `no-store`), então ela sempre diz qual é o pacote
 * `index-<hash>.js` da versão no ar. A cada minuto (e ao voltar para a aba) comparamos com o pacote
 * desta aba. Diferente → há versão nova, e a aba recarrega no PRIMEIRO momento seguro:
 *   - nunca com ligação tocando ou em andamento;
 *   - nunca com texto digitado e não enviado (rascunho de mensagem, campo de formulário);
 *   - e então: aba em segundo plano, OU troca de tela, OU 45 s sem mexer na tela.
 * Pacote de tela que sumiu na publicação (`vite:preloadError`) também recarrega — com trava para
 * não entrar em laço.
 */

const INTERVALO_MS = 60_000;
const OCIOSO_MS = 45_000;

function pacoteDestaAba(): string | null {
  const s = Array.from(document.scripts)
    .map((x) => x.src)
    .find((x) => /\/assets\/index-[^/]+\.js/.test(x));
  return s ? s.split("/").pop() || null : null;
}

async function pacoteNoAr(): Promise<string | null> {
  try {
    const r = await fetch(`/?versao=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const m = (await r.text()).match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Há algo que a recarga perderia? Só três coisas contam (campo PREENCHIDO à toa não conta — o
 * painel do contato vive cheio de campos com o dado salvo, e travaria a tela de Conversas para sempre):
 *   1. ligação tocando ou em andamento;
 *   2. o campo em que a pessoa ESTÁ (foco) com texto — ela está escrevendo;
 *   3. rascunho marcado com `data-rascunho` (a caixa de mensagem) com texto;
 *   4. janela aberta (formulário a meio caminho). */
function temAlgoEmAndamento(): boolean {
  if ((window as any).__tierLigacaoAtiva) return true;
  const ativo = document.activeElement as HTMLElement | null;
  if (ativo && ativo !== document.body) {
    const tag = ativo.tagName;
    const editavel =
      ativo.isContentEditable ||
      tag === "TEXTAREA" ||
      (tag === "INPUT" && /^(text|search|email|tel|url|number|)$/.test((ativo as HTMLInputElement).type || ""));
    if (editavel) {
      const v = ativo.isContentEditable ? ativo.innerText : (ativo as HTMLInputElement).value;
      if ((v || "").trim()) return true;
    }
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-rascunho]"))) {
    const v = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.innerText;
    if ((v || "").trim()) return true;
  }
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
  return false;
}

export default function AtualizacaoAutomatica() {
  const location = useLocation();
  const atual = useRef<string | null>(pacoteDestaAba());
  const pendente = useRef(false);
  const ultimaAtividade = useRef(Date.now());
  const primeiraRota = useRef(true);

  const recarregarSePuder = (motivo: string) => {
    if (!pendente.current || temAlgoEmAndamento()) return;
    try {
      sessionStorage.setItem("tier_atualizou_em", String(Date.now()));
      sessionStorage.setItem("tier_atualizou_motivo", motivo);
    } catch {
      /* armazenamento bloqueado: recarrega assim mesmo */
    }
    window.location.reload();
  };

  // Atividade: mexeu na tela, adia a recarga «por ociosidade».
  useEffect(() => {
    const marcar = () => {
      ultimaAtividade.current = Date.now();
    };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, marcar));
  }, []);

  // Verificação periódica + ao voltar para a aba.
  useEffect(() => {
    if (!atual.current) return; // ambiente de desenvolvimento (Vite serve /src/main.tsx)
    let vivo = true;
    const verificar = async () => {
      if (pendente.current) return;
      const noAr = await pacoteNoAr();
      if (vivo && noAr && atual.current && noAr !== atual.current) pendente.current = true;
    };
    const tique = async () => {
      await verificar();
      if (!pendente.current) return;
      if (document.visibilityState === "hidden") recarregarSePuder("aba em segundo plano");
      else if (Date.now() - ultimaAtividade.current >= OCIOSO_MS) recarregarSePuder("tela parada");
    };
    const aoVoltar = () => {
      if (document.visibilityState === "visible") verificar();
      else tique();
    };
    tique();
    const t = setInterval(tique, INTERVALO_MS);
    // Checagem curta do «ocioso» quando já há versão pendente (não espera o minuto cheio).
    const t2 = setInterval(() => {
      if (pendente.current && Date.now() - ultimaAtividade.current >= OCIOSO_MS) recarregarSePuder("tela parada");
    }, 10_000);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", verificar);
    return () => {
      vivo = false;
      clearInterval(t);
      clearInterval(t2);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", verificar);
    };
  }, []);

  // Troca de tela: momento natural para pegar a versão nova.
  useEffect(() => {
    if (primeiraRota.current) {
      primeiraRota.current = false;
      return;
    }
    recarregarSePuder("troca de tela");
  }, [location.pathname]);

  // Pacote de tela antigo sumiu depois da publicação: recarrega (no máximo 1 vez a cada 30 s).
  useEffect(() => {
    const aoFalhar = (ev: Event) => {
      let ultima = 0;
      try {
        ultima = Number(sessionStorage.getItem("tier_preload_reload") || 0);
      } catch {
        ultima = 0;
      }
      if (Date.now() - ultima < 30_000) return; // evita laço se a falha for outra
      ev.preventDefault();
      try {
        sessionStorage.setItem("tier_preload_reload", String(Date.now()));
      } catch {
        /* segue */
      }
      if (!(window as any).__tierLigacaoAtiva) window.location.reload();
    };
    window.addEventListener("vite:preloadError", aoFalhar);
    return () => window.removeEventListener("vite:preloadError", aoFalhar);
  }, []);

  return null;
}

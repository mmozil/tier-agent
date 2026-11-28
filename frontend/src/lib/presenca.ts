/**
 * Quem está online — pessoa e número (27/11/2026, pedido do dono). Regra no servidor:
 * `backend/services/presenca.py`.
 *
 * Pessoa ONLINE = está com o Agent aberto agora OU respondeu um contato nos últimos 10 min
 * (pelo painel ou pelo celular do número dela). O `online` de `/team/members` é OUTRA coisa:
 * o botão manual do rodízio — não usar para mostrar presença.
 */
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";

export type PresencaPessoa = {
  member_id: number;
  online: boolean;
  por: "painel" | "resposta" | null;
  /** Há quantos segundos foi o sinal mais recente (no relógio do servidor, na hora da leitura). */
  visto_s: number | null;
  painel_em: string | null;
  respondeu_em: string | null;
};

export type PresencaNumero = {
  connector_id: number;
  ligado: boolean;
  status: string | null;
  ultima_msg_em: string | null;
};

export type Presenca = { pessoas: PresencaPessoa[]; numeros: PresencaNumero[] };

const TZ = { timeZone: "America/Sao_Paulo" } as const;

function comoData(iso: string): Date | null {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** «hoje às 14:03» · «ontem às 18:40» · «25/11 às 09:12» (horário de Brasília). */
export function quandoFoi(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = comoData(iso);
  if (!d) return null;
  const dia = (x: Date) => x.toLocaleDateString("en-CA", TZ);
  const hora = d.toLocaleTimeString("pt-BR", { ...TZ, hour: "2-digit", minute: "2-digit" });
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (dia(d) === dia(hoje)) return `hoje às ${hora}`;
  if (dia(d) === dia(ontem)) return `ontem às ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { ...TZ, day: "2-digit", month: "2-digit" })} às ${hora}`;
}

/** «há 3 min» · «há 2 h» — só até 24 h; depois disso a data diz mais. */
function haQuanto(seg: number): string {
  if (seg < 60) return "agora há pouco";
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  return `há ${Math.floor(seg / 3600)} h`;
}

/** Uma linha para o cartão: o estado e de onde vem o sinal. */
export function textoPresenca(p: PresencaPessoa | null | undefined): string {
  if (!p) return "Sem informação";
  if (p.online && p.por === "painel") return "Online agora · com o Agent aberto";
  if (p.online) return `Online · respondeu ${haQuanto(p.visto_s ?? 0)}`;
  if (p.visto_s == null) return "Offline · sem atividade em 7 dias";
  if (p.visto_s < 86400) return `Offline · visto ${haQuanto(p.visto_s)}`;
  const iso = [p.painel_em, p.respondeu_em].filter(Boolean).sort().pop() || null;
  const quando = quandoFoi(iso);
  if (!quando) return "Offline";
  return /^\d/.test(quando) ? `Offline · visto em ${quando}` : `Offline · visto ${quando}`;
}

/** Tela visível e a pessoa mexeu nos últimos 10 min — tela aberta esquecida não conta. */
const OCIOSO_MS = 10 * 60 * 1000;
const PING_MS = 60 * 1000;

/** Sinal «estou com o Agent aberto» — montado uma vez, no layout (vale também no embed). */
export function usePresencaPing(): void {
  useEffect(() => {
    let ultimoGesto = Date.now();
    let parado = false; // o dono (sem pessoa da equipe) não manda sinal
    const gesto = () => {
      ultimoGesto = Date.now();
    };
    const enviar = () => {
      if (parado || document.visibilityState !== "visible") return;
      if (Date.now() - ultimoGesto > OCIOSO_MS) return;
      api
        .post<{ ok: boolean; owner?: boolean }>("/team/presenca")
        .then(({ data }) => {
          if (data?.owner) parado = true;
        })
        .catch(() => {
          /* presença nunca atrapalha a tela */
        });
    };
    const aoVoltar = () => {
      if (document.visibilityState === "visible") {
        gesto();
        enviar();
      }
    };
    const eventos = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, gesto, { passive: true }));
    document.addEventListener("visibilitychange", aoVoltar);
    enviar();
    const id = window.setInterval(enviar, PING_MS);
    return () => {
      window.clearInterval(id);
      eventos.forEach((e) => window.removeEventListener(e, gesto));
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);
}

/** Lê quem está online e o estado dos números a cada minuto, com a tela visível. */
export function usePresenca(): Presenca | null {
  const [dados, setDados] = useState<Presenca | null>(null);
  const emCurso = useRef(false);
  useEffect(() => {
    let vivo = true;
    const ler = () => {
      if (emCurso.current || document.visibilityState !== "visible") return;
      emCurso.current = true;
      api
        .get<Presenca>("/team/presenca")
        .then(({ data }) => {
          if (vivo && data) setDados(data);
        })
        .catch(() => {
          /* sem presença: a lateral segue como antes */
        })
        .finally(() => {
          emCurso.current = false;
        });
    };
    const aoVoltar = () => {
      if (document.visibilityState === "visible") ler();
    };
    ler();
    const id = window.setInterval(ler, PING_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);
  return dados;
}

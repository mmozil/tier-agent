import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

/* ─────────────────────────────────────────────────────────────
   Embedded Signup (WhatsApp Cloud API oficial) — botão "login Facebook".
   O cliente clica → loga no Facebook → escolhe/cria o número → autoriza.
   A Meta devolve um `code` (via FB.login) + waba_id/phone_number_id (via
   postMessage do popup). Mandamos pro backend /connectors/whatsapp-cloud/onboard
   que troca o code por token permanente e cria o conector.

   Requer: VITE_FB_APP_ID + VITE_WHATSAPP_CONFIG_ID + App Review aprovado
   (Advanced Access) pra clientes externos. Em dev mode funciona p/ admins.
   ──────────────────────────────────────────────────────────── */

const FB_APP_ID = import.meta.env.VITE_FB_APP_ID || "1042084538480511";
const CONFIG_ID = import.meta.env.VITE_WHATSAPP_CONFIG_ID || "";
const GRAPH_VERSION = "v21.0";

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

function loadFbSdk(): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) return resolve();
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: FB_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: GRAPH_VERSION,
      });
      resolve();
    };
    if (document.getElementById("facebook-jssdk")) return;
    const js = document.createElement("script");
    js.id = "facebook-jssdk";
    js.src = "https://connect.facebook.net/en_US/sdk.js";
    js.async = true;
    js.defer = true;
    document.body.appendChild(js);
  });
}

/* 🚨 O ouvinte do postMessage vive no MÓDULO, não no componente (11/11/2026).
   Os dois gatilhos da tela de Canais fecham o painel no mesmo clique que abre a
   janela da Meta (`setShowPicker(false); connect()`): o componente desmontava, o
   `useEffect` tirava o ouvinte, e o waba_id/phone_number_id que a Meta manda no
   fim chegava sem ninguém escutando. O cadastro ia até o fim na Meta e nunca
   chegava ao /onboard — «cadastrou até o final, depois sumiu». */
let ultimaSessao: { waba_id?: string; phone_number_id?: string; evento?: string } = {};
let ouvinteInstalado = false;

function instalarOuvinte() {
  if (ouvinteInstalado) return;
  ouvinteInstalado = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data?.type === "WA_EMBEDDED_SIGNUP") {
        ultimaSessao = {
          ...ultimaSessao,
          evento: data.event,
          ...(data.data?.waba_id ? { waba_id: data.data.waba_id } : {}),
          ...(data.data?.phone_number_id ? { phone_number_id: data.data.phone_number_id } : {}),
        };
      }
    } catch {
      // ignora mensagens não-JSON
    }
  });
}

// A mensagem da Meta pode chegar DEPOIS do retorno do FB.login: espera um pouco.
async function esperarSessao(ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (ultimaSessao.waba_id && ultimaSessao.phone_number_id) return ultimaSessao;
    await new Promise((r) => setTimeout(r, 200));
  }
  return ultimaSessao;
}

export default function ConnectWhatsAppCloud({
  agentId,
  onConnected,
  render,
}: {
  agentId: number;
  onConnected?: () => void;
  // Opcional: renderiza um gatilho próprio (ex: card do seletor de canais) em vez
  // do botão padrão. Recebe {connect, loading} pra disparar o Embedded Signup.
  render?: (p: { connect: () => void; loading: boolean }) => ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadFbSdk();
    instalarOuvinte();
  }, []);

  function connect() {
    if (!CONFIG_ID) {
      toast.error("Embedded Signup ainda não configurado (falta Config ID).");
      return;
    }
    if (!window.FB) {
      toast.error("SDK do Facebook ainda carregando, tente de novo.");
      return;
    }
    setLoading(true);
    instalarOuvinte();
    ultimaSessao = {};
    // FB SDK NÃO aceita callback async — usamos função normal + IIFE async dentro.
    window.FB.login(
      (response: any) => {
        void (async () => {
          try {
            const code = response?.authResponse?.code;
            if (!code) {
              toast.error("Conexão cancelada ou incompleta.");
              return;
            }
            const { waba_id, phone_number_id } = await esperarSessao();
            if (!waba_id || !phone_number_id) {
              toast.error("A Meta concluiu sem informar o número. Abra de novo e escolha o número no fim.");
              return;
            }
            await api.post("/connectors/whatsapp-cloud/onboard", {
              agent_id: agentId,
              code,
              waba_id,
              phone_number_id,
            });
            toast.success("WhatsApp Oficial conectado!");
            onConnected?.();
          } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Falha ao conectar");
          } finally {
            setLoading(false);
          }
        })();
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  if (render) return <>{render({ connect, loading })}</>;

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="h-8 px-3 bg-[#1877F2] hover:bg-[#1568d8] text-white text-[12px] font-medium rounded-[10px] inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
      title="Conectar WhatsApp pela API oficial (Meta) — sem QR, sem ban"
    >
      {loading ? "Conectando…" : "Conectar WhatsApp Oficial"}
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
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

export default function ConnectWhatsAppCloud({
  agentId,
  onConnected,
}: {
  agentId: number;
  onConnected?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  // captura waba_id + phone_number_id do postMessage do Embedded Signup
  const sessionInfo = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  useEffect(() => {
    loadFbSdk();
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      )
        return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data) {
          sessionInfo.current = {
            waba_id: data.data.waba_id,
            phone_number_id: data.data.phone_number_id,
          };
        }
      } catch {
        // ignora mensagens não-JSON
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
    // FB SDK NÃO aceita callback async — usamos função normal + IIFE async dentro.
    window.FB.login(
      (response: any) => {
        void (async () => {
          try {
            const code = response?.authResponse?.code;
            const { waba_id, phone_number_id } = sessionInfo.current;
            if (!code || !waba_id || !phone_number_id) {
              toast.error("Conexão cancelada ou incompleta.");
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

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="h-6 px-2 bg-[#1877F2] hover:bg-[#1568d8] text-white text-[12px] rounded-md inline-flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
      title="Conectar WhatsApp pela API oficial (Meta) — sem QR, sem ban"
    >
      {loading ? "Conectando…" : "Conectar WhatsApp Oficial"}
    </button>
  );
}

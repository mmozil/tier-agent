import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";

// Callback do fluxo OAuth das Integrações (MCP). O popup volta da tela de
// autorização da fonte com ?code&state — troca pelo token no backend, avisa a
// janela que abriu (postMessage) e se fecha. Usuário não interage com esta tela.

interface ToolProvider {
  id: number;
  agent_id: number;
  nome: string;
}

export default function McpOAuthCallback() {
  const [msg, setMsg] = useState("Conectando…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    function notify(payload: Record<string, unknown>) {
      try {
        window.opener?.postMessage({ type: "mcp-oauth", ...payload }, window.location.origin);
      } catch {
        /* opener fechado — segue */
      }
    }

    async function run() {
      if (error) {
        setMsg(error === "access_denied" ? "Acesso negado — você pode fechar esta janela." : `Erro: ${error}`);
        notify({ ok: false, error });
        setTimeout(() => window.close(), 1500);
        return;
      }
      if (!code || !state) {
        setMsg("Parâmetros ausentes — feche e tente conectar novamente.");
        notify({ ok: false, error: "missing_params" });
        return;
      }
      try {
        const { data } = await api.post<ToolProvider>("/tool-providers/oauth/callback", { code, state });
        setMsg(`${data.nome} conectada ✓`);
        notify({ ok: true, provider_id: data.id, agent_id: data.agent_id });
        setTimeout(() => window.close(), 800);
      } catch (e: any) {
        const detail = e?.response?.data?.detail || "falha ao concluir a conexão";
        setMsg(`Erro: ${detail}`);
        notify({ ok: false, error: detail });
      }
    }
    run();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F9F9]">
      <div className="flex items-center gap-3 text-[14px] text-[#262626]/[0.72]">
        <Loader2 className="w-4 h-4 animate-spin" />
        {msg}
      </div>
    </div>
  );
}

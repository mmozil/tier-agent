/**
 * Chat público por link — a página do canal de demonstração.
 *
 * Rota `/c/:slug`, FORA do ProtectedRoute: qualquer pessoa abre, sem login.
 * Fala com `/api/v1/public/chat/:slug` (fetch puro, sem o client autenticado —
 * o interceptor de 401 do `lib/api` não tem nada a ver com esta tela).
 *
 * A identidade do visitante é um id aleatório no localStorage. É ele que vira o
 * "contato" no inbox, então a conversa continua se a pessoa recarregar a página.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import VozPublica from "@/components/VozPublica";

type Config = {
  slug: string;
  agente: string;
  avatar_url: string | null;
  titulo: string;
  subtitulo: string;
  saudacao: string;
  cor: string;
  logo_url: string | null;
  sugestoes: string[];
  pede_contato: boolean;
  rodape: string;
};

type Balao = { de: "visitante" | "agente"; texto: string };

// Mesma resolução do `lib/api.ts`: em produção o front (agent.tier.finance) e o
// backend (api-agent.tier.finance) são hosts diferentes e o nginx do SPA não faz
// proxy de /api — caminho relativo cairia no fallback do index.html.
const BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "https://api-agent.tier.finance/api/v1" : "/api/v1");
const API = `${BASE}/public/chat`;

function idDaSessao(slug: string): string {
  const chave = `tier-chat:${slug}`;
  let id = localStorage.getItem(chave);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 48);
    localStorage.setItem(chave, id);
  }
  return id;
}

export default function ChatPublico() {
  const { slug = "" } = useParams();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baloes, setBaloes] = useState<Balao[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [contato, setContato] = useState({ nome: "", telefone: "" });
  const [contatoOk, setContatoOk] = useState(false);
  // A tela de voz é o padrão do link — `?texto=1` abre direto na conversa, e o
  // "+" da barra alterna. A voz só faz sentido depois que o contato foi pedido.
  const [params] = useSearchParams();
  const [modo, setModo] = useState<"voz" | "conversa">(params.get("texto") ? "conversa" : "voz");
  // Última fala do agente — é o que a tela de voz pronuncia. Leva um `id` porque
  // duas respostas iguais seguidas precisam disparar a fala de novo.
  const [ultimaResposta, setUltimaResposta] = useState<{ texto: string; id: number; audioUrls?: string[] } | null>(null);

  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const sessao = useMemo(() => idDaSessao(slug), [slug]);

  useEffect(() => {
    let vivo = true;
    fetch(`${API}/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Config) => {
        if (!vivo) return;
        setCfg(d);
        setBaloes([{ de: "agente", texto: d.saudacao }]);
        setContatoOk(!d.pede_contato);
        document.title = d.titulo;
      })
      .catch(() => vivo && setErro("Este link não existe ou foi desativado."));
    return () => {
      vivo = false;
    };
  }, [slug]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [baloes, pensando]);

  const enviar = useCallback(
    async (msg?: string) => {
      const conteudo = (msg ?? texto).trim();
      if (!conteudo || pensando) return;

      setTexto("");
      setBaloes((b) => [...b, { de: "visitante", texto: conteudo }]);
      setPensando(true);

      try {
        const r = await fetch(`${API}/${encodeURIComponent(slug)}/mensagem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessao,
            texto: conteudo,
            nome: contato.nome || undefined,
            telefone: contato.telefone || undefined,
            // só na tela de voz: gerar TTS pra quem está lendo seria desperdício
            voz: modo === "voz",
          }),
        });

        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          setBaloes((b) => [
            ...b,
            { de: "agente", texto: d.detail || "Muitas mensagens em pouco tempo. Aguarde um instante." },
          ]);
          return;
        }
        if (!r.ok) throw new Error(String(r.status));

        const d: { baloes: string[]; audio_urls?: string[] } = await r.json();
        setBaloes((b) => [...b, ...(d.baloes || []).map((t) => ({ de: "agente" as const, texto: t }))]);
        const falado = (d.baloes || []).join(" ").trim();
        if (falado) setUltimaResposta({ texto: falado, id: Date.now(), audioUrls: d.audio_urls ?? [] });
      } catch {
        setBaloes((b) => [
          ...b,
          { de: "agente", texto: "Não consegui responder agora. Tenta de novo em instantes." },
        ]);
      } finally {
        setPensando(false);
        campoRef.current?.focus();
      }
    },
    [texto, pensando, slug, sessao, contato, modo],
  );

  if (erro) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f6f7f9] px-6">
        <p className="text-[15px] text-[#6b7280]">{erro}</p>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f6f7f9]">
        <div className="h-6 w-6 rounded-full border-2 border-[#d9e0ea] border-t-[#003083] animate-spin" />
      </div>
    );
  }

  const cor = cfg.cor || "#003083";

  // A tela de voz é o rosto do link. O pedido de contato, quando existe, vem
  // antes — não dá pra registrar o lead pela voz.
  if (modo === "voz" && contatoOk) {
    return (
      <VozPublica
        agente={cfg.agente}
        titulo={cfg.titulo}
        pensando={pensando}
        ultimaResposta={ultimaResposta}
        onEnviar={(t) => enviar(t)}
        onVerConversa={() => setModo("conversa")}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7f9]">
      {/* Cabeçalho */}
      <header className="shrink-0 px-5 py-4 flex items-center gap-3" style={{ background: cor }}>
        {cfg.logo_url || cfg.avatar_url ? (
          <img
            src={cfg.logo_url || cfg.avatar_url || ""}
            alt=""
            className="h-9 w-9 rounded-full object-cover bg-white/20"
          />
        ) : (
          <div className="h-9 w-9 rounded-full bg-white/20 grid place-items-center text-white text-[15px] font-semibold">
            {cfg.agente.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-white text-[15px] font-semibold leading-tight truncate">{cfg.titulo}</p>
          {cfg.subtitulo ? (
            <p className="text-white/75 text-[13px] leading-tight truncate">{cfg.subtitulo}</p>
          ) : null}
        </div>
      </header>

      {/* Conversa */}
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-[680px] flex flex-col gap-2.5">
          {baloes.map((b, i) => (
            <div key={i} className={b.de === "visitante" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[85%] px-3.5 py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap break-words " +
                  (b.de === "visitante"
                    ? "rounded-2xl rounded-br-md text-white"
                    : "rounded-2xl rounded-bl-md bg-white text-[#2D2D2D] ring-1 ring-black/[0.06]")
                }
                style={b.de === "visitante" ? { background: cor } : undefined}
              >
                {b.texto}
              </div>
            </div>
          ))}

          {pensando ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-white ring-1 ring-black/[0.06] px-4 py-3 flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-[#c2c8d0] animate-bounce"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Sugestões: só antes da primeira pergunta */}
          {cfg.sugestoes.length > 0 && baloes.length === 1 && contatoOk ? (
            <div className="flex flex-wrap gap-2 pt-1.5">
              {cfg.sugestoes.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="px-3 py-2 rounded-full bg-white ring-1 ring-black/[0.08] text-[14px] text-[#3f4652] hover:ring-black/20 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <div ref={fimRef} />
        </div>
      </main>

      {/* Pede contato antes de liberar o campo */}
      {!contatoOk ? (
        <div className="shrink-0 border-t border-black/[0.07] bg-white px-4 py-4">
          <div className="mx-auto max-w-[680px]">
            <p className="text-[14px] text-[#3f4652] mb-2.5">Antes de começar, como podemos te chamar?</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={contato.nome}
                onChange={(e) => setContato({ ...contato, nome: e.target.value })}
                placeholder="Seu nome"
                className="flex-1 h-10 px-3 rounded-lg ring-1 ring-black/[0.12] text-[15px] outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: cor }}
              />
              <input
                value={contato.telefone}
                onChange={(e) => setContato({ ...contato, telefone: e.target.value })}
                placeholder="WhatsApp (opcional)"
                className="flex-1 h-10 px-3 rounded-lg ring-1 ring-black/[0.12] text-[15px] outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: cor }}
              />
              <button
                onClick={() => contato.nome.trim() && setContatoOk(true)}
                disabled={!contato.nome.trim()}
                className="h-10 px-5 rounded-lg text-white text-[15px] font-medium disabled:opacity-40"
                style={{ background: cor }}
              >
                Começar
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Compositor */
        <div className="shrink-0 border-t border-black/[0.07] bg-white px-4 py-3">
          <div className="mx-auto max-w-[680px] flex items-end gap-2">
            <textarea
              ref={campoRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={1}
              placeholder="Escreva sua mensagem…"
              className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl ring-1 ring-black/[0.12] text-[15px] leading-[1.45] outline-none focus:ring-2"
              style={{ ["--tw-ring-color" as string]: cor }}
            />
            <button
              onClick={() => enviar()}
              disabled={!texto.trim() || pensando}
              aria-label="Enviar"
              className="h-10 w-10 shrink-0 rounded-full grid place-items-center text-white disabled:opacity-35 transition"
              style={{ background: cor }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {cfg.rodape ? (
            <p className="mx-auto max-w-[680px] pt-2 text-[12px] text-[#9aa1ab]">{cfg.rodape}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { api } from "@/lib/api";

/**
 * Google Sign-In button via Google Identity Services nativo (One Tap-compatible).
 * Retorna ID token (não access_token) que o backend valida com google-auth.
 */
function GoogleCredentialButton({
  onCredential,
  disabled,
}: {
  onCredential: (cred: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    // @ts-expect-error - global google injected by GoogleOAuthProvider script
    const g = window.google;
    if (!g?.accounts?.id) return;

    g.accounts.id.initialize({
      client_id: clientId,
      callback: (resp: { credential: string }) => onCredential(resp.credential),
    });
    g.accounts.id.renderButton(ref.current, {
      theme: "outline",
      size: "large",
      type: "standard",
      shape: "rectangular",
      text: "continue_with",
      logo_alignment: "left",
      locale: "pt-BR",
      width: 360,
    });
  }, [onCredential]);

  return (
    <div className={`w-full flex justify-center ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div ref={ref} />
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !senha) {
      toast.error("Preencha email e senha");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password: senha });
      toast.success("Bem-vindo");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Email ou senha inválidos");
    } finally {
      setLoading(false);
    }
  }

  async function onGoogleCredential(credential: string) {
    setLoading(true);
    try {
      await api.post("/auth/google", { credential });
      toast.success("Bem-vindo");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Falha no login Google");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "#0a0a0a" }}>
      {/* Vídeo de fundo */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover opacity-50"
      >
        <source src="/images/tier-empresas-720p.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/30 to-transparent" />

      {/* Logo Tier Agent (variante clara sobre fundo escuro) */}
      <div className="relative z-10 px-10 py-8">
        <Link to="/" className="inline-block">
          <img
            src="/tier-agent-claro.png"
            alt="Tier Agent"
            style={{ height: 38, width: "auto", display: "block" }}
            draggable={false}
          />
        </Link>
      </div>

      {/* Card centralizado dark */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{ minHeight: "calc(100vh - 100px)" }}
      >
        <div className="w-full max-w-[480px] mx-auto px-4">
          <div
            className="rounded-[10px] px-12 pt-10 pb-0"
            style={{
              backgroundColor: "rgba(18,18,18,0.85)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 15px 35px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <h1 className="text-[20px] font-normal tracking-[-0.2px] text-white" style={{ lineHeight: "28px" }}>
              Acesse seu Tier Agent
            </h1>
            <p className="text-[13px] text-slate-400 mt-1 mb-7">Seu funcionário digital em qualquer canal.</p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  data-dark
                  className="w-full h-[40px] px-3 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                  style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                  onFocus={(e) => {
                    e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)";
                  }}
                  onBlur={(e) => {
                    e.target.style.boxShadow = "0 0 0 1px #333";
                  }}
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-normal text-slate-300">Senha</label>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    autoComplete="current-password"
                    data-dark
                    className="w-full h-[40px] px-3 pr-9 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                    style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                    onFocus={(e) => {
                      e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)";
                    }}
                    onBlur={(e) => {
                      e.target.style.boxShadow = "0 0 0 1px #333";
                    }}
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-slate-400 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-[15px] h-[15px]" /> : <Eye className="w-[15px] h-[15px]" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-[40px] rounded-[6px] text-[13px] font-medium flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:text-white"
                style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px" style={{ backgroundColor: "#333" }} />
                <span className="text-[12px] select-none text-slate-500">Ou faça login com</span>
                <div className="flex-1 h-px" style={{ backgroundColor: "#333" }} />
              </div>

              <GoogleCredentialButton onCredential={onGoogleCredential} disabled={loading} />
            </form>

            {/* Footer do card */}
            <div
              className="mt-6 -mx-12 rounded-b-[10px] py-4 text-center"
              style={{
                backgroundColor: "rgba(255,255,255,0.03)",
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <p className="text-[13px] text-slate-500">
                Ainda não tem conta?{" "}
                <Link to="/signup" className="text-slate-300 hover:text-white font-medium transition-colors">
                  Criar conta gratuita
                </Link>
              </p>
            </div>
          </div>

          <p className="text-[12px] text-slate-500 text-center mt-5">
            Já usa Tier Empresas?{" "}
            <a href="https://erp.tier.finance" className="text-slate-300 hover:text-white transition-colors">
              Entre pelo painel completo
            </a>
          </p>
        </div>
      </div>

      <div className="relative z-10 px-5 pb-4 flex gap-6 text-[13px] text-slate-400">
        <span>© Tier Finance</span>
      </div>
    </div>
  );
}

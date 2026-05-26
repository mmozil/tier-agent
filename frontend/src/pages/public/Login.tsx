import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

import { api } from "@/lib/api";

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
    // @ts-expect-error window.google injected
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
      width: 380,
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
    <div className="min-h-screen flex bg-[#F8FAFF]">
      {/* LEFT — Form */}
      <div className="w-full lg:w-[45%] flex flex-col justify-between py-10 px-10 lg:pl-12 lg:pr-16 relative overflow-hidden">
        <div className="absolute bottom-[-40px] left-0 right-0 opacity-[0.08] pointer-events-none">
          <img src="/pattern-tier-cubos.svg" alt="" className="w-full h-auto" draggable={false} />
        </div>

        <Link to="/" className="inline-flex items-center">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" style={{ height: 32, width: "auto" }} />
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-[420px] mx-auto"
        >
          <h1 className="text-[32px] font-extrabold text-[#2D2D2D] tracking-tight leading-tight">Entrar</h1>
          <p className="text-[15px] text-[#8A94A7] mt-1 mb-8">Acesse seu Tier Agent</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#B0B8C9] pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-[50px] pl-12 pr-4 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all"
                placeholder="E-mail"
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#B0B8C9] pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full h-[50px] pl-12 pr-12 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all"
                placeholder="Senha"
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#B0B8C9] hover:text-[#64748B] transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <Link
              to="#"
              className="inline-block text-[13px] text-[#003083] hover:text-[#002266] font-medium transition-colors"
            >
              Esqueceu a senha?
            </Link>

            <div className="pt-3" />

            <p className="text-center text-[14px] text-[#8A94A7]">
              Não tem uma conta?{" "}
              <Link
                to="/signup"
                className="text-[#003083] hover:text-[#002266] font-semibold transition-colors"
              >
                Criar conta
              </Link>
            </p>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[50px] bg-[#003083] hover:bg-[#002266] active:scale-[0.98] text-white font-semibold rounded-lg text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#003083]/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Entrar"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E2E8F0]" />
              <span className="text-[12px] text-[#B0B8C9] font-medium select-none">ou</span>
              <div className="flex-1 h-px bg-[#E2E8F0]" />
            </div>

            <GoogleCredentialButton onCredential={onGoogleCredential} disabled={loading} />
          </form>
        </motion.div>

        <div className="text-[12px] text-[#B0B8C9]">
          <div className="flex gap-3 flex-wrap">
            <a href="https://tier.finance/privacidade" className="hover:text-[#64748B] transition-colors">
              Privacidade
            </a>
            <span>·</span>
            <a href="https://tier.finance/termos" className="hover:text-[#64748B] transition-colors">
              Termos
            </a>
            <span>·</span>
            <a href="https://erp.tier.finance" className="hover:text-[#64748B] transition-colors">
              Já usa Tier Empresas?
            </a>
          </div>
          <p className="mt-1">© 2026 Tier Finance</p>
        </div>
      </div>

      {/* RIGHT — Visual */}
      <div className="hidden lg:block w-[55%] p-3 pl-0">
        <div className="relative w-full h-full rounded-[24px] overflow-hidden">
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/images/tier-empresas-720p.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A1628]/80 via-[#0A1628]/20 to-[#0A1628]/70" />
          <div className="relative z-10 flex flex-col justify-between h-full pt-16 pb-10 px-14">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <h2 className="text-[34px] font-bold text-white leading-[1.15] tracking-tight">
                Seu funcionário digital.
              </h2>
              <p className="text-[15px] text-white/50 mt-2 leading-relaxed">
                Atende clientes 24/7 em qualquer canal. Lembra, planeja, age.
              </p>
              <div className="w-full h-px bg-white/10 mt-6" />
            </motion.div>

            <div />

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <div className="w-full h-px bg-white/10 mb-5" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">
                    Desenvolvido por
                  </p>
                  <img
                    src="/tier-agent-claro.png"
                    alt="Tier Agent"
                    style={{ height: 22, width: "auto", opacity: 0.7 }}
                  />
                </div>
                <span className="text-[11px] text-white/25 font-medium">agent.tier.finance</span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

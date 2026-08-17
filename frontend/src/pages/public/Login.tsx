import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useGoogleLogin } from "@react-oauth/google";

import { api } from "@/lib/api";

const GOOGLE_ENABLED = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

function GoogleIcon() {
  return (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !senha) {
      toast.error("Preencha email e senha");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password: senha });
      // Login explícito SEMPRE vence um SSO federado antigo da aba: sem isto,
      // o interceptor manda o Bearer velho do sessionStorage e o backend
      // (que prioriza header sobre cookie) te deixa preso na conta anterior.
      sessionStorage.removeItem("ta_sso");
      toast.success("Bem-vindo");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Email ou senha inválidos");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFF] font-sans">
      {/* LEFT — Form */}
      <div className="w-full lg:w-[45%] flex flex-col justify-between py-10 px-10 lg:pl-12 lg:pr-16 relative overflow-hidden">
        <div className="absolute bottom-[-40px] left-0 right-0 opacity-[0.08] pointer-events-none">
          <img src="/pattern-tier-cubos.svg" alt="" className="w-full h-auto" draggable={false} />
        </div>

        <Link to="/" className="inline-flex items-center gap-3">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" style={{ height: 32, width: "auto", display: "block" }} />
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
              <Link to="/signup" className="text-[#003083] hover:text-[#002266] font-semibold transition-colors">
                Criar conta
              </Link>
            </p>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-8 bg-[#003083] hover:bg-[#002266] active:scale-[0.98] text-white font-semibold rounded-lg text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#003083]/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Entrar"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E2E8F0]" />
              <span className="text-[12px] text-[#B0B8C9] font-medium select-none">ou</span>
              <div className="flex-1 h-px bg-[#E2E8F0]" />
            </div>

            {GOOGLE_ENABLED ? <GoogleLoginButton loading={loading} setLoading={setLoading} /> : null}
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

function GoogleLoginButton({
  loading,
  setLoading,
}: {
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
}) {
  const loginWithGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        await api.post("/auth/google", { access_token: tokenResponse.access_token });
        sessionStorage.removeItem("ta_sso"); // login explícito vence SSO federado antigo da aba
        toast.success("Bem-vindo");
        window.location.href = "/admin/agentes";
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || "Falha no login Google");
      } finally {
        setLoading(false);
      }
    },
    onError: () => toast.error("Falha no login com Google"),
  });

  return (
    <button
      type="button"
      onClick={() => loginWithGoogle()}
      disabled={loading}
      className="w-full h-8 bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0A1628] font-semibold rounded-lg text-[14px] flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50"
    >
      <GoogleIcon />
      Continuar com Google
    </button>
  );
}

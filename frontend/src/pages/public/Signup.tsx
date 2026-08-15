import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { User, Building2, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useGoogleLogin } from "@react-oauth/google";

import { api } from "@/lib/api";

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

export default function Signup() {
  const [nomePessoa, setNomePessoa] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      toast.error("Senha precisa de pelo menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/signup", { nome_pessoa: nomePessoa, nome, email, password: senha });
      toast.success("Conta criada");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  const signupWithGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        await api.post("/auth/google", { access_token: tokenResponse.access_token });
        toast.success("Bem-vindo");
        window.location.href = "/admin/agentes";
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || "Falha no cadastro Google");
      } finally {
        setLoading(false);
      }
    },
    onError: () => toast.error("Falha no cadastro com Google"),
  });

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
          <h1 className="text-[32px] font-extrabold text-[#2D2D2D] tracking-tight leading-tight">
            Criar conta
          </h1>
          <p className="text-[15px] text-[#8A94A7] mt-1 mb-8">Seu primeiro agente em 30 segundos</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#B0B8C9] pointer-events-none" />
              <input
                type="text"
                value={nomePessoa}
                onChange={(e) => setNomePessoa(e.target.value)}
                className="w-full h-[50px] pl-12 pr-4 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all"
                placeholder="Seu nome"
                autoComplete="name"
                required
                disabled={loading}
              />
            </div>

            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#B0B8C9] pointer-events-none" />
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full h-[50px] pl-12 pr-4 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all"
                placeholder="Empresa"
                autoComplete="organization"
                required
                disabled={loading}
              />
            </div>

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
                minLength={8}
                className="w-full h-[50px] pl-12 pr-12 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all"
                placeholder="Senha (mín. 8 caracteres)"
                autoComplete="new-password"
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

            <div className="pt-2" />

            <p className="text-center text-[14px] text-[#8A94A7]">
              Já tem uma conta?{" "}
              <Link to="/login" className="text-[#003083] hover:text-[#002266] font-semibold transition-colors">
                Entrar
              </Link>
            </p>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-8 bg-[#003083] hover:bg-[#002266] active:scale-[0.98] text-white font-semibold rounded-lg text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#003083]/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar conta + agente"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E2E8F0]" />
              <span className="text-[12px] text-[#B0B8C9] font-medium select-none">ou</span>
              <div className="flex-1 h-px bg-[#E2E8F0]" />
            </div>

            <button
              type="button"
              onClick={() => signupWithGoogle()}
              disabled={loading}
              className="w-full h-8 bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0A1628] font-semibold rounded-lg text-[14px] flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <GoogleIcon />
              Continuar com Google
            </button>
          </form>
        </motion.div>

        <div className="text-[12px] text-[#B0B8C9]">
          <p>© 2026 Tier Finance</p>
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
                Comece em 30 segundos.
              </h2>
              <p className="text-[15px] text-white/50 mt-2 leading-relaxed">
                Crie sua conta, escolha um template e tenha um agente atendendo hoje.
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

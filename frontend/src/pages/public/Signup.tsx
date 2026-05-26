import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { api } from "@/lib/api";

export default function Signup() {
  const [nomePessoa, setNomePessoa] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [cnpj, setCnpj] = useState("");
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
      await api.post("/auth/signup", { nome_pessoa: nomePessoa, nome, email, password: senha, cnpj: cnpj || null });
      toast.success("Conta criada");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "#0a0a0a" }}>
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
              Criar conta
            </h1>
            <p className="text-[13px] text-slate-400 mt-1 mb-7">Seu primeiro agente pronto em 30 segundos.</p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">Seu nome</label>
                <input
                  type="text"
                  value={nomePessoa}
                  onChange={(e) => setNomePessoa(e.target.value)}
                  autoFocus
                  placeholder="Ex: Marcelo Morais"
                  className="w-full h-[40px] px-3 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                  style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                  onFocus={(e) => { e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)"; }}
                  onBlur={(e) => { e.target.style.boxShadow = "0 0 0 1px #333"; }}
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">Empresa</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Out Group Comercial"
                  className="w-full h-[40px] px-3 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                  style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                  onFocus={(e) => { e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)"; }}
                  onBlur={(e) => { e.target.style.boxShadow = "0 0 0 1px #333"; }}
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full h-[40px] px-3 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                  style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                  onFocus={(e) => { e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)"; }}
                  onBlur={(e) => { e.target.style.boxShadow = "0 0 0 1px #333"; }}
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">Senha</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    placeholder="mínimo 8 caracteres"
                    className="w-full h-[40px] px-3 pr-9 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                    style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                    onFocus={(e) => { e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)"; }}
                    onBlur={(e) => { e.target.style.boxShadow = "0 0 0 1px #333"; }}
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

              <div>
                <label className="block text-[13px] font-normal mb-1.5 text-slate-300">
                  CNPJ <span className="text-slate-500">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="w-full h-[40px] px-3 rounded-[6px] text-[14px] outline-none transition-shadow text-white placeholder:text-[#555]"
                  style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
                  onFocus={(e) => { e.target.style.boxShadow = "0 0 0 1px #4d8bff, 0 0 0 4px rgba(77,139,255,0.15)"; }}
                  onBlur={(e) => { e.target.style.boxShadow = "0 0 0 1px #333"; }}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-[40px] rounded-[6px] text-[13px] font-medium flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:text-white"
                style={{ backgroundColor: "#1e1e1e", boxShadow: "0 0 0 1px #333" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar conta + agente"}
              </button>
            </form>

            <div
              className="mt-6 -mx-12 rounded-b-[10px] py-4 text-center"
              style={{ backgroundColor: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="text-[13px] text-slate-500">
                Já tem conta?{" "}
                <Link to="/login" className="text-slate-300 hover:text-white font-medium transition-colors">
                  Entrar
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 px-5 pb-4 flex gap-6 text-[13px] text-slate-400">
        <span>© Tier Finance</span>
      </div>
    </div>
  );
}

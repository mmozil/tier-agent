// «Esqueceu a senha?» (18/11/2026): e-mail → código de 6 dígitos no e-mail → nova senha.
// Antes o link do login apontava para «#». A resposta do primeiro passo é a mesma com ou sem conta
// (a tela não serve para descobrir quem tem cadastro). Backend: routes/auth.py + services/senha.py.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Mail, Lock, KeyRound, Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

import { api } from "@/lib/api";

const CAMPO =
  "w-full h-[50px] pl-12 pr-4 bg-[#EEF2FF] border border-[#DBEAFE] rounded-lg text-[14px] text-[#0A1628] font-medium placeholder-[#A0A9BE] focus:outline-none focus:border-[#003083] focus:ring-2 focus:ring-[#003083]/15 focus:bg-white transition-all";
const ICONE = "absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#B0B8C9] pointer-events-none";
const BOTAO =
  "w-full h-[50px] bg-[#003083] hover:bg-[#002266] active:scale-[0.98] text-white font-semibold rounded-lg text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#003083]/20";

function erro(err: any, padrao: string): string {
  const d = err?.response?.data?.detail;
  return typeof d === "string" ? d : padrao;
}

export default function EsqueciSenha() {
  const nav = useNavigate();
  const [etapa, setEtapa] = useState<"email" | "codigo">("email");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = window.setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [espera]);

  async function pedir(e?: FormEvent) {
    e?.preventDefault();
    if (!email || ocupado) return;
    setOcupado(true);
    try {
      await api.post("/auth/senha/esqueci", { email: email.trim() });
      setEtapa("codigo");
      setEspera(60);
      toast.success("Se o e-mail tiver conta, o código chega em instantes");
    } catch (err) {
      toast.error(erro(err, "Não consegui enviar o código"));
    } finally {
      setOcupado(false);
    }
  }

  const falta =
    codigo.replace(/\D/g, "").length !== 6
      ? "o código de 6 dígitos"
      : nova.length < 8
        ? "uma senha de 8 caracteres ou mais"
        : nova !== repetir
          ? "repetir a mesma senha"
          : null;

  async function redefinir(e: FormEvent) {
    e.preventDefault();
    if (falta || ocupado) return;
    setOcupado(true);
    try {
      await api.post("/auth/senha/redefinir", { email: email.trim(), codigo, nova_senha: nova });
      toast.success("Senha criada — entre com ela");
      nav("/login");
    } catch (err: any) {
      toast.error(erro(err, "Não consegui trocar a senha"));
      if (err?.response?.status === 410 || err?.response?.status === 429) setCodigo("");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFF] font-sans">
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
          <h1 className="text-[32px] font-extrabold text-[#2D2D2D] tracking-tight leading-tight">Esqueceu a senha?</h1>
          <p className="text-[15px] text-[#8A94A7] mt-1 mb-8">
            {etapa === "email"
              ? "Mandamos um código para o seu e-mail para você criar uma senha nova."
              : `Digite o código que chegou em ${email} e a senha nova.`}
          </p>

          {etapa === "email" ? (
            <form onSubmit={pedir} className="space-y-4">
              <div className="relative">
                <Mail className={ICONE} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={CAMPO}
                  placeholder="E-mail da sua conta"
                  autoComplete="email"
                  required
                  disabled={ocupado}
                />
              </div>
              <div className="pt-3" />
              <button type="submit" disabled={ocupado || !email} className={BOTAO}>
                {ocupado ? <Loader2 className="w-5 h-5 animate-spin" /> : "Enviar código"}
              </button>
            </form>
          ) : (
            <form onSubmit={redefinir} className="space-y-4">
              <div className="relative">
                <KeyRound className={ICONE} />
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
                  className={`${CAMPO} tracking-[0.3em] placeholder:tracking-normal tabular-nums`}
                  placeholder="Código de 6 dígitos"
                  autoFocus
                  disabled={ocupado}
                />
              </div>
              <div className="relative">
                <Lock className={ICONE} />
                <input
                  type="password"
                  value={nova}
                  onChange={(e) => setNova(e.target.value)}
                  className={CAMPO}
                  placeholder="Nova senha (8 caracteres ou mais)"
                  autoComplete="new-password"
                  disabled={ocupado}
                />
              </div>
              <div className="relative">
                <Lock className={ICONE} />
                <input
                  type="password"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  className={CAMPO}
                  placeholder="Repita a nova senha"
                  autoComplete="new-password"
                  disabled={ocupado}
                />
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={() => void pedir()}
                  disabled={espera > 0 || ocupado}
                  className="text-[#003083] hover:text-[#002266] font-medium disabled:opacity-50"
                >
                  {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar código"}
                </button>
                <button type="button" onClick={() => setEtapa("email")} className="text-[#8A94A7] hover:text-[#64748B]">
                  Trocar e-mail
                </button>
              </div>
              {(codigo || nova || repetir) && falta && <p className="text-[12.5px] text-[#8A94A7]">Falta: {falta}.</p>}
              <div className="pt-1" />
              <button type="submit" disabled={!!falta || ocupado} className={BOTAO}>
                {ocupado ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar senha nova"}
              </button>
            </form>
          )}

          <p className="text-center text-[14px] text-[#8A94A7] pt-6">
            <Link to="/login" className="inline-flex items-center gap-1 text-[#003083] hover:text-[#002266] font-semibold">
              <ArrowLeft className="w-4 h-4" /> Voltar para o login
            </Link>
          </p>
        </motion.div>

        <div className="text-[12px] text-[#B0B8C9]">
          <p>© 2026 Tier Finance</p>
        </div>
      </div>

      <div className="hidden lg:block w-[55%] p-3 pl-0">
        <div className="relative w-full h-full rounded-[24px] overflow-hidden">
          <video autoPlay loop muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover">
            <source src="/images/tier-empresas-720p.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A1628]/80 via-[#0A1628]/20 to-[#0A1628]/70" />
        </div>
      </div>
    </div>
  );
}

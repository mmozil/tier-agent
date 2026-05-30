import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

interface Invite {
  nome: string;
  email: string;
  empresa: string | null;
}

export default function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Invite>(`/team/invite/${token}`)
      .then(({ data }) => setInvite(data))
      .catch(() => setError("Convite inválido ou já utilizado."))
      .finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    if (password.length < 6) {
      toast.error("Senha precisa de pelo menos 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/team/invite/${token}/accept`, { password });
      toast.success("Conta criada! Faça login.");
      navigate("/login");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Erro ao ativar conta");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0f11] px-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-xl p-8">
        {loading && <p className="text-[14px] text-slate-500 text-center">Carregando convite…</p>}

        {!loading && error && (
          <div className="text-center">
            <p className="text-[16px] font-semibold text-slate-800 mb-1">Convite indisponível</p>
            <p className="text-[13px] text-slate-500">{error}</p>
          </div>
        )}

        {!loading && invite && (
          <>
            <h1 className="text-[20px] font-bold text-[#30313d]">Bem-vindo(a), {invite.nome.split(" ")[0]}!</h1>
            <p className="text-[13px] text-slate-500 mt-1">
              Você foi convidado(a) pra atender em{" "}
              <b className="text-slate-700">{invite.empresa || "Tier Agent"}</b>. Defina sua senha pra ativar a conta.
            </p>

            <div className="mt-5 space-y-3">
              <div>
                <label className="text-[12px] text-slate-500">Seu login</label>
                <div className="h-10 px-3 flex items-center text-[14px] text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                  {invite.email}
                </div>
              </div>
              <div>
                <label className="text-[12px] text-slate-500">Crie uma senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && accept()}
                  placeholder="mín. 6 caracteres"
                  className="w-full h-10 px-3 text-[14px] rounded-lg border border-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083]"
                />
              </div>
              <button
                onClick={accept}
                disabled={saving}
                className="w-full h-10 rounded-lg bg-[#003083] text-white text-[14px] font-semibold hover:bg-[#002266] disabled:opacity-50"
              >
                {saving ? "Ativando…" : "Ativar conta e entrar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, User, Building2, Mail } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function PerfilPage() {
  const { user, refresh } = useAuth();
  const [nomePessoa, setNomePessoa] = useState(user?.tenant?.nome_pessoa || "");
  const [nome, setNome] = useState(user?.tenant?.nome || "");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/auth/me", { nome_pessoa: nomePessoa, nome });
      toast.success("Perfil atualizado");
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-[28px] font-bold text-[#30313d] mt-6 mb-2">Meu perfil</h1>
      <p className="text-[14px] text-[#697386] mb-6">Dados básicos da sua conta no Tier Agent.</p>

      <form onSubmit={onSubmit} className="bg-[#f4f7fa] rounded-lg p-4">
        <div className="bg-white rounded-md px-8 py-6 space-y-6">
          <Field label="Seu nome" icon={<User className="w-4 h-4 text-[#697386]" />}>
            <input
              type="text"
              value={nomePessoa}
              onChange={(e) => setNomePessoa(e.target.value)}
              required
              className="w-full h-7 px-3 text-[14px] rounded-md bg-white text-slate-700 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
            />
          </Field>

          <Field label="Empresa" icon={<Building2 className="w-4 h-4 text-[#697386]" />}>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              className="w-full h-7 px-3 text-[14px] rounded-md bg-white text-slate-700 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] focus:shadow-[0_0_0_2px_#003083] transition-shadow"
            />
          </Field>

          <Field label="E-mail" icon={<Mail className="w-4 h-4 text-[#697386]" />} hint="O e-mail é usado pra login e não pode ser alterado.">
            <input
              type="email"
              value={user?.email || ""}
              readOnly
              className="w-full h-7 px-3 text-[14px] rounded-md bg-slate-50 text-slate-500 outline-none shadow-[0_0_0_1px_rgb(226,232,240)] cursor-not-allowed"
            />
          </Field>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Salvar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-10">
      <div className="w-[220px] shrink-0 pt-1">
        <div className="flex items-center gap-2 mb-1.5">
          {icon}
          <h3 className="text-[14px] font-medium text-[#1a2c44]">{label}</h3>
        </div>
        {hint && <p className="text-[12px] text-[#697386] leading-[1.6]">{hint}</p>}
      </div>
      <div className="flex-1 max-w-[420px]">{children}</div>
    </div>
  );
}

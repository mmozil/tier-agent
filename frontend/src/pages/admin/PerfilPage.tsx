import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, User, Building2, Mail, Upload, Image as ImageIcon, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { FC, PageFrame, PageHero, Row, Button } from "@/components/ds/fc";
import Avatar from "@/components/Avatar";

export default function PerfilPage() {
  const { user, refresh } = useAuth();
  const [nomePessoa, setNomePessoa] = useState(user?.tenant?.nome_pessoa || "");
  const [nome, setNome] = useState(user?.tenant?.nome || "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarUrl = user?.tenant?.avatar_url || null;
  const displayNome = nomePessoa || user?.tenant?.nome || user?.email || "?";

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Imagem maior que 5MB");
      return;
    }
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append("file", f);
    try {
      await api.post("/auth/me/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Foto atualizada");
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao enviar a foto");
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAvatarRemove() {
    setUploadingAvatar(true);
    try {
      await api.delete("/auth/me/avatar");
      toast.success("Foto removida");
      await refresh();
    } catch {
      toast.error("Erro ao remover");
    } finally {
      setUploadingAvatar(false);
    }
  }

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

  const inputCls = `w-full h-9 px-3 text-[14px] rounded-lg bg-white dark:bg-[#14171c] border ${FC.hair} text-[#262626] dark:text-slate-200 outline-none focus:shadow-[0_0_0_2px_#003083] transition-shadow`;

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <PageHero title="Meu perfil" subtitle="Dados básicos da sua conta no Tier Agent." />

        <Row last>
          <form onSubmit={onSubmit} className="p-6 space-y-6">
            <Field label="Foto" icon={<ImageIcon className={`w-4 h-4 ${FC.mut}`} />} hint="Aparece no menu do topo e no rodapé da barra lateral.">
              <div className="flex items-center gap-4">
                <Avatar nome={displayNome} src={avatarUrl} size={56} />
                <div className="flex items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onAvatarChange} className="hidden" />
                  <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar}>
                    {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {avatarUrl ? "Trocar foto" : "Enviar foto"}
                  </Button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={onAvatarRemove}
                      disabled={uploadingAvatar}
                      className="inline-flex items-center gap-1 text-[13px] text-rose-600 hover:underline disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remover
                    </button>
                  )}
                </div>
              </div>
            </Field>

            <Field label="Seu nome" icon={<User className={`w-4 h-4 ${FC.mut}`} />}>
              <input type="text" value={nomePessoa} onChange={(e) => setNomePessoa(e.target.value)} required className={inputCls} />
            </Field>

            <Field label="Empresa" icon={<Building2 className={`w-4 h-4 ${FC.mut}`} />}>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} required className={inputCls} />
            </Field>

            <Field label="E-mail" icon={<Mail className={`w-4 h-4 ${FC.mut}`} />} hint="O e-mail é usado pra login e não pode ser alterado.">
              <input type="email" value={user?.email || ""} readOnly className={`${inputCls} bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626]/[0.56] cursor-not-allowed`} />
            </Field>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </Button>
            </div>
          </form>
        </Row>
      </PageFrame>
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
          <h3 className={`text-[14px] font-medium ${FC.ink}`}>{label}</h3>
        </div>
        {hint && <p className={`text-[12px] leading-[1.6] ${FC.sub}`}>{hint}</p>}
      </div>
      <div className="flex-1 max-w-[420px]">{children}</div>
    </div>
  );
}

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, User, Building2, Mail, Image as ImageIcon, Camera } from "lucide-react";

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
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onAvatarChange} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingAvatar}
                  title="Alterar foto"
                  className="group relative w-16 h-16 rounded-full shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[#003083]/60 disabled:cursor-not-allowed"
                >
                  <Avatar nome={displayNome} src={avatarUrl} size={64} />
                  <span
                    className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 transition-opacity ${
                      uploadingAvatar ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {uploadingAvatar ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
                  </span>
                </button>
                <div className="min-w-0">
                  <div className="text-[13px]">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="font-medium text-[#003083] dark:text-[#5b9bff] hover:underline disabled:opacity-50"
                    >
                      {avatarUrl ? "Trocar foto" : "Enviar foto"}
                    </button>
                    {avatarUrl && (
                      <>
                        <span className={`mx-2 ${FC.mut}`}>·</span>
                        <button
                          type="button"
                          onClick={onAvatarRemove}
                          disabled={uploadingAvatar}
                          className="text-rose-600 hover:underline disabled:opacity-50"
                        >
                          Remover
                        </button>
                      </>
                    )}
                  </div>
                  <p className={`text-[12px] mt-1 ${FC.mut}`}>PNG, JPG ou WEBP · até 5MB</p>
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

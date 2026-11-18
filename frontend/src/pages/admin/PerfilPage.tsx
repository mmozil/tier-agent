import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, User, Building2, Mail, Image as ImageIcon, Camera, Lock } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { FC, PageFrame, PageHero, Row, Button } from "@/components/ds/fc";
import Avatar from "@/components/Avatar";

export default function PerfilPage() {
  const { user, refresh } = useAuth();
  // Membro (entrou pelo CRM ou trocou de conta): o perfil é o DELE — não o do dono da conta
  // (12/11/2026). Foto é do dono; nome da empresa, só dono/admin muda.
  const membro = user?.member ?? null;
  const podeMudarEmpresa = !membro || user?.role === "owner" || user?.role === "admin";
  const [nomePessoa, setNomePessoa] = useState(membro?.nome || user?.tenant?.nome_pessoa || "");
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
      await api.patch("/auth/me", podeMudarEmpresa ? { nome_pessoa: nomePessoa, nome } : { nome_pessoa: nomePessoa });
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

        <Row>
          <form onSubmit={onSubmit} className="p-6 space-y-6">
            {!membro && (
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
            )}

            <Field label="Seu nome" icon={<User className={`w-4 h-4 ${FC.mut}`} />}>
              <input type="text" value={nomePessoa} onChange={(e) => setNomePessoa(e.target.value)} required className={inputCls} />
            </Field>

            <Field
              label="Empresa"
              icon={<Building2 className={`w-4 h-4 ${FC.mut}`} />}
              hint={podeMudarEmpresa ? undefined : "Só o dono ou um administrador da conta muda o nome da empresa."}
            >
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                readOnly={!podeMudarEmpresa}
                className={podeMudarEmpresa ? inputCls : `${inputCls} bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626]/[0.56] cursor-not-allowed`}
              />
            </Field>

            <Field label="E-mail" icon={<Mail className={`w-4 h-4 ${FC.mut}`} />} hint="O e-mail é usado pra login e não pode ser alterado.">
              <input type="email" value={membro?.email || user?.email || ""} readOnly className={`${inputCls} bg-[#F1F3F5] dark:bg-[#16191f] text-[#262626]/[0.56] cursor-not-allowed`} />
            </Field>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </Button>
            </div>
          </form>
        </Row>

        <Row last>
          <TrocarSenha temSenha={!!user?.tem_senha} inputCls={inputCls} />
        </Row>
      </PageFrame>
    </div>
  );
}

// 18/11/2026 — trocar a senha com código no e-mail (pedido do dono para o Augusto). A senha nova só
// vale depois do código: quem está com a sessão aberta sem acesso ao e-mail não troca. Ver services/senha.py.
function TrocarSenha({ temSenha, inputCls }: { temSenha: boolean; inputCls: string }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = window.setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [espera]);

  const falta =
    temSenha && !atual
      ? "digite a senha atual"
      : nova.length < 8
        ? "a nova senha precisa de 8 caracteres ou mais"
        : nova !== repetir
          ? "as duas senhas novas não são iguais"
          : null;

  async function pedirCodigo(e?: React.FormEvent) {
    e?.preventDefault();
    if (falta || ocupado) return;
    setOcupado(true);
    try {
      const { data } = await api.post<{ enviado_para: string }>("/auth/me/senha/codigo", {
        senha_atual: temSenha ? atual : null,
        nova_senha: nova,
      });
      setEnviadoPara(data.enviado_para);
      setCodigo("");
      setEspera(60);
      toast.success(`Código enviado para ${data.enviado_para}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Não consegui enviar o código");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (codigo.replace(/\D/g, "").length !== 6 || ocupado) return;
    setOcupado(true);
    try {
      await api.post("/auth/me/senha/confirmar", { codigo });
      toast.success("Senha trocada");
      setAtual("");
      setNova("");
      setRepetir("");
      setCodigo("");
      setEnviadoPara(null);
    } catch (err: any) {
      const status = err?.response?.status;
      toast.error(err?.response?.data?.detail || "Não consegui confirmar");
      // código vencido, morto ou de outro pedido: volta para o começo
      if (status === 410 || status === 429) {
        setEnviadoPara(null);
        setCodigo("");
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="p-6">
      <Field
        label="Senha"
        icon={<Lock className={`w-4 h-4 ${FC.mut}`} />}
        hint="A senha nova só passa a valer depois do código que mandamos para o seu e-mail."
      >
        {!enviadoPara ? (
          <form onSubmit={pedirCodigo} className="space-y-3">
            {temSenha && (
              <input
                type="password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                placeholder="Senha atual"
                autoComplete="current-password"
                className={inputCls}
              />
            )}
            <input
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder="Nova senha (8 caracteres ou mais)"
              autoComplete="new-password"
              className={inputCls}
            />
            <input
              type="password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              placeholder="Repita a nova senha"
              autoComplete="new-password"
              className={inputCls}
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className={`text-[12px] ${FC.mut}`}>{(atual || nova || repetir) && falta ? `Falta: ${falta}.` : ""}</p>
              <Button type="submit" variant="secondary" disabled={!!falta || ocupado}>
                {ocupado && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Enviar código por e-mail
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={confirmar} className="space-y-3">
            <p className={`text-[13px] ${FC.sub}`}>
              Mandamos um código de 6 dígitos para <b className={FC.ink}>{enviadoPara}</b>. Ele vale por 15 minutos.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
              placeholder="Código do e-mail"
              className={`${inputCls} tracking-[0.3em] placeholder:tracking-normal tabular-nums`}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className={`text-[12px] ${FC.mut} space-x-3`}>
                <button
                  type="button"
                  onClick={() => void pedirCodigo()}
                  disabled={espera > 0 || ocupado}
                  className="text-[#003083] dark:text-[#5b9bff] hover:underline disabled:no-underline disabled:opacity-50"
                >
                  {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar código"}
                </button>
                <button type="button" onClick={() => setEnviadoPara(null)} className="hover:underline">
                  Voltar
                </button>
              </div>
              <Button type="submit" variant="primary" disabled={codigo.replace(/\D/g, "").length !== 6 || ocupado}>
                {ocupado && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Trocar senha
              </Button>
            </div>
          </form>
        )}
      </Field>
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

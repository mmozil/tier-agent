import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Workflow, Trash2, Send } from "lucide-react";

import { api } from "@/lib/api";

interface Playbook {
  id: number;
  agent_id: number;
  nome: string;
  descricao: string | null;
  canvas_json: { version?: number; nodes?: any[]; edges?: any[] };
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string;
}

export default function PlaybookEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pb, setPb] = useState<Playbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Playbook>(`/playbooks/${id}`);
        setPb(data);
      } catch {
        toast.error("Playbook não encontrado");
        navigate("/admin/playbooks");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  async function publish() {
    if (!pb) return;
    if (!pb.canvas_json?.nodes?.length) {
      toast.error("Adicione pelo menos um nó antes de publicar");
      return;
    }
    setPublishing(true);
    try {
      await api.post(`/playbooks/${pb.id}/publish`);
      toast.success("Playbook publicado");
      const { data } = await api.get<Playbook>(`/playbooks/${id}`);
      setPb(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function archive() {
    if (!pb) return;
    if (!confirm("Arquivar este playbook? Ele para de rodar imediatamente.")) return;
    try {
      await api.post(`/playbooks/${pb.id}/archive`);
      toast.success("Arquivado");
      navigate("/admin/playbooks");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao arquivar");
    }
  }

  if (loading || !pb) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-[#003083] animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mt-6 mb-2">
        <Link
          to="/admin/playbooks"
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[28px] font-bold text-[#30313d] flex-1 truncate">{pb.nome}</h1>
        <button
          onClick={archive}
          className="h-6 px-2 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-white text-[#404452] shadow-[0_0_0_1px_rgb(212,222,233)] hover:shadow-[0_0_0_1px_rgb(180,190,210)]"
        >
          <Trash2 className="w-3 h-3" />
          Arquivar
        </button>
        <button
          onClick={publish}
          disabled={publishing}
          className="h-6 px-3 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1 bg-[#003083] text-white hover:bg-[#002266] disabled:opacity-50"
        >
          {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {pb.status === "published" ? "Republicar" : "Publicar"}
        </button>
      </div>
      <p className="text-[14px] text-[#697386] mb-6">
        {pb.descricao || "Editor visual do playbook."}
        {" "}
        <span className="text-[12px] text-slate-400">
          (canvas drag-and-drop chega no próximo deploy — Sprint 2)
        </span>
      </p>

      {/* Canvas placeholder — Sprint 2 plugará @xyflow/react aqui */}
      <div className="bg-[#f4f7fa] rounded-lg p-12 text-center min-h-[400px] flex flex-col items-center justify-center">
        <div className="inline-flex w-12 h-12 rounded-md bg-white items-center justify-center mb-4 shadow-[0_0_0_1px_rgb(226,232,240)]">
          <Workflow className="w-6 h-6 text-[#003083]" />
        </div>
        <h3 className="text-[16px] font-semibold text-[#1a2c44] mb-1">Canvas em construção</h3>
        <p className="text-[13px] text-[#697386] max-w-md">
          O editor visual com drag-and-drop dos nós (Trigger Keyword, LLM Step, Branch, Wait,
          Tier Pay, Handoff Humano e mais 8) chega no próximo deploy. O backend já está pronto
          pra receber canvas via PUT /playbooks/{pb.id}.
        </p>
        <div className="mt-4 text-[11px] text-slate-400">
          {pb.canvas_json?.nodes?.length || 0} nós · status: {pb.status}
        </div>
      </div>
    </div>
  );
}

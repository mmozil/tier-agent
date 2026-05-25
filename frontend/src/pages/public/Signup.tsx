import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

export default function Signup() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Senha precisa de pelo menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/signup", { nome, email, password, cnpj: cnpj || null });
      toast.success("Conta criada");
      window.location.href = "/admin/agentes";
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Erro ao criar conta";
      toast.error(typeof msg === "string" ? msg : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[420px] bg-white rounded-xl border border-slate-200 p-8 shadow-sm"
      >
        <div className="text-center mb-6">
          <img src="/tier-agent-escuro.png" alt="Tier Agent" className="h-8 w-auto mx-auto" />
          <p className="mt-3 text-[13px] text-slate-500">Criar conta + agente em 30 segundos</p>
        </div>

        <label className="block text-[13px] text-slate-700 mb-1">Seu nome ou empresa</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          className="w-full h-10 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
        />

        <label className="block text-[13px] text-slate-700 mb-1 mt-4">E-mail</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full h-10 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
        />

        <label className="block text-[13px] text-slate-700 mb-1 mt-4">Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="mínimo 8 caracteres"
          className="w-full h-10 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
        />

        <label className="block text-[13px] text-slate-700 mb-1 mt-4">
          CNPJ <span className="text-slate-400">(opcional)</span>
        </label>
        <input
          type="text"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
          placeholder="00.000.000/0000-00"
          className="w-full h-10 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-6 h-10 bg-tier hover:bg-tier-dark text-white rounded-md text-[14px] font-medium disabled:opacity-50"
        >
          {loading ? "Criando..." : "Criar conta + agente"}
        </button>

        <p className="text-center mt-5 text-[13px] text-slate-500">
          Já tem conta?{" "}
          <Link to="/login" className="text-tier hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}

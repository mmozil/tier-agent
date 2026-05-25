import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

export default function Signup() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // TODO endpoint /signup público (próxima fase)
      await api.post("/signup", { nome, email, cnpj });
      toast.success("Conta criada — verifique seu e-mail");
      window.location.href = "/login";
    } catch (err) {
      toast.error("Endpoint /signup ainda não implementado");
      console.error(err);
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
          <div className="text-[20px] font-medium text-slate-900">
            tier<span className="text-tier">.</span>
            <span className="text-slate-500 ml-1 text-[13px]">agent</span>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">Criar conta + agente em 30 segundos</p>
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

import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // TODO endpoint /auth/login no backend (próxima fase)
      await api.post("/auth/login", { email, password });
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error("Endpoint /auth/login ainda não implementado");
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
          <p className="mt-1 text-[13px] text-slate-500">Entrar na sua conta</p>
        </div>

        <label className="block text-[13px] text-slate-700 mb-1">E-mail</label>
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
          className="w-full h-10 px-3 text-[14px] border border-slate-300 rounded-md focus:outline-none focus:border-tier"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-6 h-10 bg-tier hover:bg-tier-dark text-white rounded-md text-[14px] font-medium disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="text-center mt-5 text-[13px] text-slate-500">
          Não tem conta?{" "}
          <Link to="/signup" className="text-tier hover:underline">
            Criar agora
          </Link>
        </p>
      </form>
    </div>
  );
}

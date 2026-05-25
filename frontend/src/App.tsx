import { Navigate, Route, Routes } from "react-router-dom";

import AdminLayout from "./components/AdminLayout";
import Dashboard from "./pages/agent/Dashboard";
import Landing from "./pages/public/Landing";
import Login from "./pages/public/Login";
import Signup from "./pages/public/Signup";
import AgentesPage from "./pages/admin/AgentesPage";
import LlmProvidersPage from "./pages/admin/LlmProvidersPage";
import FeaturesPage from "./pages/admin/FeaturesPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/dashboard" element={<Dashboard />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/agentes" replace />} />
        <Route path="agentes" element={<AgentesPage />} />
        <Route path="llm" element={<LlmProvidersPage />} />
        <Route path="features" element={<FeaturesPage />} />
        <Route
          path="params"
          element={<div className="text-[13px] text-slate-500">Em construção (Fase 4 parte 2)</div>}
        />
        <Route
          path="metricas"
          element={<div className="text-[13px] text-slate-500">Em construção (Fase 4 parte 2)</div>}
        />
        <Route
          path="cobranca"
          element={<div className="text-[13px] text-slate-500">Em construção (Fase 7)</div>}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

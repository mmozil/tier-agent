import { Navigate, Route, Routes } from "react-router-dom";

import AdminLayout from "./components/AdminLayout";
import Dashboard from "./pages/agent/Dashboard";
import Landing from "./pages/public/Landing";
import Login from "./pages/public/Login";
import Signup from "./pages/public/Signup";
import AgentesPage from "./pages/admin/AgentesPage";
import LlmProvidersPage from "./pages/admin/LlmProvidersPage";
import FeaturesPage from "./pages/admin/FeaturesPage";
import CanaisPage from "./pages/admin/CanaisPage";
import KnowledgePage from "./pages/admin/KnowledgePage";
import CobrancaPage from "./pages/admin/CobrancaPage";
import PerfilPage from "./pages/admin/PerfilPage";
import ConfiguracoesPage from "./pages/admin/ConfiguracoesPage";
import SuportePage from "./pages/admin/SuportePage";

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h1 className="text-[28px] font-bold text-[#30313d] mt-6 mb-2">{title}</h1>
      <p className="text-[14px] text-[#697386]">{desc}</p>
    </div>
  );
}

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
        <Route path="conversas" element={<Placeholder title="Conversas" desc="Histórico de conversas por agente (em breve)." />} />
        <Route path="canais" element={<CanaisPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="params" element={<Placeholder title="Parâmetros" desc="Tunings runtime (em breve)." />} />
        <Route path="metricas" element={<Placeholder title="Métricas" desc="Custo, mensagens/dia, deflection rate (em breve)." />} />
        <Route path="cobranca" element={<CobrancaPage />} />
        <Route path="equipe" element={<Placeholder title="Equipe" desc="Convidar membros pro tenant (em breve)." />} />
        <Route path="perfil" element={<PerfilPage />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
        <Route path="suporte" element={<SuportePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

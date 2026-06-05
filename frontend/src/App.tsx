import { Navigate, Route, Routes } from "react-router-dom";

import AdminLayout from "./components/AdminLayout";
import Dashboard from "./pages/agent/Dashboard";
import Landing from "./pages/public/Landing";
import Plataforma from "./pages/public/Plataforma";
import Recursos from "./pages/public/Recursos";
import Precos from "./pages/public/Precos";
import DesignProof from "./pages/public/DesignProof";
import MetricasPreview from "./pages/public/MetricasPreview";
import Login from "./pages/public/Login";
import Signup from "./pages/public/Signup";
import Privacy from "./pages/public/Privacy";
import AcceptInvitePage from "./pages/public/AcceptInvitePage";
import DataDeletion from "./pages/public/DataDeletion";
import AgentesPage from "./pages/admin/AgentesPage";
import LlmProvidersPage from "./pages/admin/LlmProvidersPage";
import FeaturesPage from "./pages/admin/FeaturesPage";
import CanaisPage from "./pages/admin/CanaisPage";
import KnowledgePage from "./pages/admin/KnowledgePage";
import CobrancaPage from "./pages/admin/CobrancaPage";
import PerfilPage from "./pages/admin/PerfilPage";
import ConfiguracoesPage from "./pages/admin/ConfiguracoesPage";
import SuportePage from "./pages/admin/SuportePage";
import PlaybooksPage from "./pages/admin/PlaybooksPage";
import PlaybookEditorPage from "./pages/admin/PlaybookEditorPage";
import PlaybookExecutionsPage from "./pages/admin/PlaybookExecutionsPage";
import MetricasPage from "./pages/admin/MetricasPage";
import VisaoGeralPage from "./pages/admin/VisaoGeralPage";
import { FC, PageFrame, Row } from "./components/ds/fc";
import AgentSkillsPage from "./pages/admin/AgentSkillsPage";
import MarketplacePage from "./pages/admin/MarketplacePage";
import LeadsPage from "./pages/admin/LeadsPage";
import ConversasPage from "./pages/admin/ConversasPage";
import AtencaoPage from "./pages/admin/AtencaoPage";
import RelatoriosAtendimentoPage from "./pages/admin/RelatoriosAtendimentoPage";
import EquipePage from "./pages/admin/EquipePage";

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row last>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>{title}</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>{desc}</p>
            <span className={`mt-5 inline-flex items-center gap-1.5 rounded-full border ${FC.hair} px-2.5 py-1 text-[11px] font-medium ${FC.mut}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5A300]" /> Em breve
            </span>
          </div>
        </Row>
      </PageFrame>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/plataforma" element={<Plataforma />} />
      <Route path="/recursos" element={<Recursos />} />
      <Route path="/precos" element={<Precos />} />
      <Route path="/design-proof" element={<DesignProof />} />
      <Route path="/preview/metricas" element={<MetricasPreview />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/convite/:token" element={<AcceptInvitePage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/privacidade" element={<Privacy />} />
      <Route path="/data-deletion" element={<DataDeletion />} />
      <Route path="/dashboard" element={<Dashboard />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<VisaoGeralPage />} />
        <Route path="agentes" element={<AgentesPage />} />
        <Route path="llm" element={<LlmProvidersPage />} />
        <Route path="features" element={<FeaturesPage />} />
        <Route path="atencao" element={<AtencaoPage />} />
        <Route path="conversas" element={<ConversasPage />} />
        <Route path="canais" element={<CanaisPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="relatorios-atendimento" element={<RelatoriosAtendimentoPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="params" element={<Placeholder title="Parâmetros" desc="Tunings runtime (em breve)." />} />
        <Route path="metricas" element={<MetricasPage />} />
        <Route path="agentes/:id/skills" element={<AgentSkillsPage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="cobranca" element={<CobrancaPage />} />
        <Route path="equipe" element={<EquipePage />} />
        <Route path="playbooks" element={<PlaybooksPage />} />
        <Route path="playbooks/:id" element={<PlaybookEditorPage />} />
        <Route path="playbooks/:id/executions" element={<PlaybookExecutionsPage />} />
        <Route path="perfil" element={<PerfilPage />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
        <Route path="suporte" element={<SuportePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

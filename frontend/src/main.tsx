import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { GoogleOAuthProvider } from "@react-oauth/google";

import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./index.css";

// SSO federado do ERP (Tier Empresas): quando o ERP embute/abre o inbox, passa
// o token no hash (#sso_token=<jwt>). Guarda em sessionStorage (escopo da aba)
// ANTES de qualquer chamada à API (o api.ts injeta como Bearer) e limpa o hash.
// Bearer (não cookie) de propósito: o cookie tier_session colide entre ERP e Agent.
(() => {
  const m = window.location.hash.match(/sso_token=([^&]+)/);
  if (m) {
    sessionStorage.setItem("ta_sso", decodeURIComponent(m[1]));
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
})();

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const appShell = (
  <BrowserRouter>
    <AuthProvider>
      <App />
      <Toaster position="top-right" />
    </AuthProvider>
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {GOOGLE_CLIENT_ID ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{appShell}</GoogleOAuthProvider> : appShell}
  </React.StrictMode>,
);

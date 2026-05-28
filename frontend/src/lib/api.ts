import axios from "axios";

// Em produção (build): aponta direto pro backend (CORS configurado lá).
// Em dev (vite proxy): /api/v1 funciona via proxy do vite.config.ts.
const baseURL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "https://api-agent.tier.finance/api/v1" : "/api/v1");

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Só redireciona pra /login em rotas PROTEGIDAS. Páginas públicas
// (Landing /, /login, /signup) montam o AuthProvider e disparam /auth/me,
// que retorna 401 quando deslogado — isso NÃO pode quicar a landing.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const path = window.location.pathname;
    const isProtected = path.startsWith("/admin") || path.startsWith("/dashboard");
    if (err.response?.status === 401 && isProtected) {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

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

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

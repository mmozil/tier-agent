import { useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Toggle claro/escuro (estilo Firecrawl). O tema é aplicado no boot em main.tsx
 * (classe `dark` no <html>, persistida em localStorage) pra não dar flash. Aqui só
 * alternamos e persistimos. */
export const THEME_KEY = "ta-theme";

function isDarkNow(): boolean {
  return document.documentElement.classList.contains("dark");
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(isDarkNow);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(next);
  }

  return (
    <button onClick={toggle} title={dark ? "Modo claro" : "Modo escuro"} aria-label="Alternar tema" className={className}>
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

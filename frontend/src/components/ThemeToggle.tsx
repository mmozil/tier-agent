import { Moon, Sun } from "lucide-react";

/** Toggle claro/escuro no padrão shadcn (Sun↔Moon com crossfade rotate+scale).
 * O tema é aplicado no boot em main.tsx (classe `dark` no <html>, persistida em
 * localStorage) pra não dar flash. Aqui só alternamos a classe + persistimos — os
 * dois ícones ficam empilhados e trocam via classes `dark:` (CSS, sem re-render). */
export const THEME_KEY = "ta-theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  return (
    <button onClick={toggle} title="Alternar tema" aria-label="Alternar tema" className={`relative ${className}`}>
      <Sun className="w-4 h-4 rotate-0 scale-100 transition-all duration-300 ease-out motion-reduce:transition-none dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute inset-0 m-auto w-4 h-4 rotate-90 scale-0 transition-all duration-300 ease-out motion-reduce:transition-none dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Alternar tema</span>
    </button>
  );
}

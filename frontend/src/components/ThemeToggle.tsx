import { Contrast } from "lucide-react";

/** Toggle claro/escuro no padrão shadcn — ícone único `Contrast` (círculo
 * meio-preenchido). O tema é aplicado no boot em main.tsx (classe `dark` no
 * <html>, persistida em localStorage) pra não dar flash. Aqui só alternamos. */
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
    <button onClick={toggle} title="Alternar tema" aria-label="Alternar tema" className={className}>
      <Contrast className="w-4 h-4" />
      <span className="sr-only">Alternar tema</span>
    </button>
  );
}

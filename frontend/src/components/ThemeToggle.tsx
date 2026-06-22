import { Contrast } from "lucide-react";

/** Toggle claro/escuro — botão idêntico ao mode-toggle do shadcn:
 * ghost `rounded-lg` 32px (size-8), ícone único `Contrast` 18px (size-4.5).
 * O tema é aplicado no boot em main.tsx (classe `dark` no <html>, persistida em
 * localStorage) pra não dar flash. Aqui só alternamos + persistimos. */
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
    <button
      type="button"
      onClick={toggle}
      title="Toggle theme"
      aria-label="Alternar tema"
      className={`group/toggle inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-lg outline-none transition-all text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:bg-black/[0.04] hover:text-[#262626] dark:hover:bg-white/[0.04] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-[#003083]/40 active:scale-[0.95] ${className}`}
    >
      <Contrast className="w-[18px] h-[18px]" />
      <span className="sr-only">Alternar tema</span>
    </button>
  );
}

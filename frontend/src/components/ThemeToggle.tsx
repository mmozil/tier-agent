/** Toggle claro/escuro — botão + ícone EXATOS do mode-toggle do site shadcn
 * (extraídos do DOM real: botão ghost rounded-md size-8, ícone Tabler "contrast"
 * size-4.5/18px). O tema é aplicado no boot em main.tsx (classe `dark` no <html>,
 * persistida em localStorage) pra não dar flash. Aqui só alternamos + persistimos. */
export const THEME_KEY = "ta-theme";

// Ícone idêntico ao do shadcn (Tabler contrast): círculo + linha vertical + hachura.
function ContrastIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M12 3l0 18" />
      <path d="M12 9l4.65 -4.65" />
      <path d="M12 14.3l7.37 -7.37" />
      <path d="M12 19.6l8.85 -8.85" />
    </svg>
  );
}

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
      className={`group/toggle inline-flex w-8 h-8 shrink-0 items-center justify-center gap-2 rounded-md whitespace-nowrap text-sm font-medium outline-none transition-all text-[#262626]/[0.72] dark:text-[#9aa1ab] hover:bg-black/[0.04] hover:text-[#262626] dark:hover:bg-white/[0.04] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-[#003083]/40 active:scale-[0.95] ${className}`}
    >
      <ContrastIcon className="w-[18px] h-[18px]" />
      <span className="sr-only">Alternar tema</span>
    </button>
  );
}

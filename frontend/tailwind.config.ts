import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tier brand (azul = cor padrão única)
        tier: {
          DEFAULT: "#003083",
          dark: "#002266",
          light: "#0050D5",
          pastel: "#8AAED4",
        },
        // ─── Attio-grade system (near-white + near-black + hairline) ───
        ink: "#0D0F11", // títulos near-black
        surface: {
          DEFAULT: "#FFFFFF",
          subtle: "#FBFBFB",
          muted: "#F8F9FA",
          sunken: "#F2F3F5",
        },
        hairline: "#EEEFF1",
        line: {
          DEFAULT: "#E4E7EC",
          strong: "#D1D3D6",
        },
        cta: {
          DEFAULT: "#16191C",
          hover: "#25282C",
        },
        accent: {
          DEFAULT: "#003083",
          hover: "#002266",
        },
        success: "#00D17E",
        warning: "#F5A300",
        danger: "#E5484D",
        // status pills do canvas
        flow: {
          okbg: "#E6F9F0",
          okfg: "#0A8F5A",
          runbg: "#FFF7E6",
          runfg: "#B26A00",
          errbg: "#FDECEC",
          errfg: "#C0353A",
        },
        // nós do playbook (por categoria)
        node: {
          trigger: "#8B5CF6",
          action: "#003083",
          integration: "#00D17E",
          logic: "#F5A300",
          human: "#16191C",
        },
        // ─── Legado Tier Personal (mantido p/ não quebrar páginas existentes) ───
        "tier-bg": {
          page: "#F0F4FF",
          input: "#EEF2FF",
          badge: "#E0E8FF",
          container: "#f4f7fa",
        },
        "tier-border": { input: "#DBEAFE" },
        "tier-text": {
          heading: "#1a2c44",
          body: "#404452",
          muted: "#697386",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        display: ['"Inter"', "-apple-system", "sans-serif"],
        serif: ['"Newsreader"', "Georgia", "Cambria", "Times New Roman", "serif"],
        mono: ['"Geist Mono"', '"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        display: "-0.02em",
        snug: "-0.01em",
      },
      borderRadius: {
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        hair: "0 0 0 1px rgba(13,15,17,.06)",
        sm: "0 1px 2px rgba(13,15,17,.06), 0 0 0 1px rgba(13,15,17,.04)",
        md: "0 4px 12px -2px rgba(13,15,17,.10), 0 0 0 1px rgba(13,15,17,.05)",
        pop: "0 12px 32px -8px rgba(13,15,17,.18)",
      },
      backgroundImage: {
        dots: "radial-gradient(circle, #D1D3D6 1px, transparent 1px)",
        hatch: "repeating-linear-gradient(45deg, #EEEFF1 0 1px, transparent 1px 7px)",
      },
      backgroundSize: {
        dots: "16px 16px",
        "dots-lg": "24px 24px",
      },
      keyframes: {
        dashflow: { to: { strokeDashoffset: "-20" } },
        pulsedot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        // pulso "radar" no nó em execução
        runpulse: {
          "0%,100%": { boxShadow: "0 0 0 1.5px #F5A300, 0 0 0 3px rgba(245,163,0,.22)" },
          "50%": { boxShadow: "0 0 0 1.5px #F5A300, 0 0 0 9px rgba(245,163,0,0)" },
        },
        // brilho verde do nó concluído (entrada)
        okpop: {
          "0%": { boxShadow: "0 0 0 1.5px #00D17E, 0 0 0 8px rgba(0,209,126,.0)" },
          "40%": { boxShadow: "0 0 0 1.5px #00D17E, 0 0 0 7px rgba(0,209,126,.22)" },
          "100%": { boxShadow: "0 0 0 1.5px #00D17E, 0 2px 10px -3px rgba(0,209,126,.28)" },
        },
        // dot viajando pelo conector
        travel: { "0%": { offsetDistance: "0%", opacity: "0" }, "12%": { opacity: "1" }, "88%": { opacity: "1" }, "100%": { offsetDistance: "100%", opacity: "0" } },
        // reveal on scroll
        revealup: { "0%": { opacity: "0", transform: "translateY(14px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        // fade in suave
        fadein: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        // border beam (Magic UI) — luz percorrendo a borda
        borderbeam: { "100%": { offsetDistance: "100%" } },
        // gradiente animado (shimmer text)
        gradientx: { "0%,100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        // rotação lenta (border beam por conic-gradient)
        spinslow: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        dashflow: "dashflow 0.7s linear infinite",
        pulsedot: "pulsedot 1.2s ease-in-out infinite",
        runpulse: "runpulse 1.4s ease-out infinite",
        okpop: "okpop 0.5s ease-out forwards",
        travel: "travel 1.1s ease-in-out infinite",
        revealup: "revealup 0.6s cubic-bezier(0.22,1,0.36,1) forwards",
        fadein: "fadein 0.5s ease-out forwards",
        borderbeam: "borderbeam 7s linear infinite",
        gradientx: "gradientx 5s ease infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;

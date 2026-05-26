import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tier brand (igual ecossistema)
        tier: {
          DEFAULT: "#003083",
          dark: "#002266",
          light: "#0050D5",
          pastel: "#8AAED4",
        },
        // Tier Personal palette (pastéis derivados Jeton-style)
        "tier-bg": {
          page: "#F0F4FF",
          input: "#EEF2FF",
          badge: "#E0E8FF",
          container: "#f4f7fa",
        },
        "tier-border": {
          input: "#DBEAFE",
        },
        "tier-text": {
          heading: "#1a2c44",
          body: "#404452",
          muted: "#697386",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;

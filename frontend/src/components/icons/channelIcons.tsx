import type { ComponentType } from "react";
import { MessageSquare } from "lucide-react";

// Ícones de canal (marca) — cores oficiais de cada plataforma.

export function WhatsAppIcon({ className }: { className?: string }) {
  // Logo oficial da marca — mesmo asset do ERP Tier Empresas › Integrações,
  // servido localmente em /whatsapp.svg (sem fundo, fundo transparente).
  return <img src="/whatsapp.svg" alt="WhatsApp" draggable={false} className={`object-contain ${className || ""}`} />;
}

// Slack — logo oficial 4-cores (viewBox 122.8).
export function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 122.8 122.8" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E" />
    </svg>
  );
}

// Discord — mascote oficial, blurple #5865F2.
export function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#5865F2"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"
      />
    </svg>
  );
}

// Telegram — avião oficial #229ED9.
export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#229ED9"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  );
}

// Instagram — câmera oficial (rosa #E4405F).
export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#E4405F"
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"
      />
    </svg>
  );
}

// Chat por link — canal de demonstração. Não é marca de terceiro, então usa o
// azul da Tier: janela de navegador com um balão dentro (= conversa por link).
export function WebchatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="1.7" y="3.3" width="20.6" height="17.4" rx="3" fill="none" stroke="#003083" strokeWidth="1.7" />
      <path d="M1.7 7.8h20.6" stroke="#003083" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4.7" cy="5.55" r="0.78" fill="#003083" />
      <rect x="6.4" y="10.9" width="11.2" height="5.6" rx="1.7" fill="#003083" />
      <path d="M9.5 16.1v3l3.1-3z" fill="#003083" />
    </svg>
  );
}

// E-mail — envelope neutro (usa currentColor pra herdar o tom do contexto).
export function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden fill="none" stroke="#6b7280" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="M3 6.5l9 6 9-6" />
    </svg>
  );
}

// Metadados por canal — nome amigável, descrição curta, ícone e cor de marca.
// Fonte única pra: seletor de canais, lista de conectores e modal de detalhes.
export const CHANNEL_META: Record<
  string,
  { name: string; short: string; Icon: ComponentType<{ className?: string }>; brand: string }
> = {
  webchat: { name: "Chat por link", short: "Link público de demonstração — sem app nem número", Icon: WebchatIcon, brand: "#003083" },
  whatsapp_cloud: { name: "WhatsApp Oficial", short: "API oficial Meta — sem QR, sem risco de ban", Icon: WhatsAppIcon, brand: "#25D366" },
  whatsapp: { name: "WhatsApp", short: "Baileys (QR) — pareia como um aparelho", Icon: WhatsAppIcon, brand: "#25D366" },
  slack: { name: "Slack", short: "Bot no seu workspace", Icon: SlackIcon, brand: "#611f69" },
  discord: { name: "Discord", short: "Bot em DMs e canais do servidor", Icon: DiscordIcon, brand: "#5865F2" },
  telegram: { name: "Telegram", short: "Bot via BotFather", Icon: TelegramIcon, brand: "#229ED9" },
  instagram: { name: "Instagram", short: "DMs da conta business", Icon: InstagramIcon, brand: "#E4405F" },
  email: { name: "E-mail", short: "Caixa de entrada do agente", Icon: MailIcon, brand: "#6b7280" },
};

// ChannelLogo — renderiza o logo da marca do canal (fallback neutro se desconhecido).
export function ChannelLogo({ kind, className }: { kind: string; className?: string }) {
  const M = CHANNEL_META[kind];
  if (M) return <M.Icon className={className} />;
  return <MessageSquare className={className} />;
}

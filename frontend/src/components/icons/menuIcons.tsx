import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

function MenuIconFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export function OverviewMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.4" />
      <rect x="8.5" y="2.5" width="5" height="11" rx="1.7" />
      <rect x="2.5" y="8.5" width="4.5" height="5" rx="1.4" />
    </MenuIconFrame>
  );
}

export function AttentionMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M8 3.25a3 3 0 0 0-3 3v2.15l-1 1.45h8l-1-1.45V6.25a3 3 0 0 0-3-3Z" />
      <path d="M6.75 12.05c.18.62.68.95 1.25.95s1.07-.33 1.25-.95" />
      <path d="M8 2v.75" />
    </MenuIconFrame>
  );
}

export function AgentsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="3" y="2.5" width="10" height="11" rx="3.2" />
      <circle cx="8" cy="6.25" r="1.65" />
      <path d="M5.9 10.4c.55-.72 1.23-1.1 2.1-1.1.87 0 1.55.38 2.1 1.1" />
      <path d="M11.8 4.45h1.15" />
    </MenuIconFrame>
  );
}

export function ConversationsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M3.25 4.25h6.9a1.75 1.75 0 0 1 1.75 1.75v3.05a1.75 1.75 0 0 1-1.75 1.75H7l-2.05 1.55V10.8H3.25A1.75 1.75 0 0 1 1.5 9.05V6a1.75 1.75 0 0 1 1.75-1.75Z" />
      <path d="M6 7.5h4.75" />
      <path d="M6 5.95h2.75" />
    </MenuIconFrame>
  );
}

export function LeadsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.25" />
      <path d="M5 10.5c.68-.82 1.56-1.25 2.7-1.25s2.02.43 2.7 1.25" />
      <circle cx="7.7" cy="6.1" r="1.55" />
      <path d="M11.15 4.1v2.35" />
      <path d="M9.98 5.28h2.35" />
    </MenuIconFrame>
  );
}

export function PlaybooksMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <circle cx="4" cy="3.75" r="1.25" />
      <circle cx="12" cy="8" r="1.25" />
      <circle cx="4" cy="12.25" r="1.25" />
      <path d="M5.25 3.75H8.1c1.15 0 2.1.94 2.1 2.1V6.6" />
      <path d="M5.25 12.25H8.1c1.15 0 2.1-.94 2.1-2.1V9.4" />
      <path d="M10.2 6.6V9.4" />
    </MenuIconFrame>
  );
}

export function MarketplaceMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M2.5 5.4h11" />
      <path d="M3.1 5.4 4 3h8l.9 2.4" />
      <path d="M3.25 5.4v6.85a1.25 1.25 0 0 0 1.25 1.25h7a1.25 1.25 0 0 0 1.25-1.25V5.4" />
      <path d="M6.05 8.2h3.9" />
    </MenuIconFrame>
  );
}

export function ChannelsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M5.4 4.2H4.1A1.6 1.6 0 0 0 2.5 5.8v4.4a1.6 1.6 0 0 0 1.6 1.6h1.3" />
      <path d="M10.6 4.2h1.3a1.6 1.6 0 0 1 1.6 1.6v4.4a1.6 1.6 0 0 1-1.6 1.6h-1.3" />
      <path d="M6.35 6.25h3.3v3.5h-3.3z" />
      <path d="M5.4 8h.95" />
      <path d="M9.65 8h.95" />
    </MenuIconFrame>
  );
}

export function KnowledgeMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M3 3.15h4.05c1.15 0 1.95.55 2.45 1.15.5-.6 1.3-1.15 2.45-1.15H13v9.7h-1.05c-1.2 0-1.95.3-2.45.75-.5-.45-1.25-.75-2.45-.75H3v-9.7Z" />
      <path d="M8.5 4.1v7.8" />
    </MenuIconFrame>
  );
}

export function LlmMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2.2" />
      <path d="M8 4.75v2.15" />
      <path d="M8 9.1v2.15" />
      <path d="M4.75 8h2.15" />
      <path d="M9.1 8h2.15" />
      <path d="M5.55 5.55 6.8 6.8" />
      <path d="M9.2 9.2 10.45 10.45" />
    </MenuIconFrame>
  );
}

export function IntegrationsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M6.15 6.15 4.6 7.7a1.9 1.9 0 0 0 0 2.7 1.9 1.9 0 0 0 2.7 0l1.55-1.55" />
      <path d="M9.85 9.85 11.4 8.3a1.9 1.9 0 0 0 0-2.7 1.9 1.9 0 0 0-2.7 0L7.15 7.15" />
      <path d="M6.55 8h2.9" />
    </MenuIconFrame>
  );
}

export function MacrosMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="m4 12 4.4-8.2 1.55 1.55L6.3 13.1 4 12Z" />
      <path d="m9.95 5.35 1.55 1.55" />
      <path d="M11.65 2.9v1.15" />
      <path d="M11.65 5.2v1.15" />
      <path d="M10.5 4.05h1.15" />
      <path d="M12.8 4.05h1.15" />
    </MenuIconFrame>
  );
}

export function FlagsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="2.5" y="5.15" width="11" height="5.7" rx="2.85" />
      <circle cx="5.35" cy="8" r="1.65" />
    </MenuIconFrame>
  );
}

export function ParamsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M3 4.35h10" />
      <path d="M3 8h10" />
      <path d="M3 11.65h10" />
      <circle cx="6.1" cy="4.35" r="1.15" />
      <circle cx="9.9" cy="8" r="1.15" />
      <circle cx="7.45" cy="11.65" r="1.15" />
    </MenuIconFrame>
  );
}

export function MetricsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <path d="M3 12.5V3.5" />
      <path d="M3 12.5h10" />
      <path d="M4.8 9.4 7.05 7.2l1.75 1.45 2.95-3.15" />
      <path d="M10.65 5.5h1.1v1.1" />
    </MenuIconFrame>
  );
}

export function ReportsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2" />
      <path d="M5.2 10.8V8.1" />
      <path d="M8 10.8V5.95" />
      <path d="M10.8 10.8V7.05" />
    </MenuIconFrame>
  );
}

export function BillingMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <rect x="2.5" y="4.1" width="11" height="7.8" rx="2" />
      <path d="M2.5 6.55h11" />
      <path d="M5.1 9.35h2.1" />
      <path d="M10.2 9.35h.95" />
    </MenuIconFrame>
  );
}

export function TeamMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <circle cx="6.15" cy="6.1" r="1.65" />
      <circle cx="10.55" cy="6.8" r="1.35" />
      <path d="M3.95 11.5c.65-.95 1.45-1.45 2.4-1.45.95 0 1.75.5 2.4 1.45" />
      <path d="M9.35 11.5c.4-.7.95-1.05 1.7-1.05.55 0 1.05.2 1.5.6" />
    </MenuIconFrame>
  );
}

export function SettingsMenuIcon({ className }: IconProps) {
  return (
    <MenuIconFrame className={className}>
      <circle cx="8" cy="8" r="1.9" />
      <path d="M8 1.6V3M8 13v1.4M14.4 8H13M3 8H1.6M12.53 3.47l-1 1M4.47 11.53l-1 1M12.53 12.53l-1-1M4.47 4.47l-1-1" />
    </MenuIconFrame>
  );
}

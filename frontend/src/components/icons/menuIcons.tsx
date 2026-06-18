import {
  Bell,
  BookOpen,
  Broadcast,
  ChartBar,
  ChartLineUp,
  ChatCircle,
  FlowArrow,
  GearSix,
  Robot,
  SquaresFour,
  Storefront,
  UserPlus,
} from "@phosphor-icons/react";

// Ícones do menu via Phosphor (peso "regular") — visual Attio/Linear: limpo, geométrico
// e consistente. Mantemos os mesmos nomes exportados, então o AdminLayout não muda.
// `currentColor` + className herdam a cor/opacidade/tamanho de quem renderiza.
type IconProps = { className?: string };

export const OverviewMenuIcon = ({ className }: IconProps) => <SquaresFour className={className} weight="regular" />;
export const AttentionMenuIcon = ({ className }: IconProps) => <Bell className={className} weight="regular" />;
export const AgentsMenuIcon = ({ className }: IconProps) => <Robot className={className} weight="regular" />;
export const ConversationsMenuIcon = ({ className }: IconProps) => <ChatCircle className={className} weight="regular" />;
export const LeadsMenuIcon = ({ className }: IconProps) => <UserPlus className={className} weight="regular" />;
export const PlaybooksMenuIcon = ({ className }: IconProps) => <FlowArrow className={className} weight="regular" />;
export const MarketplaceMenuIcon = ({ className }: IconProps) => <Storefront className={className} weight="regular" />;
export const ChannelsMenuIcon = ({ className }: IconProps) => <Broadcast className={className} weight="regular" />;
export const KnowledgeMenuIcon = ({ className }: IconProps) => <BookOpen className={className} weight="regular" />;
export const MetricsMenuIcon = ({ className }: IconProps) => <ChartLineUp className={className} weight="regular" />;
export const ReportsMenuIcon = ({ className }: IconProps) => <ChartBar className={className} weight="regular" />;
export const SettingsMenuIcon = ({ className }: IconProps) => <GearSix className={className} weight="regular" />;

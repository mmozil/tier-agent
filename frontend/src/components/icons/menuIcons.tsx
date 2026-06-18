import {
  Bell,
  BookOpen,
  Bot,
  ChartColumn,
  LayoutGrid,
  LineChart,
  MessageSquare,
  Radio,
  Settings,
  Store,
  UserPlus,
  Workflow,
} from "lucide-react";

// Ícones do menu via Lucide — a MESMA biblioteca que o Firecrawl usa na sidebar
// (markup deles: `lucide lucide-house/chart-column/settings/credit-card/users/bell`,
// stroke-width 2, 24×24). Mantemos stroke 2 pra ficar idêntico ao peso do Firecrawl e
// reusamos os ícones exatos deles nos conceitos equivalentes (Settings, CreditCard,
// Users, Bell, ChartColumn). Mesmos nomes exportados → AdminLayout não muda.
type IconProps = { className?: string };
const SW = 2;

export const OverviewMenuIcon = ({ className }: IconProps) => <LayoutGrid className={className} strokeWidth={SW} />;
export const AttentionMenuIcon = ({ className }: IconProps) => <Bell className={className} strokeWidth={SW} />;
export const AgentsMenuIcon = ({ className }: IconProps) => <Bot className={className} strokeWidth={SW} />;
export const ConversationsMenuIcon = ({ className }: IconProps) => <MessageSquare className={className} strokeWidth={SW} />;
export const LeadsMenuIcon = ({ className }: IconProps) => <UserPlus className={className} strokeWidth={SW} />;
export const PlaybooksMenuIcon = ({ className }: IconProps) => <Workflow className={className} strokeWidth={SW} />;
export const MarketplaceMenuIcon = ({ className }: IconProps) => <Store className={className} strokeWidth={SW} />;
export const ChannelsMenuIcon = ({ className }: IconProps) => <Radio className={className} strokeWidth={SW} />;
export const KnowledgeMenuIcon = ({ className }: IconProps) => <BookOpen className={className} strokeWidth={SW} />;
export const MetricsMenuIcon = ({ className }: IconProps) => <LineChart className={className} strokeWidth={SW} />;
export const ReportsMenuIcon = ({ className }: IconProps) => <ChartColumn className={className} strokeWidth={SW} />;
export const SettingsMenuIcon = ({ className }: IconProps) => <Settings className={className} strokeWidth={SW} />;

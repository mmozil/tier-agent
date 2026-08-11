import {
  Activity,
  ArrowLeftRight,
  Blocks,
  Bot,
  ChartColumn,
  Code,
  Inbox,
  ListOrdered,
  Workflow,
} from "lucide-react";

// Ícones dos flyouts do menu do site (marketing.tsx). Mesma biblioteca e mesmo peso
// de traço dos ícones do admin (`menuIcons.tsx`) pra a marca não mudar de linguagem
// entre o site e o produto. Um wrapper por conceito — assim trocar o glifo depois é
// um lugar só, e o marketing nunca importa Lucide direto.
type IconProps = { className?: string };
const SW = 2;

export const FlyoutInboxIcon = ({ className }: IconProps) => <Inbox className={className} strokeWidth={SW} />;
export const FlyoutAgentIcon = ({ className }: IconProps) => <Bot className={className} strokeWidth={SW} />;
export const FlyoutRelayIcon = ({ className }: IconProps) => <ArrowLeftRight className={className} strokeWidth={SW} />;
export const FlyoutIntegrationsIcon = ({ className }: IconProps) => <Blocks className={className} strokeWidth={SW} />;
export const FlyoutWorkflowIcon = ({ className }: IconProps) => <Workflow className={className} strokeWidth={SW} />;
export const FlyoutSequenceIcon = ({ className }: IconProps) => <ListOrdered className={className} strokeWidth={SW} />;
export const FlyoutHealthIcon = ({ className }: IconProps) => <Activity className={className} strokeWidth={SW} />;
export const FlyoutReportIcon = ({ className }: IconProps) => <ChartColumn className={className} strokeWidth={SW} />;
export const FlyoutDeveloperIcon = ({ className }: IconProps) => <Code className={className} strokeWidth={SW} />;

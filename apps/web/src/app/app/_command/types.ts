import type {
  PriorityItem,
  MomentumRecommendation,
  NudgeItem,
  FinancialPulse,
  FinancialAlert,
  AiBriefing,
  CampaignBriefing,
  CashFlowForecast,
  SimulationResult,
  AiChatResponse,
  GamificationStats,
} from "@/lib/client";

export type {
  PriorityItem,
  MomentumRecommendation,
  NudgeItem,
  FinancialPulse,
  FinancialAlert,
  AiBriefing,
  CampaignBriefing,
  CashFlowForecast,
  SimulationResult,
  AiChatResponse,
  GamificationStats,
};

export interface AutopilotTask {
  id: string;
  title: string;
  description?: string;
  category: string;
  priority: string;
  status: string;
  autoExecutable: boolean;
  requiresApproval: boolean;
}

export interface CriticalAlert {
  type: string;
  severity: string;
  message: string;
  action?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type TimeBucket = "now" | "today" | "this-week";

export interface UnifiedItem {
  id: string;
  type: "priority" | "task" | "momentum" | "nudge" | "alert" | "financial";
  bucket: TimeBucket;
  icon: string;
  title: string;
  context: string;
  urgencyColor: string;
  cta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  amount?: number;
}

export function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-TT", {
    style: "currency",
    currency: "TTD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

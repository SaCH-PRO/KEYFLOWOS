import type { FlowPendingConfirmation, FlowToolResult } from "@/lib/client";

export type CopilotModule =
  | "cockpit"
  | "crm"
  | "revenue"
  | "calendar"
  | "content"
  | "projects"
  | "expenses"
  | "flows"
  | "settings"
  | "store"
  | "profile"
  | "onboarding"
  | null;

export interface KeyChatAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string;
  objectPath?: string;
}

export interface KeyChatPlanStep {
  toolCallId: string;
  name: string;
  description: string;
  arguments: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "executing" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export interface KeyChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachments?: KeyChatAttachment[];
  pendingConfirmations?: FlowPendingConfirmation[];
  plan?: KeyChatPlanStep[];
  toolResults?: FlowToolResult[];
  card?: OnboardingCardData;
  requiresConfirmation?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
}

export interface KeyChatSession {
  id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
}

export type KeyChatStatus = "idle" | "loading" | "streaming" | "error";

export type OnboardingStep =
  | "welcome"
  | "intake"
  | "genesis"
  | "template"
  | "configure"
  | "genome"
  | "complete";

export type OnboardingCardType =
  | "welcome"
  | "genesis-idea"
  | "genesis-questions"
  | "readiness-dashboard"
  | "template-picker"
  | "genome-check"
  | "completion-gate"
  | "profile-identity"
  | "operating-model"
  | "brand-goals"
  | "financials"
  | "ownership-legal"
  | "operations"
  | "market-strategy"
  | "payments-storefront-contacts"
  | "risk-compliance-roadmap";

export interface OnboardingCardData {
  type: OnboardingCardType;
  title?: string;
  step?: string;
  data?: Record<string, unknown>;
}

export interface KeyChatPageContext {
  route?: string;
  surface?: "page" | "modal" | "drawer" | "widget";
  mode?: "onboarding";
  onboardingStep?: OnboardingStep;
  focusedItem?: { type: string; id?: string; name?: string };
  hints?: string[];
  [key: string]: unknown;
}

export interface KeyChatState {
  open: boolean;
  activeSessionId: string | null;
  sessions: KeyChatSession[];
  messages: KeyChatMessage[];
  input: string;
  attachments: KeyChatAttachment[];
  status: KeyChatStatus;
  currentModule?: CopilotModule;
  pageContext?: KeyChatPageContext;
  error?: string;
}

export type KeyChatMode = "general" | "genome_onboarding" | "executive" | "finance" | "sales" | "operations";

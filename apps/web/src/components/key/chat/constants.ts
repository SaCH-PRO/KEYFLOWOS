import type { CopilotModule } from "./types";

export const MODULE_LABELS: Record<NonNullable<CopilotModule>, { label: string; color: string }> = {
  cockpit: { label: "Command Center", color: "text-orange-400" },
  crm: { label: "CRM", color: "text-blue-400" },
  revenue: { label: "Revenue", color: "text-emerald-400" },
  calendar: { label: "Calendar", color: "text-purple-400" },
  content: { label: "Content", color: "text-pink-400" },
  projects: { label: "Projects", color: "text-cyan-400" },
  expenses: { label: "Expenses", color: "text-amber-400" },
  flows: { label: "Automations", color: "text-teal-400" },
  settings: { label: "Settings", color: "text-slate-400" },
  store: { label: "Storefront", color: "text-rose-400" },
  profile: { label: "Profile", color: "text-indigo-400" },
  onboarding: { label: "Onboarding", color: "text-violet-400" },
};

export const DEFAULT_GREETING = "Hi, I'm KEY. What would you like to work on?";

export const QUICK_ACTIONS = [
  { label: "What should I focus on?", prompt: "What should I focus on today?" },
  { label: "Cash flow snapshot", prompt: "Give me a cash flow snapshot for the last 30 days." },
  { label: "Business growth", prompt: "Show me my business growth over the last 2 years." },
  { label: "Digitize a document", prompt: "I want to upload a document and digitize it into KEYFLOWOS." },
];

export const SUGGESTION_POLL_INTERVAL_MS = 5000;

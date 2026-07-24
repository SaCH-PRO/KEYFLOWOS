"use client";

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { QuickAction } from "@/components/ui-v2/quick-action";
import { Zap, FileText, Calendar, BarChart3, Dna, Shield, TrendingUp, Users, Settings } from "lucide-react";

export interface ActionChip {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "accent";
}

const MODE_CHIPS: Record<string, Array<{ id: string; label: string; icon: LucideIcon; variant: ActionChip["variant"]; prompt: string }>> = {
  general: [
    { id: "task", label: "Create Task", icon: Zap, variant: "accent", prompt: "Create a task for me based on my current priorities" },
    { id: "email", label: "Draft Email", icon: FileText, variant: "default", prompt: "Draft a professional email" },
    { id: "schedule", label: "Schedule", icon: Calendar, variant: "default", prompt: "Help me schedule my week" },
    { id: "analytics", label: "Analytics", icon: BarChart3, variant: "accent", prompt: "Show me business analytics" },
  ],
  genome_onboarding: [
    { id: "dna", label: "Review DNA", icon: Dna, variant: "accent", prompt: "Review my business DNA profile" },
    { id: "stage", label: "Stage Check", icon: Shield, variant: "default", prompt: "What stage is my business at?" },
    { id: "integrity", label: "Integrity", icon: TrendingUp, variant: "accent", prompt: "Check my genome integrity score" },
    { id: "roadmap", label: "Roadmap", icon: BarChart3, variant: "default", prompt: "Show my business roadmap" },
  ],
  executive: [
    { id: "decisions", label: "Decisions", icon: Shield, variant: "accent", prompt: "What decisions need my attention?" },
    { id: "strategy", label: "Strategy", icon: TrendingUp, variant: "default", prompt: "Review strategic priorities" },
    { id: "team", label: "Team", icon: Users, variant: "default", prompt: "Team status overview" },
    { id: "kpi", label: "KPIs", icon: BarChart3, variant: "accent", prompt: "Show key performance indicators" },
  ],
  finance: [
    { id: "cashflow", label: "Cash Flow", icon: TrendingUp, variant: "accent", prompt: "Analyze cash flow" },
    { id: "forecast", label: "Forecast", icon: BarChart3, variant: "default", prompt: "Financial forecast" },
    { id: "expenses", label: "Expenses", icon: FileText, variant: "default", prompt: "Review expenses" },
    { id: "budget", label: "Budget", icon: Calendar, variant: "accent", prompt: "Budget analysis" },
  ],
  sales: [
    { id: "pipeline", label: "Pipeline", icon: TrendingUp, variant: "accent", prompt: "Sales pipeline status" },
    { id: "leads", label: "Leads", icon: Users, variant: "default", prompt: "Lead generation status" },
    { id: "deals", label: "Deals", icon: Zap, variant: "default", prompt: "Active deals overview" },
    { id: "targets", label: "Targets", icon: BarChart3, variant: "accent", prompt: "Sales targets progress" },
  ],
  operations: [
    { id: "tasks", label: "Tasks", icon: Zap, variant: "accent", prompt: "Task queue status" },
    { id: "process", label: "Process", icon: Settings, variant: "default", prompt: "Process optimization" },
    { id: "inventory", label: "Inventory", icon: FileText, variant: "default", prompt: "Inventory status" },
    { id: "schedule", label: "Schedule", icon: Calendar, variant: "accent", prompt: "Operations schedule" },
  ],
};

export function KeyActionChips() {
  const { chatMode, status } = useKeyChat();
  const { sendMessage } = useKeyChatActions();
  const isLoading = status === "streaming" || status === "loading";

  const chips = useMemo(() => {
    const mode = chatMode ?? "general";
    const defs = MODE_CHIPS[mode] ?? MODE_CHIPS.general;
    return defs.map((d) => ({
      ...d,
      onClick: () => {
        if (isLoading) return;
        void sendMessage(d.prompt);
      },
    }));
  }, [chatMode, isLoading, sendMessage]);

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <QuickAction
          key={chip.id}
          icon={chip.icon}
          label={chip.label}
          variant={chip.variant}
          onClick={chip.onClick}
          disabled={isLoading}
          className="text-xs"
        />
      ))}
    </div>
  );
}

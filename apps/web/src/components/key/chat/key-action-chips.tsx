"use client";

import { useCallback, useMemo } from "react";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { cn } from "@/lib/utils";
import { Zap, FileText, Calendar, BarChart3, Dna, Shield, TrendingUp, Users, Settings } from "lucide-react";

export interface ActionChip {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
}

const MODE_CHIPS: Record<string, Array<{ id: string; label: string; icon: React.ReactNode; variant: ActionChip["variant"]; prompt: string }>> = {
  general: [
    { id: "task", label: "Create Task", icon: <Zap className="w-3 h-3" />, variant: "primary", prompt: "Create a task for me based on my current priorities" },
    { id: "email", label: "Draft Email", icon: <FileText className="w-3 h-3" />, variant: "default", prompt: "Draft a professional email" },
    { id: "schedule", label: "Schedule", icon: <Calendar className="w-3 h-3" />, variant: "default", prompt: "Help me schedule my week" },
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-3 h-3" />, variant: "success", prompt: "Show me business analytics" },
  ],
  genome_onboarding: [
    { id: "dna", label: "Review DNA", icon: <Dna className="w-3 h-3" />, variant: "primary", prompt: "Review my business DNA profile" },
    { id: "stage", label: "Stage Check", icon: <Shield className="w-3 h-3" />, variant: "default", prompt: "What stage is my business at?" },
    { id: "integrity", label: "Integrity", icon: <TrendingUp className="w-3 h-3" />, variant: "success", prompt: "Check my genome integrity score" },
    { id: "roadmap", label: "Roadmap", icon: <BarChart3 className="w-3 h-3" />, variant: "default", prompt: "Show my business roadmap" },
  ],
  executive: [
    { id: "decisions", label: "Decisions", icon: <Shield className="w-3 h-3" />, variant: "primary", prompt: "What decisions need my attention?" },
    { id: "strategy", label: "Strategy", icon: <TrendingUp className="w-3 h-3" />, variant: "default", prompt: "Review strategic priorities" },
    { id: "team", label: "Team", icon: <Users className="w-3 h-3" />, variant: "default", prompt: "Team status overview" },
    { id: "kpi", label: "KPIs", icon: <BarChart3 className="w-3 h-3" />, variant: "success", prompt: "Show key performance indicators" },
  ],
  finance: [
    { id: "cashflow", label: "Cash Flow", icon: <TrendingUp className="w-3 h-3" />, variant: "primary", prompt: "Analyze cash flow" },
    { id: "forecast", label: "Forecast", icon: <BarChart3 className="w-3 h-3" />, variant: "default", prompt: "Financial forecast" },
    { id: "expenses", label: "Expenses", icon: <FileText className="w-3 h-3" />, variant: "default", prompt: "Review expenses" },
    { id: "budget", label: "Budget", icon: <Calendar className="w-3 h-3" />, variant: "success", prompt: "Budget analysis" },
  ],
  sales: [
    { id: "pipeline", label: "Pipeline", icon: <TrendingUp className="w-3 h-3" />, variant: "primary", prompt: "Sales pipeline status" },
    { id: "leads", label: "Leads", icon: <Users className="w-3 h-3" />, variant: "default", prompt: "Lead generation status" },
    { id: "deals", label: "Deals", icon: <Zap className="w-3 h-3" />, variant: "default", prompt: "Active deals overview" },
    { id: "targets", label: "Targets", icon: <BarChart3 className="w-3 h-3" />, variant: "success", prompt: "Sales targets progress" },
  ],
  operations: [
    { id: "tasks", label: "Tasks", icon: <Zap className="w-3 h-3" />, variant: "primary", prompt: "Task queue status" },
    { id: "process", label: "Process", icon: <Settings className="w-3 h-3" />, variant: "default", prompt: "Process optimization" },
    { id: "inventory", label: "Inventory", icon: <FileText className="w-3 h-3" />, variant: "default", prompt: "Inventory status" },
    { id: "schedule", label: "Schedule", icon: <Calendar className="w-3 h-3" />, variant: "success", prompt: "Operations schedule" },
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
        <button
          key={chip.id}
          onClick={chip.onClick}
          disabled={isLoading}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
            isLoading && "opacity-50 cursor-not-allowed",
            chip.variant === "primary" && "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20",
            chip.variant === "success" && "bg-green-500/10 text-green-600 hover:bg-green-500/20",
            chip.variant === "warning" && "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20",
            chip.variant === "danger" && "bg-red-500/10 text-red-600 hover:bg-red-500/20",
            (!chip.variant || chip.variant === "default") && "bg-gray-500/10 text-gray-600 hover:bg-gray-500/20"
          )}
        >
          {chip.icon}
          {chip.label}
        </button>
      ))}
    </div>
  );
}

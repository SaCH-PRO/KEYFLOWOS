"use client";

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import type { LauncherTone } from "@/components/ui/module-launcher-sheet";
import {
  Zap,
  FileText,
  Calendar,
  BarChart3,
  Dna,
  Shield,
  TrendingUp,
  Users,
  Settings,
} from "lucide-react";

export interface ActionCard {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: LauncherTone;
  prompt: string;
}

const TONE_CLASSES: Record<LauncherTone, { bg: string; text: string }> = {
  default: { bg: "bg-muted/50", text: "text-muted-foreground" },
  primary: { bg: "bg-primary/10", text: "text-primary" },
  violet: { bg: "bg-violet/10", text: "text-violet" },
  gold: { bg: "bg-gold/10", text: "text-gold" },
  rose: { bg: "bg-rose/10", text: "text-rose" },
  mint: { bg: "bg-mint/10", text: "text-mint" },
  sky: { bg: "bg-sky/10", text: "text-sky" },
  orange: { bg: "bg-primary/10", text: "text-primary" },
  teal: { bg: "bg-secondary/10", text: "text-secondary" },
};

const MODE_CARDS: Record<string, ActionCard[]> = {
  general: [
    {
      id: "task",
      label: "Create Task",
      description: "Add a task from your priorities",
      icon: Zap,
      tone: "gold",
      prompt: "Create a task for me based on my current priorities",
    },
    {
      id: "email",
      label: "Draft Email",
      description: "Write a professional email",
      icon: FileText,
      tone: "orange",
      prompt: "Draft a professional email",
    },
    {
      id: "schedule",
      label: "Schedule",
      description: "Plan your week",
      icon: Calendar,
      tone: "mint",
      prompt: "Help me schedule my week",
    },
    {
      id: "analytics",
      label: "Analytics",
      description: "See business metrics",
      icon: BarChart3,
      tone: "teal",
      prompt: "Show me business analytics",
    },
  ],
  genome_onboarding: [
    {
      id: "dna",
      label: "Review DNA",
      description: "Check your DNA profile",
      icon: Dna,
      tone: "orange",
      prompt: "Review my business DNA profile",
    },
    {
      id: "stage",
      label: "Stage Check",
      description: "Where you stand",
      icon: Shield,
      tone: "mint",
      prompt: "What stage is my business at?",
    },
    {
      id: "integrity",
      label: "Integrity",
      description: "Genome health score",
      icon: TrendingUp,
      tone: "gold",
      prompt: "Check my genome integrity score",
    },
    {
      id: "roadmap",
      label: "Roadmap",
      description: "Next milestones",
      icon: BarChart3,
      tone: "teal",
      prompt: "Show my business roadmap",
    },
  ],
  executive: [
    {
      id: "decisions",
      label: "Decisions",
      description: "What needs you",
      icon: Shield,
      tone: "orange",
      prompt: "What decisions need my attention?",
    },
    {
      id: "strategy",
      label: "Strategy",
      description: "Strategic priorities",
      icon: TrendingUp,
      tone: "mint",
      prompt: "Review strategic priorities",
    },
    {
      id: "team",
      label: "Team",
      description: "Team status",
      icon: Users,
      tone: "teal",
      prompt: "Team status overview",
    },
    {
      id: "kpi",
      label: "KPIs",
      description: "Key performance",
      icon: BarChart3,
      tone: "gold",
      prompt: "Show key performance indicators",
    },
  ],
  finance: [
    {
      id: "cashflow",
      label: "Cash Flow",
      description: "Analyze cash flow",
      icon: TrendingUp,
      tone: "mint",
      prompt: "Analyze cash flow",
    },
    {
      id: "forecast",
      label: "Forecast",
      description: "Financial outlook",
      icon: BarChart3,
      tone: "teal",
      prompt: "Financial forecast",
    },
    {
      id: "expenses",
      label: "Expenses",
      description: "Review spend",
      icon: FileText,
      tone: "gold",
      prompt: "Review expenses",
    },
    {
      id: "budget",
      label: "Budget",
      description: "Budget analysis",
      icon: Calendar,
      tone: "orange",
      prompt: "Budget analysis",
    },
  ],
  sales: [
    {
      id: "pipeline",
      label: "Pipeline",
      description: "Sales status",
      icon: TrendingUp,
      tone: "mint",
      prompt: "Sales pipeline status",
    },
    {
      id: "leads",
      label: "Leads",
      description: "Lead generation",
      icon: Users,
      tone: "orange",
      prompt: "Lead generation status",
    },
    {
      id: "deals",
      label: "Deals",
      description: "Active deals",
      icon: Zap,
      tone: "gold",
      prompt: "Active deals overview",
    },
    {
      id: "targets",
      label: "Targets",
      description: "Progress to goal",
      icon: BarChart3,
      tone: "teal",
      prompt: "Sales targets progress",
    },
  ],
  operations: [
    {
      id: "tasks",
      label: "Tasks",
      description: "Task queue",
      icon: Zap,
      tone: "gold",
      prompt: "Task queue status",
    },
    {
      id: "process",
      label: "Process",
      description: "Optimization",
      icon: Settings,
      tone: "orange",
      prompt: "Process optimization",
    },
    {
      id: "inventory",
      label: "Inventory",
      description: "Stock status",
      icon: FileText,
      tone: "mint",
      prompt: "Inventory status",
    },
    {
      id: "schedule",
      label: "Schedule",
      description: "Ops schedule",
      icon: Calendar,
      tone: "teal",
      prompt: "Operations schedule",
    },
  ],
};

export function KeyActionGrid() {
  const { chatMode, status } = useKeyChat();
  const { sendMessage } = useKeyChatActions();
  const isLoading = status === "streaming" || status === "loading";

  const cards = useMemo(() => {
    const mode = chatMode ?? "general";
    return MODE_CARDS[mode] ?? MODE_CARDS.general;
  }, [chatMode]);

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const tone = TONE_CLASSES[card.tone];
        return (
          <motion.button
            key={card.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04, duration: 0.2 }}
            disabled={isLoading}
            onClick={() => {
              if (isLoading) return;
              void sendMessage(card.prompt);
            }}
            className="flex flex-col items-start gap-2 rounded-xl border border-border/40 bg-card/40 p-3 text-left transition-colors hover:bg-card/80 hover:border-border/60 disabled:opacity-50"
          >
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", tone.bg)}>
              <Icon className={cn("h-3.5 w-3.5", tone.text)} />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{card.label}</div>
              <div className="text-[10px] text-muted-foreground leading-snug">{card.description}</div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

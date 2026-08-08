"use client";

import { LayoutGrid, Dna, Shield, TrendingUp, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyChatMode } from "./types";

const MODES: { id: KeyChatMode; label: string; icon: React.ElementType; tone: string }[] = [
  { id: "general", label: "General", icon: LayoutGrid, tone: "text-primary" },
  { id: "genome_onboarding", label: "Genome", icon: Dna, tone: "text-violet" },
  { id: "executive", label: "Executive", icon: Shield, tone: "text-gold" },
  { id: "finance", label: "Finance", icon: TrendingUp, tone: "text-mint" },
  { id: "sales", label: "Sales", icon: Users, tone: "text-orange" },
  { id: "operations", label: "Operations", icon: Settings, tone: "text-sky" },
];

interface KeyChatModeTabsProps {
  mode: KeyChatMode;
  onChange: (mode: KeyChatMode) => void;
  className?: string;
}

export function KeyChatModeTabs({ mode, onChange, className }: KeyChatModeTabsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border/30 overflow-x-auto scrollbar-hide",
        className,
      )}
      role="tablist"
      aria-label="KEY Chat mode"
    >
      {MODES.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
              isActive
                ? "bg-card text-foreground shadow-sm border border-border/40"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Icon className={cn("w-3.5 h-3.5", isActive ? m.tone : "text-muted-foreground")} />
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

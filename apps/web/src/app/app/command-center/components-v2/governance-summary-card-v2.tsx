"use client";

import { Shield, CheckCircle2, AlertCircle, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import type { GovernanceSummary } from "@/lib/api/business-command-center";

interface GovernanceSummaryCardV2Props {
  governance: GovernanceSummary;
  className?: string;
}

export function GovernanceSummaryCardV2({ governance, className }: GovernanceSummaryCardV2Props) {
  const tiles = [
    { label: "Auto-Ready", value: governance.autoReady, icon: CheckCircle2, color: "text-mint", bg: "bg-mint/10" },
    { label: "Needs Approval", value: governance.needsApproval, icon: Shield, color: "text-gold-foreground", bg: "bg-gold/15" },
    { label: "Due Today", value: governance.dueToday, icon: AlertCircle, color: "text-sky", bg: "bg-sky/10" },
    { label: "Urgent Risks", value: governance.urgentRisks, icon: Flame, color: "text-rose", bg: "bg-rose/10" },
  ];

  return (
    <Surface className={cn("p-5", className)}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10">
          <Shield className="h-3.5 w-3.5 text-violet" />
        </div>
        <h3 className="font-display text-sm font-semibold text-foreground">Governance Summary</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-2xl border border-border/40 p-3 flex flex-col items-center justify-center text-center"
          >
            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center mb-2", tile.bg)}>
              <tile.icon className={cn("w-4 h-4", tile.color)} />
            </div>
            <p className="text-xl font-display font-bold text-foreground">{tile.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{tile.label}</p>
          </div>
        ))}
      </div>
    </Surface>
  );
}

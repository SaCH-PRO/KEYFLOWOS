"use client";

import { Shield, CheckCircle2, AlertCircle, Flame } from "lucide-react";
import type { GovernanceSummary } from "@/lib/api/business-command-center";

interface GovernanceSummaryCardProps {
  governance: GovernanceSummary;
  className?: string;
}

export function GovernanceSummaryCard({ governance, className = "" }: GovernanceSummaryCardProps) {
  const tiles = [
    { label: "Auto-Ready", value: governance.autoReady, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-500/10" },
    { label: "Needs Approval", value: governance.needsApproval, icon: Shield, color: "text-amber-600", bg: "bg-amber-500/10" },
    { label: "Due Today", value: governance.dueToday, icon: AlertCircle, color: "text-blue-600", bg: "bg-blue-500/10" },
    { label: "Urgent Risks", value: governance.urgentRisks, icon: Flame, color: "text-red-600", bg: "bg-red-500/10" },
  ];

  return (
    <div className={`kf-card kf-radius-lg p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <h3 className="text-sm font-semibold">Governance Summary</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-border/40 p-3 flex flex-col items-center justify-center text-center"
          >
            <div className={`w-8 h-8 rounded-full ${tile.bg} flex items-center justify-center mb-2`}>
              <tile.icon className={`w-4 h-4 ${tile.color}`} />
            </div>
            <p className="text-xl font-bold">{tile.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{tile.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

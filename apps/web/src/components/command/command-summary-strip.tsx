"use client";

import { Zap, ShieldAlert, Bot, ListTodo } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import type { CommandSummary } from "@/lib/api/command";

interface CommandSummaryStripProps {
  summary: CommandSummary;
  className?: string;
}

export function CommandSummaryStrip({ summary, className = "" }: CommandSummaryStripProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 ${className}`}>
      <MetricCard
        label="Open Commands"
        value={summary.open}
        icon={ListTodo}
        iconColor="hsl(var(--kf-accent1))"
      />
      <MetricCard
        label="Needs Approval"
        value={summary.waitingApproval}
        icon={ShieldAlert}
        iconColor="hsl(var(--kf-destructive))"
      />
      <MetricCard
        label="KEY Can Handle"
        value={summary.executableByKey}
        icon={Bot}
        iconColor="hsl(var(--kf-accent2))"
      />
      <MetricCard
        label="Total Categories"
        value={summary.byCategory.length}
        icon={Zap}
        iconColor="hsl(var(--kf-success))"
      />
    </div>
  );
}

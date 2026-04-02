"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/currency";
import { InfoBadge } from "@/components/ui/info-badge";

interface CashFlowSummaryProps {
  totalReceived: number;
  totalPending: number;
  totalOverdue: number;
  currency: string;
}

export function CashFlowSummary({ totalReceived, totalPending, totalOverdue, currency }: CashFlowSummaryProps) {
  const netFlow = useMemo(() => totalReceived - totalPending - totalOverdue, [totalReceived, totalPending, totalOverdue]);
  const isPositive = netFlow >= 0;

  return (
    <div className={`rounded-xl border p-3 ${
      isPositive ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
    }`}>
      <div className="flex items-center gap-1.5 mb-1">
        {isPositive ? (
          <TrendingUp className="w-3 h-3 text-emerald-400" />
        ) : (
          <TrendingDown className="w-3 h-3 text-red-400" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
          Net Cash Flow
        </span>
        <InfoBadge
          title="Net Cash Flow"
          body="Received payments minus outstanding (pending + overdue). Positive = healthy. Negative = more money is owed to you than collected."
          side="bottom"
          iconSize={10}
        />
      </div>
      <p className={`text-lg font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
        {isPositive ? "+" : ""}{formatCurrencyCompact(netFlow, currency)}
      </p>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/50">
        <span className="text-emerald-400">{formatCurrencyCompact(totalReceived, currency)}</span>
        <ArrowRight className="w-2.5 h-2.5" />
        <span className="text-amber-400">-{formatCurrencyCompact(totalPending, currency)}</span>
        <ArrowRight className="w-2.5 h-2.5" />
        <span className="text-red-400">-{formatCurrencyCompact(totalOverdue, currency)}</span>
      </div>
    </div>
  );
}

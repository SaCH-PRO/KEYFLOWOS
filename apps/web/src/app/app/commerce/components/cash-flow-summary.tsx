"use client";

import { useMemo } from "react";
import { TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/currency";
import { InfoBadge } from "@/components/ui/info-badge";

interface CashFlowSummaryProps {
  totalReceived: number;
  totalPending: number;
  totalOverdue: number;
  currency: string;
  draftCount?: number;
  pendingCount?: number;
  overdueCount?: number;
  avgPaymentDelay?: number;
}

export function CashFlowSummary({
  totalReceived,
  totalPending,
  totalOverdue,
  currency,
  draftCount = 0,
  pendingCount = 0,
  overdueCount = 0,
  avgPaymentDelay = 0,
}: CashFlowSummaryProps) {
  const netFlow = useMemo(() => totalReceived - totalPending - totalOverdue, [totalReceived, totalPending, totalOverdue]);
  const isPositive = netFlow >= 0;
  const collectible = totalPending + totalOverdue;

  const healthMessage = useMemo(() => {
    if (totalOverdue > 0 && overdueCount > 0) {
      return `${formatCurrencyCompact(totalOverdue, currency)} overdue from ${overdueCount} invoice${overdueCount !== 1 ? "s" : ""} — follow up to recover`;
    }
    if (totalPending > 0 && pendingCount > 0) {
      return `${formatCurrencyCompact(totalPending, currency)} collectible from ${pendingCount} pending invoice${pendingCount !== 1 ? "s" : ""}`;
    }
    if (draftCount > 0) {
      return `${draftCount} draft invoice${draftCount !== 1 ? "s" : ""} not yet sent — send to start collecting`;
    }
    if (isPositive && totalReceived > 0) {
      return "Collections healthy — no overdue invoices";
    }
    return "No collection activity yet";
  }, [totalOverdue, totalPending, overdueCount, pendingCount, draftCount, isPositive, totalReceived, currency]);

  return (
    <div className={`rounded-xl border p-3 ${
      totalOverdue > 0 ? "border-red-500/20 bg-red-500/5" : isPositive ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"
    }`}>
      <div className="flex items-center gap-1.5 mb-1">
        {totalOverdue > 0 ? (
          <AlertTriangle className="w-3 h-3 text-red-400" />
        ) : isPositive && totalReceived > 0 ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        ) : (
          <TrendingUp className="w-3 h-3 text-amber-400" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
          Collections Health
        </span>
        <InfoBadge
          title="Collections Health"
          body="Shows your collection status: collectible now, overdue exposure, average payment delay, and invoices awaiting action. Positive net = more collected than outstanding."
          side="bottom"
          iconSize={10}
        />
      </div>
      <p className={`text-lg font-bold ${totalOverdue > 0 ? "text-red-400" : isPositive ? "text-emerald-400" : "text-amber-400"}`}>
        {isPositive ? "+" : ""}{formatCurrencyCompact(netFlow, currency)}
      </p>
      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{healthMessage}</p>
      <div className="flex items-center gap-3 mt-2 text-[10px]">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-emerald-400 font-medium">{formatCurrencyCompact(totalReceived, currency)} received</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-amber-400 font-medium">{formatCurrencyCompact(totalPending, currency)} pending</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-red-400 font-medium">{formatCurrencyCompact(totalOverdue, currency)} overdue</span>
        </div>
      </div>
      {(draftCount > 0 || avgPaymentDelay > 0) && (
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/50">
          {draftCount > 0 && (
            <span>{draftCount} draft{draftCount !== 1 ? "s" : ""} unsent</span>
          )}
          {avgPaymentDelay > 0 && (
            <span>Avg delay: {avgPaymentDelay}d</span>
          )}
        </div>
      )}
    </div>
  );
}

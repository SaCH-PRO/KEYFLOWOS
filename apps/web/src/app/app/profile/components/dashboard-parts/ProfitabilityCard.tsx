"use client";

import { motion } from "framer-motion";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Metrics, formatTTD, fadeUp } from "./types";

function MetricItem({
  label, value, isNegative, trend,
}: {
  label: string;
  value: string;
  isNegative?: boolean;
  trend: "up" | "down" | undefined;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <span className={`text-sm font-semibold ${isNegative ? "text-red-400" : ""}`}>{value}</span>
        {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-400" />}
        {trend === "down" && <TrendingDown className="w-3 h-3 text-red-400" />}
      </div>
    </div>
  );
}

export function ProfitabilityCard({ metrics }: { metrics: Metrics | null }) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <DollarSign className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Profitability
      </div>
      {metrics ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricItem label="Monthly Revenue" value={formatTTD(metrics.monthlyRevenueEstimate as number)} trend={undefined} />
            <MetricItem label="Gross Profit" value={formatTTD(metrics.grossProfit as number)} trend={undefined} />
            <MetricItem label="Operating Costs" value={formatTTD(metrics.totalMonthlyOperatingCosts as number)} trend={undefined} />
            <MetricItem
              label="Net Profit"
              value={formatTTD(metrics.netOperatingProfit as number)}
              isNegative={typeof metrics.netOperatingProfit === "number" && metrics.netOperatingProfit < 0}
              trend={undefined}
            />
            <MetricItem label="Break-even Volume" value={metrics.breakEvenVolume != null ? `${metrics.breakEvenVolume} units` : "N/A"} trend={undefined} />
            <MetricItem label="Break-even Revenue" value={formatTTD(metrics.breakEvenRevenue as number)} trend={undefined} />
          </div>
          {metrics.contributionMarginPct != null && (
            <div className="pt-2 border-t border-border/20">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Contribution Margin:</span>
                <span className={`text-xs font-semibold ${
                  (metrics.contributionMarginPct ?? 0) >= 50 ? "text-emerald-400" : (metrics.contributionMarginPct ?? 0) >= 20 ? "text-amber-400" : "text-red-400"
                }`}>
                  {metrics.contributionMarginPct?.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
          {metrics.runwayMonths != null && (
            <div className={`pt-2 ${metrics.contributionMarginPct == null ? "border-t border-border/20" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Runway:</span>
                <span className={`text-xs font-semibold ${
                  (metrics.runwayMonths ?? 0) > 12 ? "text-emerald-400" : (metrics.runwayMonths ?? 0) > 6 ? "text-amber-400" : "text-red-400"
                }`}>
                  {metrics.runwayLabel || `${metrics.runwayMonths} months`}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Financial metrics will appear once cost and revenue data is provided in your profile.</p>
      )}
    </motion.div>
  );
}

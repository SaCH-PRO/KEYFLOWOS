"use client";

import { motion } from "framer-motion";
import { TrendingUp, PiggyBank, CalendarDays } from "lucide-react";
import type { GenesisActionPlan, BlueprintData } from "@/lib/blueprint-types";

interface GenesisProjectionCardProps {
  actionPlan: GenesisActionPlan;
  blueprint?: BlueprintData | null;
}

function formatCurrency(value: number | undefined, currency = "TTD"): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "Profitable / self-sustaining";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function GenesisProjectionCard({ actionPlan, blueprint }: GenesisProjectionCardProps) {
  const projection = blueprint?.projectionProfile;
  const currency = blueprint?.financials?.currency || "TTD";

  const breakEvenRevenue = actionPlan.breakEvenRevenue ?? projection?.breakEvenRevenue;
  const runwayMonths = actionPlan.projectedRunwayMonths ?? projection?.runwayMonths;

  const baseMonthlyRevenue = projection?.avgTicket && projection?.expectedMonthlyUnits
    ? projection.avgTicket * projection.expectedMonthlyUnits
    : undefined;
  const conservativeMonthlyRevenue = projection?.avgTicket && projection?.conservativeMonthlyUnits
    ? projection.avgTicket * projection.conservativeMonthlyUnits
    : projection?.avgTicket && projection?.expectedMonthlyUnits
      ? projection.avgTicket * Math.floor(projection.expectedMonthlyUnits * 0.7)
      : undefined;
  const aggressiveMonthlyRevenue = projection?.avgTicket && projection?.expectedMonthlyUnits
    ? projection.avgTicket * Math.floor(projection.expectedMonthlyUnits * 1.3)
    : undefined;

  const metrics = [
    {
      icon: <TrendingUp className="w-4 h-4" />,
      label: "Break-even revenue",
      value: formatCurrency(breakEvenRevenue, currency),
    },
    {
      icon: <CalendarDays className="w-4 h-4" />,
      label: "Runway",
      value:
        runwayMonths === undefined || runwayMonths === null
          ? "—"
          : Number.isFinite(runwayMonths)
            ? `${runwayMonths} month${runwayMonths === 1 ? "" : "s"}`
            : "Profitable / self-sustaining",
    },
    {
      icon: <PiggyBank className="w-4 h-4" />,
      label: "Base monthly revenue",
      value: formatCurrency(baseMonthlyRevenue, currency),
    },
    {
      icon: <PiggyBank className="w-4 h-4" />,
      label: "Conservative monthly",
      value: formatCurrency(conservativeMonthlyRevenue, currency),
    },
    {
      icon: <TrendingUp className="w-4 h-4" />,
      label: "Aggressive monthly",
      value: formatCurrency(aggressiveMonthlyRevenue, currency),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-4 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Financial projections
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="kf-card-metric"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span style={{ color: "hsl(var(--kf-accent2))" }}>{metric.icon}</span>
              {metric.label}
            </div>
            <p className="text-lg font-semibold">{metric.value}</p>
          </motion.div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Projections are assumption-based estimates. Validate with your accountant or financial
        advisor before making decisions.
      </p>
    </motion.div>
  );
}

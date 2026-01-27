"use client";

import { motion } from "framer-motion";

type FlowStatsProps = {
  stats: {
    mrr: string;
    conversionRate: string;
    avgResponseTime: string;
  };
};

const cards = [
  {
    key: "mrr",
    label: "Monthly Flow",
    description: "Collected in last 30 days",
  },
  {
    key: "conversionRate",
    label: "Lead → Client",
    description: "Conversion this week",
  },
  {
    key: "avgResponseTime",
    label: "Avg Response Time",
    description: "Across all channels",
  },
] as const;

export function FlowStatsRow({ stats }: FlowStatsProps) {
  return (
    <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-3">
      {cards.map((card, index) => (
        <motion.div
          key={card.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="relative rounded-3xl border border-border/60 bg-card px-4 py-3 md:px-5 md:py-4 shadow-[var(--kf-shadow)] overflow-hidden"
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-primary/15 blur-2xl" />
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{card.label}</div>
              <div className="text-lg md:text-xl font-semibold mt-1">{stats[card.key]}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{card.description}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kf-mint)]/10 border border-[var(--kf-mint)]/50 px-2 py-0.5 text-[10px] text-[var(--kf-mint)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--kf-mint)] animate-pulse" />
                Stable
              </span>
              <span className="text-[10px] text-muted-foreground">Last sync: 2m</span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

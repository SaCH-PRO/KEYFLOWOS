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
          className="relative rounded-2xl border border-border bg-card p-4 md:p-5 overflow-hidden"
        >
          <div 
            className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full blur-2xl opacity-30"
            style={{ background: `linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))` }}
          />
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">{card.label}</div>
              <div className="text-xl md:text-2xl font-bold mt-1">{stats[card.key]}</div>
              <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] text-primary font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
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

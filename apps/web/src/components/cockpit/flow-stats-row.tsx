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
    useAccent2: false,
  },
  {
    key: "conversionRate",
    label: "Lead → Client",
    description: "Conversion this week",
    useAccent2: true,
  },
  {
    key: "avgResponseTime",
    label: "Avg Response Time",
    description: "Across all channels",
    useAccent2: false,
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
            className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full blur-2xl opacity-20"
            style={{ background: card.useAccent2 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))" }}
          />
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">{card.label}</div>
              <div className="text-xl md:text-2xl font-bold mt-1">{stats[card.key]}</div>
              <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span 
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  background: card.useAccent2 ? "hsl(var(--kf-accent2) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
                  color: card.useAccent2 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))",
                  border: `1px solid ${card.useAccent2 ? "hsl(var(--kf-accent2) / 0.3)" : "hsl(var(--kf-accent1) / 0.3)"}`
                }}
              >
                <span 
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: card.useAccent2 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))" }}
                />
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

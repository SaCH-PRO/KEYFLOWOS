"use client";

import { motion } from "framer-motion";
import { TrendingUp, ArrowUpRight, Clock } from "lucide-react";

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
    icon: TrendingUp,
    accent: 1,
  },
  {
    key: "conversionRate",
    label: "Lead → Client",
    description: "Conversion this week",
    icon: ArrowUpRight,
    accent: 2,
  },
  {
    key: "avgResponseTime",
    label: "Avg Response Time",
    description: "Across all channels",
    icon: Clock,
    accent: 1,
  },
] as const;

export function FlowStatsRow({ stats }: FlowStatsProps) {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const accentVar = card.accent === 1 ? "--kf-accent1" : "--kf-accent2";
        
        return (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.4 }}
            className="kf-stat-card group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                  {card.label}
                </div>
                <div className="text-2xl md:text-3xl font-bold tracking-tight">
                  {stats[card.key]}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {card.description}
                </div>
              </div>
              
              <div 
                className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                style={{ background: `hsl(var(${accentVar}) / 0.15)` }}
              >
                <Icon 
                  className="w-6 h-6" 
                  style={{ color: `hsl(var(${accentVar}))` }}
                />
              </div>
            </div>
            
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
              <span 
                className="kf-badge"
                style={{
                  background: `hsl(var(${accentVar}) / 0.1)`,
                  color: `hsl(var(${accentVar}))`,
                }}
              >
                <span 
                  className="h-1.5 w-1.5 rounded-full mr-1.5 animate-pulse"
                  style={{ background: `hsl(var(${accentVar}))` }}
                />
                Live
              </span>
              <span className="text-xs text-muted-foreground">Updated just now</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

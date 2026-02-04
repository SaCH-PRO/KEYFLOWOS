"use client";

import { motion } from "framer-motion";
import { Trophy, Sparkles, Star, Zap, TrendingUp } from "lucide-react";

const achievements = [
  {
    icon: Trophy,
    title: "First Sale",
    description: "Invoice paid – momentum unlocked.",
    achieved: true,
    accent: 1,
  },
  {
    icon: Star,
    title: "Flawless Flow",
    description: "No overdue invoices this week.",
    achieved: true,
    accent: 2,
  },
  {
    icon: Zap,
    title: "Automation Ready",
    description: "3 playbooks set up.",
    achieved: true,
    accent: 1,
  },
  {
    icon: TrendingUp,
    title: "Growth Mode",
    description: "Revenue up 15% this month.",
    achieved: false,
    accent: 2,
  },
];

export function AchievementsStrip() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {achievements.map((ach, index) => {
        const Icon = ach.icon;
        const accentVar = ach.accent === 1 ? "--kf-accent1" : "--kf-accent2";
        
        return (
          <motion.div
            key={ach.title}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + index * 0.05 }}
            className={`kf-card p-4 flex items-center gap-3 ${!ach.achieved ? "opacity-50" : ""}`}
          >
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={ach.achieved ? {
                background: `hsl(var(${accentVar}))`,
              } : {
                background: "hsl(var(--kf-muted))",
              }}
            >
              <Icon className="w-5 h-5" style={{ color: ach.achieved ? "white" : "hsl(var(--kf-muted-foreground))" }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{ach.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-1">{ach.description}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

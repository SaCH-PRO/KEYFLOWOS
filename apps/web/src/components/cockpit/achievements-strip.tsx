"use client";

import { motion } from "framer-motion";
import { Trophy, Sparkles, Star } from "lucide-react";

const achievements = [
  {
    icon: Trophy,
    title: "First Sale",
    description: "Invoice paid – momentum unlocked.",
    achieved: true,
    useAccent2: false,
  },
  {
    icon: Star,
    title: "Flawless Flow",
    description: "No overdue invoices this week.",
    achieved: false,
    useAccent2: true,
  },
  {
    icon: Sparkles,
    title: "Automation Ready",
    description: "3 playbooks set up.",
    achieved: true,
    useAccent2: true,
  },
];

export function AchievementsStrip() {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-4 overflow-x-auto">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium shrink-0">Achievements</span>
      <div className="flex gap-3">
        {achievements.map((ach, index) => {
          const Icon = ach.icon;
          return (
            <motion.div
              key={ach.title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs"
            >
              <span
                className="h-6 w-6 rounded-lg flex items-center justify-center"
                style={ach.achieved ? {
                  background: ach.useAccent2 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))",
                  color: "white"
                } : {
                  background: "hsl(var(--kf-muted))",
                  color: "hsl(var(--kf-muted-foreground))"
                }}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="font-medium">{ach.title}</span>
              <span className="hidden sm:inline text-[10px] text-muted-foreground">{ach.description}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

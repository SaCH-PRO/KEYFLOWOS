"use client";

import { motion } from "framer-motion";
import { Trophy, Sparkles, Star } from "lucide-react";

const achievements = [
  {
    icon: Trophy,
    title: "First Sale",
    description: "Invoice paid – momentum unlocked.",
    achieved: true,
  },
  {
    icon: Star,
    title: "Flawless Flow",
    description: "No overdue invoices this week.",
    achieved: false,
  },
  {
    icon: Sparkles,
    title: "Automation Ready",
    description: "3 playbooks set up.",
    achieved: true,
  },
];

export function AchievementsStrip() {
  return (
    <div className="rounded-3xl border border-border/60 bg-card px-3 py-2 md:px-4 md:py-3 flex items-center gap-3 overflow-x-auto shadow-[var(--kf-shadow)]">
      <span className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Achievements</span>
      <div className="flex gap-2">
        {achievements.map((ach, index) => {
          const Icon = ach.icon;
          return (
            <motion.div
              key={ach.title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <span
                className={`h-5 w-5 rounded-full flex items-center justify-center ${
                  ach.achieved
                    ? "bg-gradient-to-br from-primary/80 to-accent/70 text-white shadow-[var(--kf-glow)]"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="w-3 h-3" />
              </span>
              <span className="font-medium text-xs text-foreground">{ach.title}</span>
              <span className="hidden sm:inline text-[10px] text-muted-foreground">{ach.description}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

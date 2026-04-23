"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Flame, Star, X, Target } from "lucide-react";
import type { GamificationStats } from "./types";

interface ProgressDrawerProps {
  gamification: GamificationStats | null;
  momentum: number;
}

export function ProgressDrawer({ gamification, momentum }: ProgressDrawerProps) {
  const [open, setOpen] = useState(false);

  if (!gamification) return null;

  const xpPercent = gamification.xpToNextLevel > 0 ? Math.round((gamification.currentXp / gamification.xpToNextLevel) * 100) : 0;
  const activeChallenge = gamification.challenges.find((c) => (c as unknown as Record<string, unknown>).status === "IN_PROGRESS" || (c as unknown as Record<string, unknown>).status === "ACTIVE");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 kf-radius-md text-xs font-medium transition-all hover:bg-muted/30 border border-border text-muted-foreground hover:text-foreground"
      >
        <Trophy className="w-3 h-3" />
        <Flame className="w-3 h-3" style={{ color: gamification.streakDays > 0 ? "hsl(var(--kf-accent1))" : undefined }} />
        <span>{gamification.streakDays}d</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0" style={{ background: "hsl(var(--kf-background) / 0.6)" }} onClick={() => setOpen(false)} />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-sm bg-card border-l border-border shadow-xl flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <h2 className="kf-text-heading font-semibold">Progress & Streak</h2>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-3 gap-2">
                  <StatCell icon={<Flame className="w-3 h-3" />} color="hsl(var(--kf-accent1))" label="Streak" value={`${gamification.streakDays} days`} />
                  <StatCell icon={<Star className="w-3 h-3" />} color="hsl(var(--kf-warning))" label="Level" value={`${gamification.level}`} />
                  <StatCell icon={<Target className="w-3 h-3" />} color="hsl(var(--kf-accent2))" label="Momentum" value={`${Math.round(momentum * 100)}%`} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-muted-foreground">XP Progress</span>
                    <span className="text-[10px] font-medium">{gamification.currentXp} / {gamification.xpToNextLevel}</span>
                  </div>
                  <div className="h-2 kf-radius-sm bg-muted/30 overflow-hidden">
                    <div className="h-full kf-radius-sm transition-all duration-500" style={{ width: `${xpPercent}%`, background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} />
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">{gamification.totalXp} total XP earned</p>
                </div>
                {activeChallenge && (
                  <div className="p-3 kf-radius-md" style={{ background: "hsl(var(--kf-accent2) / 0.05)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Target className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active Challenge</span>
                    </div>
                    <p className="text-xs font-medium">{activeChallenge.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{activeChallenge.description}</p>
                  </div>
                )}
                {gamification.achievements.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Achievements</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {gamification.achievements.map((a) => (
                        <span key={a.id} className="text-[10px] px-2 py-1 kf-radius-sm bg-muted/30 border border-border" title={a.description}>{a.title}</span>
                      ))}
                    </div>
                  </div>
                )}
                {gamification.recentXpGains.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent XP</span>
                    <div className="space-y-1 mt-1.5">
                      {gamification.recentXpGains.slice(0, 5).map((g, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground truncate">{g.action}</span>
                          <span className="font-medium flex-shrink-0 ml-2" style={{ color: "hsl(var(--kf-success))" }}>+{g.xp} XP</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function StatCell({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="bg-muted/20 kf-radius-md p-2.5 text-center">
      <div className="flex items-center justify-center mb-1" style={{ color }}>{icon}</div>
      <p className="text-xs font-bold">{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}

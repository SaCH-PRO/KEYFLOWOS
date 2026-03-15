"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Flame, Star, ChevronDown, ChevronUp, Target } from "lucide-react";
import type { GamificationStats } from "./types";

interface ProgressSectionProps {
  gamification: GamificationStats | null;
  momentum: number;
}

export function ProgressSection({ gamification, momentum }: ProgressSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!gamification) return null;

  const xpPercent = gamification.xpToNextLevel > 0 ? Math.round((gamification.currentXp / gamification.xpToNextLevel) * 100) : 0;
  const activeChallenge = gamification.challenges.find((c) => c.status === "IN_PROGRESS" || c.status === "ACTIVE");

  return (
    <div className="kf-card overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h2 className="kf-text-caption font-semibold uppercase tracking-wider">Progress & Streak</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5" style={{ color: gamification.streakDays > 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted))" }} />
            <span className="text-xs font-semibold" style={{ color: gamification.streakDays > 0 ? "hsl(var(--kf-accent1))" : undefined }}>{gamification.streakDays}d</span>
          </div>
          <span className="text-[10px] text-muted-foreground">Lv.{gamification.level}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <StatCell icon={<Flame className="w-3 h-3" />} color="hsl(var(--kf-accent1))" label="Streak" value={`${gamification.streakDays} days`} />
                <StatCell icon={<Star className="w-3 h-3" />} color="hsl(var(--kf-warning))" label="Level" value={`${gamification.level}`} />
                <StatCell icon={<Target className="w-3 h-3" />} color="hsl(var(--kf-accent2))" label="Momentum" value={`${momentum}%`} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-muted-foreground">XP Progress</span>
                  <span className="text-[10px] font-medium">{gamification.currentXp} / {gamification.xpToNextLevel}</span>
                </div>
                <div className="h-2 kf-radius-sm bg-muted/30 overflow-hidden">
                  <div className="h-full kf-radius-sm transition-all duration-500" style={{ width: `${xpPercent}%`, background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} />
                </div>
              </div>

              {activeChallenge && (
                <div className="p-2.5 kf-radius-sm" style={{ background: "hsl(var(--kf-accent2) / 0.05)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}>
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
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Achievements</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {gamification.achievements.slice(0, 4).map((a) => (
                      <span key={a.id} className="text-[10px] px-2 py-1 kf-radius-sm bg-muted/30 border border-border" title={a.description}>
                        {a.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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

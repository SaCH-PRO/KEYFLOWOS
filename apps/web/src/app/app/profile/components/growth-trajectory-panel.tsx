"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Target,
  Zap,
  Award,
  Clock,
  Brain,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface Milestone {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  category: string;
}

interface SkillEvolution {
  skill: string;
  level: number;
  previousLevel: number;
  trend: "up" | "stable" | "down";
}

export function GrowthTrajectoryPanel() {
  const milestones: Milestone[] = useMemo(() => [
    { id: "1", title: "First 100 Contacts", date: "Jan 2026", completed: true, category: "Network" },
    { id: "2", title: "$10K MRR", date: "Mar 2026", completed: true, category: "Revenue" },
    { id: "3", title: "5 Active Automations", date: "Apr 2026", completed: true, category: "Operations" },
    { id: "4", title: "$25K MRR", date: "Jun 2026", completed: false, category: "Revenue" },
    { id: "5", title: "1,000 Contacts", date: "Aug 2026", completed: false, category: "Network" },
    { id: "6", title: "Full Automation Coverage", date: "Oct 2026", completed: false, category: "Operations" },
  ], []);

  const skills: SkillEvolution[] = useMemo(() => [
    { skill: "Leadership", level: 72, previousLevel: 65, trend: "up" },
    { skill: "Marketing", level: 68, previousLevel: 58, trend: "up" },
    { skill: "Operations", level: 81, previousLevel: 78, trend: "up" },
    { skill: "Finance", level: 64, previousLevel: 62, trend: "stable" },
    { skill: "Technology", level: 75, previousLevel: 70, trend: "up" },
  ], []);

  const completedCount = milestones.filter((m) => m.completed).length;
  const progress = (completedCount / milestones.length) * 100;

  return (
    <div className="space-y-6">
      {/* Trajectory Overview */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Growth Trajectory
          </h3>
          <span className="text-[10px] text-muted-foreground">{completedCount}/{milestones.length} milestones</span>
        </div>

        <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden mb-4">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
          />
        </div>

        <div className="space-y-3">
          {milestones.map((milestone, i) => (
            <motion.div
              key={milestone.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                milestone.completed
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-muted/30 text-muted-foreground"
              }`}>
                {milestone.completed ? (
                  <Award className="w-3 h-3" />
                ) : (
                  <Target className="w-3 h-3" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${milestone.completed ? "text-foreground" : "text-muted-foreground"}`}>
                    {milestone.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{milestone.date}</span>
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                milestone.completed
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-muted/20 text-muted-foreground"
              }`}>
                {milestone.category}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Skill Evolution */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Skill Evolution
        </h3>
        <div className="space-y-3">
          {skills.map((skill, i) => (
            <motion.div
              key={skill.skill}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 + 0.2, duration: 0.3 }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground">{skill.skill}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{skill.previousLevel}%</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{skill.level}%</span>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden relative">
                <div
                  className="absolute h-full rounded-full bg-muted/40"
                  style={{ width: `${skill.previousLevel}%` }}
                />
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${skill.level}%` }}
                  transition={{ delay: i * 0.1 + 0.4, duration: 0.6, ease: "easeOut" }}
                  className="relative h-full rounded-full"
                  style={{
                    backgroundColor: skill.level >= 75 ? "#10b981" : skill.level >= 60 ? "hsl(var(--kf-accent2))" : "#f59e0b",
                  }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* AI Insight */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-xl border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/5 p-4"
      >
        <div className="flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-foreground mb-1">AI Growth Recommendation</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Your Finance skill is 11 points below your Operations score. Completing the financial planning module could unlock the "$25K MRR" milestone 6 weeks earlier.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

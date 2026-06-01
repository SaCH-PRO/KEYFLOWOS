"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Target,
  Zap,
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  CheckCircle2,
  Sparkles,
  BarChart3,
} from "lucide-react";

interface ProjectMetric {
  label: string;
  value: string;
  change: number;
  icon: React.ElementType;
}

interface ProjectInsight {
  id: string;
  type: "risk" | "optimization" | "milestone" | "resource";
  title: string;
  description: string;
  project?: string;
  impact: string;
}

interface TeamLoad {
  member: string;
  role: string;
  load: number;
  tasks: number;
  atRisk: boolean;
}

export function ProjectIntelligencePanel() {
  const metrics: ProjectMetric[] = useMemo(() => [
    { label: "Active Projects", value: "12", change: 2, icon: Target },
    { label: "On Track", value: "9", change: 1, icon: CheckCircle2 },
    { label: "At Risk", value: "2", change: -1, icon: AlertTriangle },
    { label: "Completed", value: "24", change: 4, icon: TrendingUp },
  ], []);

  const insights: ProjectInsight[] = useMemo(() => [
    { id: "1", type: "risk", title: "Deadline Risk: Website Redesign", description: "3 tasks overdue, 2 dependencies blocked. 65% chance of missing Friday deadline.", project: "Website Redesign", impact: "2 days late" },
    { id: "2", type: "optimization", title: "Resource Reallocation", description: "Sarah has 40% capacity while Mike is at 110%. Rebalancing could accelerate Project Alpha by 1 week.", project: "Project Alpha", impact: "+1 week saved" },
    { id: "3", type: "milestone", title: "Milestone Approaching", description: "Q2 Campaign Launch reaches review stage in 3 days. 4 deliverables still pending.", project: "Q2 Campaign", impact: "3 days" },
    { id: "4", type: "resource", title: "Skill Gap Detected", description: "No team member has advanced SEO skills needed for the Content Migration project. Consider external help.", project: "Content Migration", impact: "Blocking" },
  ], []);

  const teamLoads: TeamLoad[] = useMemo(() => [
    { member: "Sarah Chen", role: "Designer", load: 45, tasks: 4, atRisk: false },
    { member: "Mike Ross", role: "Developer", load: 110, tasks: 8, atRisk: true },
    { member: "Emma Davis", role: "PM", load: 78, tasks: 6, atRisk: false },
    { member: "James Wilson", role: "Marketing", load: 92, tasks: 7, atRisk: false },
  ], []);

  return (
    <div className="space-y-4">
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <metric.icon className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{metric.label}</span>
            </div>
            <div className="text-lg font-bold">{metric.value}</div>
            <div className={`text-[10px] ${metric.change >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {metric.change >= 0 ? "+" : ""}{metric.change} this week
            </div>
          </motion.div>
        ))}
      </div>

      {/* Insights */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Project Intelligence
          </h3>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const config = {
              risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
              optimization: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
              milestone: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: Target },
              resource: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Users },
            }[insight.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className={`rounded-xl border ${config.border} ${config.bg} p-3`}
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    <div className="flex items-center justify-between mt-1">
                      {insight.project && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/60 text-muted-foreground">
                          {insight.project}
                        </span>
                      )}
                      <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{insight.impact}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Team Load */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-4"
      >
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Team Capacity
        </h3>
        <div className="space-y-2.5">
          {teamLoads.map((member, i) => (
            <div key={member.member}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{member.member}</span>
                  <span className="text-[10px] text-muted-foreground">{member.role}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{member.tasks} tasks</span>
                  <span className={`text-[10px] font-medium ${member.atRisk ? "text-rose-500" : "text-muted-foreground"}`}>
                    {member.load}%
                  </span>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(member.load, 100)}%` }}
                  transition={{ delay: i * 0.1 + 0.3, duration: 0.5 }}
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: member.load > 100 ? "#ef4444" : member.load > 80 ? "#f59e0b" : "#10b981",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

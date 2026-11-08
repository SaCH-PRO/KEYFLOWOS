"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Target,
  Zap,
  AlertTriangle,
  TrendingUp,
  Users,
  CheckCircle2,
} from "lucide-react";
import { fetchStaff, type Project, type StaffMember } from "@/lib/client";
import { normalizeStatus, isOverdue, isDueSoon, getProjectRisk } from "./project-constants";

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

interface ProjectIntelligencePanelProps {
  projects?: Project[];
  businessId?: string | null;
}

export function ProjectIntelligencePanel({ projects = [], businessId }: ProjectIntelligencePanelProps) {
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void fetchStaff(businessId).then((res) => {
      if (!cancelled && res.data) {
        setStaffMembers(res.data);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const metrics: ProjectMetric[] = useMemo(() => {
    const activeProjects = projects.filter((p) => {
      const s = normalizeStatus(p.status);
      return s !== "COMPLETED" && s !== "ARCHIVED";
    });
    const onTrackCount = activeProjects.filter((p) => getProjectRisk(p) === "healthy").length;
    const atRiskCount = activeProjects.filter((p) => {
      const r = getProjectRisk(p);
      return r === "critical" || r === "at-risk" || r === "blocked";
    }).length;
    const completedCount = projects.filter((p) => normalizeStatus(p.status) === "COMPLETED").length;

    return [
      { label: "Active Projects", value: String(activeProjects.length), change: activeProjects.length, icon: Target },
      { label: "On Track", value: String(onTrackCount), change: onTrackCount, icon: CheckCircle2 },
      { label: "At Risk", value: String(atRiskCount), change: -atRiskCount, icon: AlertTriangle },
      { label: "Completed", value: String(completedCount), change: completedCount, icon: TrendingUp },
    ];
  }, [projects]);

  const insights: ProjectInsight[] = useMemo(() => {
    const items: ProjectInsight[] = [];

    for (const p of projects) {
      const s = normalizeStatus(p.status);
      if (s === "COMPLETED" || s === "ARCHIVED") continue;

      const tasks = p.tasks ?? [];
      const overdueTasks = tasks.filter((t) => !t.isCompleted && isOverdue(t.dueDate));
      if (overdueTasks.length > 0 || isOverdue(p.dueDate)) {
        items.push({
          id: `risk-${p.id}`,
          type: "risk",
          title: `Deadline Risk: ${p.name}`,
          description: `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} overdue${isOverdue(p.dueDate) ? " and project deadline has passed" : ""}. Prioritize completion or adjust schedule.`,
          project: p.name,
          impact: overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : "Past due",
        });
      }

      if (isDueSoon(p.dueDate, 7)) {
        const remainingTasks = tasks.filter((t) => !t.isCompleted).length;
        items.push({
          id: `milestone-${p.id}`,
          type: "milestone",
          title: `Deadline Approaching: ${p.name}`,
          description: `Project is due within 7 days with ${remainingTasks} deliverable${remainingTasks === 1 ? "" : "s"} still pending.`,
          project: p.name,
          impact: "Due soon",
        });
      }

      const unassignedTasks = tasks.filter((t) => !t.isCompleted && !t.assigneeStaffId);
      if (unassignedTasks.length >= 2) {
        items.push({
          id: `resource-${p.id}`,
          type: "resource",
          title: `Unassigned Tasks: ${p.name}`,
          description: `${unassignedTasks.length} open tasks have no assigned team member. Assign owners to avoid delivery bottlenecks.`,
          project: p.name,
          impact: `${unassignedTasks.length} unassigned`,
        });
      }
    }

    if (items.length === 0) {
      items.push({
        id: "healthy-summary",
        type: "optimization",
        title: projects.length > 0 ? "All Active Projects On Track" : "Ready for Project Intelligence",
        description:
          projects.length > 0
            ? "No overdue deliverables or blocked milestones detected across your active projects."
            : "Create a project or generate a strategic plan to unlock real-time delivery risk and workload insights.",
        impact: "Healthy",
      });
    }

    return items.slice(0, 6);
  }, [projects]);

  const teamLoads: TeamLoad[] = useMemo(() => {
    const openTasks = projects.flatMap((p) => {
      const s = normalizeStatus(p.status);
      if (s === "COMPLETED" || s === "ARCHIVED") return [];
      return (p.tasks ?? []).filter((t) => !t.isCompleted);
    });

    if (staffMembers.length > 0) {
      return staffMembers.map((s) => {
        const assignedCount = openTasks.filter((t) => t.assigneeStaffId === s.id).length;
        // Assume 6 concurrent open tasks = 100% nominal capacity
        const load = Math.round((assignedCount / 6) * 100);
        return {
          member: s.name,
          role: s.role || "Team Member",
          load,
          tasks: assignedCount,
          atRisk: load > 90,
        };
      });
    }

    const unassignedCount = openTasks.filter((t) => !t.assigneeStaffId).length;
    if (openTasks.length > 0) {
      return [
        {
          member: "Unassigned Queue",
          role: "Open Deliverables",
          load: Math.min(100, Math.round((unassignedCount / 6) * 100)),
          tasks: unassignedCount,
          atRisk: unassignedCount > 5,
        },
      ];
    }

    return [];
  }, [projects, staffMembers]);

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

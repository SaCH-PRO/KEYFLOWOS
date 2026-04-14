"use client";

import {
  FolderKanban, CalendarClock, AlertTriangle, Clock, CheckCircle,
  UserX, Sparkles, HeartPulse, TrendingUp,
} from "lucide-react";
import { Project } from "@/lib/client";
import { normalizeStatus, isOverdue, isDueSoon, getProjectRisk } from "./project-constants";

interface ProjectExecutionStripProps {
  projects: Project[];
}

export function ProjectExecutionStrip({ projects }: ProjectExecutionStripProps) {
  if (projects.length === 0) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const activeProjects = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s !== "COMPLETED" && s !== "ARCHIVED";
  });

  const active = activeProjects.length;

  const dueThisWeek = activeProjects.filter((p) => isDueSoon(p.dueDate, 7)).length;

  const blocked = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s === "BLOCKED" || s === "WAITING_ON_CLIENT";
  }).length;

  const overdue = activeProjects.filter((p) => isOverdue(p.dueDate)).length;

  const completedThisMonth = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    if (s !== "COMPLETED") return false;
    return p.updatedAt && new Date(p.updatedAt) >= monthStart;
  }).length;

  const unassigned = activeProjects.filter((p) => !p.contactId).length;

  const healthyCount = activeProjects.filter((p) => getProjectRisk(p) === "healthy").length;
  const healthScore = active > 0 ? Math.round((healthyCount / active) * 100) : 100;

  const totalTasks = projects.reduce((s, p) => s + (p.tasks?.length ?? 0), 0);
  const completedTasks = projects.reduce((s, p) => s + (p.tasks?.filter((t) => t.isCompleted).length ?? 0), 0);
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const metrics = [
    { label: "Health Score", value: `${healthScore}%`, icon: HeartPulse, color: healthScore >= 70 ? "hsl(var(--kf-success))" : healthScore >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))", bg: healthScore >= 70 ? "hsl(var(--kf-success) / 0.1)" : healthScore >= 40 ? "hsl(var(--kf-warning) / 0.1)" : "hsl(var(--kf-error) / 0.1)" },
    { label: "Active", value: String(active), icon: FolderKanban, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
    { label: "Due This Week", value: String(dueThisWeek), icon: CalendarClock, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
    ...(blocked > 0 ? [{ label: "Blocked", value: String(blocked), icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" }] : []),
    ...(overdue > 0 ? [{ label: "Overdue", value: String(overdue), icon: Clock, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" }] : []),
    { label: "Task Rate", value: `${taskCompletionRate}%`, icon: TrendingUp, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.1)" },
    { label: "Completed", value: String(completedThisMonth), icon: CheckCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
    ...(unassigned > 0 ? [{ label: "No Client", value: String(unassigned), icon: UserX, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)" }] : []),
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
          <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery Pulse</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: healthScore >= 70 ? "hsl(var(--kf-success))" : healthScore >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" }} />
          <span className="text-[10px] font-medium" style={{ color: healthScore >= 70 ? "hsl(var(--kf-success))" : healthScore >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" }}>
            {healthScore >= 70 ? "Healthy" : healthScore >= 40 ? "At Risk" : "Critical"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-lg px-3 py-2 flex items-center gap-2.5"
            style={{ background: m.bg }}
          >
            <m.icon className="w-4 h-4 shrink-0" style={{ color: m.color }} />
            <div className="min-w-0">
              <div className="text-lg font-bold leading-tight" style={{ color: m.color }}>{m.value}</div>
              <div className="text-[10px] text-muted-foreground truncate">{m.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

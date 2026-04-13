"use client";

import {
  FolderKanban, CalendarClock, AlertTriangle, Clock, CheckCircle,
  UserX, Sparkles,
} from "lucide-react";
import { Project } from "@/lib/client";
import { normalizeStatus, isOverdue, isDueSoon } from "./project-constants";

interface ProjectExecutionStripProps {
  projects: Project[];
}

export function ProjectExecutionStrip({ projects }: ProjectExecutionStripProps) {
  if (projects.length === 0) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const active = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s !== "COMPLETED" && s !== "ARCHIVED";
  }).length;

  const dueThisWeek = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s !== "COMPLETED" && s !== "ARCHIVED" && isDueSoon(p.dueDate, 7);
  }).length;

  const blocked = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s === "BLOCKED" || s === "WAITING_ON_CLIENT";
  }).length;

  const overdue = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s !== "COMPLETED" && s !== "ARCHIVED" && isOverdue(p.dueDate);
  }).length;

  const completedThisMonth = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    if (s !== "COMPLETED") return false;
    return p.updatedAt && new Date(p.updatedAt) >= monthStart;
  }).length;

  const unassigned = projects.filter((p) => {
    const s = normalizeStatus(p.status);
    return s !== "COMPLETED" && s !== "ARCHIVED" && !p.contactId;
  }).length;

  const metrics = [
    { label: "Active", value: active, icon: FolderKanban, color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
    { label: "Due This Week", value: dueThisWeek, icon: CalendarClock, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
    ...(blocked > 0 ? [{ label: "Blocked", value: blocked, icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" }] : []),
    ...(overdue > 0 ? [{ label: "Overdue", value: overdue, icon: Clock, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" }] : []),
    { label: "Completed This Month", value: completedThisMonth, icon: CheckCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
    ...(unassigned > 0 ? [{ label: "No Client Linked", value: unassigned, icon: UserX, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)" }] : []),
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
          <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery Pulse</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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

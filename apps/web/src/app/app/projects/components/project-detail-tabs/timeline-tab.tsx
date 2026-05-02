"use client";

import { useMemo } from "react";
import {
  Circle,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  MessageSquare,
  Flag,
} from "lucide-react";
import { Project } from "@/lib/client";
import { normalizeStatus, getStageInfo, isOverdue, formatDate } from "../project-constants";
import type { Milestone } from "./milestones-tab";

interface TimelineTabProps {
  project: Project;
  notes: string[];
  milestones?: Milestone[];
}

interface TimelineEvent {
  id: string;
  date: Date;
  type: "created" | "stage" | "task" | "note" | "milestone" | "due" | "milestone-due";
  title: string;
  detail?: string;
  color: string;
  icon: React.ElementType;
}

export function TimelineTab({ project, notes, milestones = [] }: TimelineTabProps) {
  const events = useMemo(() => {
    const ev: TimelineEvent[] = [];

    ev.push({
      id: "created",
      date: new Date(project.createdAt),
      type: "created",
      title: "Project created",
      detail: project.name,
      color: "hsl(var(--kf-accent1))",
      icon: Circle,
    });

    if (project.dueDate) {
      ev.push({
        id: "due",
        date: new Date(project.dueDate),
        type: "due",
        title: "Due date",
        detail: new Date(project.dueDate).toLocaleDateString(),
        color: "hsl(var(--kf-warning))",
        icon: Calendar,
      });
    }

    const stageInfo = getStageInfo(project.status);
    if (normalizeStatus(project.status) !== "NOT_STARTED") {
      ev.push({
        id: "stage-current",
        date: new Date(project.updatedAt),
        type: "stage",
        title: `Moved to ${stageInfo.label}`,
        color: stageInfo.color,
        icon: ArrowRight,
      });
    }

    (project.tasks ?? []).filter((t) => t.isCompleted).forEach((task) => {
      ev.push({
        id: `task-${task.id}`,
        date: new Date(project.updatedAt),
        type: "task",
        title: `Task completed: ${task.title}`,
        color: "hsl(var(--kf-success))",
        icon: CheckCircle,
      });
    });

    milestones.forEach((ms) => {
      if (ms.dueDate) {
        ev.push({
          id: `ms-${ms.id}`,
          date: new Date(ms.dueDate),
          type: "milestone-due",
          title: ms.completed ? `Milestone completed: ${ms.title}` : `Milestone due: ${ms.title}`,
          detail: ms.completed ? "Completed" : isOverdue(ms.dueDate) ? "Overdue" : "Pending",
          color: ms.completed ? "hsl(var(--kf-success))" : isOverdue(ms.dueDate) ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent2))",
          icon: ms.completed ? CheckCircle : isOverdue(ms.dueDate) ? AlertTriangle : Flag,
        });
      }
    });

    notes.forEach((note, i) => {
      ev.push({
        id: `note-${i}`,
        date: new Date(project.updatedAt),
        type: "note",
        title: "Note added",
        detail: note.slice(0, 80) + (note.length > 80 ? "..." : ""),
        color: "hsl(var(--kf-info))",
        icon: MessageSquare,
      });
    });

    ev.sort((a, b) => a.date.getTime() - b.date.getTime());
    return ev;
  }, [project, notes, milestones]);

  const milestonesCompleted = milestones.filter((m) => m.completed).length;
  const msProgress = milestones.length > 0 ? Math.round((milestonesCompleted / milestones.length) * 100) : 0;

  if (events.length === 0 && milestones.length === 0) {
    return (
      <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
        <Calendar className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-1">Events will appear here as the project progresses — milestones, stage changes, and tasks completed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {milestones.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Flag className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              Milestone Progress
            </h4>
            <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>
              {milestonesCompleted}/{milestones.length} · {msProgress}%
            </span>
          </div>
          <div className="relative">
            <div className="h-3 rounded-full overflow-hidden bg-muted/20 flex">
              {milestones.map((ms, i) => {
                const segWidth = 100 / milestones.length;
                return (
                  <div
                    key={ms.id}
                    className="h-full relative transition-all"
                    style={{
                      width: `${segWidth}%`,
                      background: ms.completed
                        ? "hsl(var(--kf-success))"
                        : isOverdue(ms.dueDate)
                          ? "hsl(var(--kf-error) / 0.3)"
                          : "hsl(var(--muted) / 0.2)",
                      borderRight: i < milestones.length - 1 ? "1px solid hsl(var(--background))" : "none",
                    }}
                  />
                );
              })}
            </div>
            <div className="flex mt-2">
              {milestones.map((ms, _i) => {
                const segWidth = 100 / milestones.length;
                return (
                  <div key={ms.id} className="flex flex-col items-center" style={{ width: `${segWidth}%` }}>
                    <div
                      className="w-2.5 h-2.5 rounded-full border-2"
                      style={{
                        background: ms.completed ? "hsl(var(--kf-success))" : "hsl(var(--card))",
                        borderColor: ms.completed
                          ? "hsl(var(--kf-success))"
                          : isOverdue(ms.dueDate)
                            ? "hsl(var(--kf-error))"
                            : "hsl(var(--muted-foreground) / 0.3)",
                      }}
                    />
                    <span className="text-[8px] text-muted-foreground/70 mt-1 text-center truncate max-w-[80px] leading-tight">
                      {ms.title}
                    </span>
                    {ms.dueDate && (
                      <span
                        className="text-[7px] mt-0.5"
                        style={{ color: isOverdue(ms.dueDate) && !ms.completed ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground) / 0.5)" }}
                      >
                        {formatDate(ms.dueDate)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-0">
        {events.map((event, i) => (
          <div key={event.id} className="flex gap-3 group">
            <div className="flex flex-col items-center">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `hsl(var(--muted) / 0.15)` }}>
                <event.icon className="w-3.5 h-3.5" style={{ color: event.color }} />
              </div>
              {i < events.length - 1 && (
                <div className="w-px flex-1 my-1" style={{ background: "hsl(var(--border) / 0.4)" }} />
              )}
            </div>
            <div className="pb-4 pt-0.5 min-w-0">
              <p className="text-sm font-medium">{event.title}</p>
              {event.detail && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate" style={{ color: event.type === "milestone-due" ? event.color : undefined }}>{event.detail}</p>
              )}
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {event.date.toLocaleDateString()} · {event.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

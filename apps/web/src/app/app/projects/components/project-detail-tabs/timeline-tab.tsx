"use client";

import {
  Circle, CheckCircle, AlertTriangle, ArrowRight, Calendar,
  MessageSquare, Flag, Zap,
} from "lucide-react";
import { Project } from "@/lib/client";
import { normalizeStatus, getStageInfo } from "../project-constants";

interface TimelineTabProps {
  project: Project;
  notes: string[];
}

interface TimelineEvent {
  id: string;
  date: Date;
  type: "created" | "stage" | "task" | "note" | "milestone" | "due";
  title: string;
  detail?: string;
  color: string;
  icon: React.ElementType;
}

export function TimelineTab({ project, notes }: TimelineTabProps) {
  const events: TimelineEvent[] = [];

  events.push({
    id: "created",
    date: new Date(project.createdAt),
    type: "created",
    title: "Project created",
    detail: project.name,
    color: "hsl(var(--kf-accent1))",
    icon: Circle,
  });

  if (project.dueDate) {
    events.push({
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
    events.push({
      id: "stage-current",
      date: new Date(project.updatedAt),
      type: "stage",
      title: `Moved to ${stageInfo.label}`,
      color: stageInfo.color,
      icon: ArrowRight,
    });
  }

  (project.tasks ?? []).filter((t) => t.isCompleted).forEach((task) => {
    events.push({
      id: `task-${task.id}`,
      date: new Date(project.updatedAt),
      type: "task",
      title: `Task completed: ${task.title}`,
      color: "hsl(var(--kf-success))",
      icon: CheckCircle,
    });
  });

  notes.forEach((note, i) => {
    events.push({
      id: `note-${i}`,
      date: new Date(project.updatedAt),
      type: "note",
      title: "Note added",
      detail: note.slice(0, 80) + (note.length > 80 ? "..." : ""),
      color: "hsl(var(--kf-info))",
      icon: MessageSquare,
    });
  });

  events.sort((a, b) => b.date.getTime() - a.date.getTime());

  if (events.length === 0) {
    return (
      <div className="text-center py-8">
        <Calendar className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-1">Events will appear here as the project progresses.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((event, i) => (
        <div key={event.id} className="flex gap-3 group">
          <div className="flex flex-col items-center">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${event.color}15` }}>
              <event.icon className="w-3.5 h-3.5" style={{ color: event.color }} />
            </div>
            {i < events.length - 1 && (
              <div className="w-px flex-1 my-1" style={{ background: "hsl(var(--border) / 0.4)" }} />
            )}
          </div>
          <div className="pb-4 pt-0.5 min-w-0">
            <p className="text-sm font-medium">{event.title}</p>
            {event.detail && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.detail}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {event.date.toLocaleDateString()} · {event.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

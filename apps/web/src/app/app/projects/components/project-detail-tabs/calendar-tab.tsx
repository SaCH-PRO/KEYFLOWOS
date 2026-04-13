"use client";

import { Calendar, ExternalLink, Clock } from "lucide-react";
import { Project } from "@/lib/client";
import { formatDate, isOverdue, isDueSoon } from "../project-constants";

interface CalendarTabProps {
  project: Project;
}

export function CalendarTab({ project }: CalendarTabProps) {
  const dates = [];

  if (project.createdAt) {
    dates.push({
      label: "Project Created",
      date: project.createdAt,
      type: "past" as const,
    });
  }
  if (project.dueDate) {
    dates.push({
      label: "Due Date",
      date: project.dueDate,
      type: isOverdue(project.dueDate) ? "overdue" as const : isDueSoon(project.dueDate, 7) ? "soon" as const : "future" as const,
    });
  }

  const taskDates = (project.tasks ?? []).filter((t) => t.dueDate && !t.isCompleted).map((t) => ({
    label: `Task: ${t.title}`,
    date: t.dueDate!,
    type: isOverdue(t.dueDate) ? "overdue" as const : "future" as const,
  }));

  const allDates = [...dates, ...taskDates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-4">
      {project.bookingId && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
              <Calendar className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Booking Linked</p>
              <p className="text-[10px] text-muted-foreground">ID: {project.bookingId.slice(0, 8)}...</p>
            </div>
            <a
              href={`/app/calendar`}
              className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
              style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
            >
              <ExternalLink className="w-3 h-3" />
              Open Calendar
            </a>
          </div>
        </div>
      )}

      {allDates.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <Calendar className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No dates set</p>
          <p className="text-xs text-muted-foreground mt-1">Add a due date to the project or tasks to see them here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Key Dates</h4>
          <div className="space-y-2">
            {allDates.map((d, i) => {
              const colorMap = {
                past: "hsl(var(--muted-foreground))",
                future: "hsl(var(--kf-accent2))",
                soon: "hsl(var(--kf-warning))",
                overdue: "hsl(var(--kf-error))",
              };
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                  <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: colorMap[d.type] }} />
                  <span className="text-sm flex-1 truncate">{d.label}</span>
                  <span className="text-xs shrink-0" style={{ color: colorMap[d.type] }}>
                    {formatDate(d.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

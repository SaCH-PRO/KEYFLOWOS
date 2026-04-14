"use client";

import { useEffect, useState } from "react";
import { Calendar, ExternalLink, Clock, MapPin, User, CheckCircle } from "lucide-react";
import { Project, fetchBookings, type Booking } from "@/lib/client";
import { formatDate, isOverdue, isDueSoon } from "../project-constants";
import { getStoredBusinessId } from "@/lib/workspace";

interface CalendarTabProps {
  project: Project;
  milestones?: Array<{ id: string; title: string; dueDate?: string; completed: boolean }>;
}

export function CalendarTab({ project, milestones = [] }: CalendarTabProps) {
  const [linkedBooking, setLinkedBooking] = useState<Booking | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);

  useEffect(() => {
    setLinkedBooking(null);
    if (!project.bookingId) return;
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    let cancelled = false;
    setLoadingBooking(true);
    fetchBookings(businessId)
      .then((res) => {
        if (cancelled) return;
        if (res.data) {
          const match = (res.data as Booking[]).find((b) => b.id === project.bookingId);
          if (match) setLinkedBooking(match);
        }
      })
      .catch((err) => console.error("[CalendarTab] booking fetch error:", err))
      .finally(() => { if (!cancelled) setLoadingBooking(false); });
    return () => { cancelled = true; };
  }, [project.bookingId]);

  const dates: Array<{ label: string; date: string; type: "past" | "future" | "soon" | "overdue" | "completed" }> = [];

  if (project.createdAt) {
    dates.push({ label: "Project Created", date: project.createdAt, type: "past" });
  }

  milestones.forEach((ms) => {
    if (ms.dueDate) {
      dates.push({
        label: `Milestone: ${ms.title}`,
        date: ms.dueDate,
        type: ms.completed ? "completed" : isOverdue(ms.dueDate) ? "overdue" : isDueSoon(ms.dueDate, 7) ? "soon" : "future",
      });
    }
  });

  const taskDates = (project.tasks ?? []).filter((t) => t.dueDate && !t.isCompleted).map((t) => ({
    label: `Task: ${t.title}`,
    date: t.dueDate!,
    type: isOverdue(t.dueDate) ? "overdue" as const : isDueSoon(t.dueDate, 3) ? "soon" as const : "future" as const,
  }));

  if (project.dueDate) {
    dates.push({
      label: "Due Date",
      date: project.dueDate,
      type: isOverdue(project.dueDate) ? "overdue" : isDueSoon(project.dueDate, 7) ? "soon" : "future",
    });
  }

  const allDates = [...dates, ...taskDates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const colorMap = {
    past: "hsl(var(--muted-foreground))",
    future: "hsl(var(--kf-accent2))",
    soon: "hsl(var(--kf-warning))",
    overdue: "hsl(var(--kf-error))",
    completed: "hsl(var(--kf-success))",
  };

  return (
    <div className="space-y-4">
      {project.bookingId && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          {loadingBooking ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/30 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted/30 rounded animate-pulse" />
                <div className="h-3 w-48 bg-muted/20 rounded animate-pulse" />
              </div>
            </div>
          ) : linkedBooking ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
                  <Calendar className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{linkedBooking.service?.name || "Booking"}</p>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold uppercase"
                      style={{
                        background: linkedBooking.status === "CONFIRMED" ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-warning) / 0.1)",
                        color: linkedBooking.status === "CONFIRMED" ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                      }}
                    >
                      {linkedBooking.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(linkedBooking.startTime).toLocaleDateString()} at {new Date(linkedBooking.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {linkedBooking.endTime && ` – ${new Date(linkedBooking.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                </div>
                <a
                  href="/app/calendar"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors shrink-0"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                >
                  <ExternalLink className="w-3 h-3" />
                  Open Calendar
                </a>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg p-2.5" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Date</span>
                  <p className="text-xs font-medium mt-0.5">{new Date(linkedBooking.startTime).toLocaleDateString()}</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Time</span>
                  <p className="text-xs font-medium mt-0.5">
                    {new Date(linkedBooking.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="rounded-lg p-2.5" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</span>
                  <p className="text-xs font-medium mt-0.5 capitalize">{linkedBooking.status.toLowerCase()}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
                <Calendar className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Booking Linked</p>
                <p className="text-[10px] text-muted-foreground">ID: {project.bookingId.slice(0, 8)}...</p>
              </div>
              <a
                href="/app/calendar"
                className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
                style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
              >
                <ExternalLink className="w-3 h-3" />
                Open Calendar
              </a>
            </div>
          )}
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
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Project Timeline</h4>
          <div className="space-y-1">
            {allDates.map((d, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg relative" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                {d.type === "completed" ? (
                  <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: colorMap[d.type] }} />
                ) : (
                  <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: colorMap[d.type] }} />
                )}
                <span className="text-sm flex-1 truncate">{d.label}</span>
                <span className="text-xs shrink-0 tabular-nums" style={{ color: colorMap[d.type] }}>
                  {formatDate(d.date)}
                </span>
                {d.type === "overdue" && (
                  <span className="text-[8px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
                    OVERDUE
                  </span>
                )}
                {d.type === "soon" && (
                  <span className="text-[8px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>
                    SOON
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

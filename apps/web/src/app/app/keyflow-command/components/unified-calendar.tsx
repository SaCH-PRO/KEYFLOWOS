"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Calendar,
  CheckSquare,
  Briefcase,
  Bot,
  Flag,
  ExternalLink,
  Plus,
  Link2Off,
} from "lucide-react";
import { fetchKeyflowEvents, type KeyflowEvent, type KeyflowEventKind } from "@/lib/client";
import { apiGet } from "@/lib/api";
import Link from "next/link";
import { EventDrawer, type EventDrawerInitial } from "./event-drawer";

type ViewMode = "week" | "day" | "agenda";

interface Props {
  businessId: string;
  onOpenNotes?: (target: { type: string; id: string; label: string }) => void;
}

const KIND_META: Record<
  KeyflowEventKind,
  { label: string; icon: typeof Calendar; color: string }
> = {
  booking: { label: "Booking", icon: Calendar, color: "#3b82f6" },
  contact_task: { label: "Contact", icon: CheckSquare, color: "#14B8A6" },
  project_task: { label: "Project", icon: Briefcase, color: "#a78bfa" },
  autopilot_task: { label: "Autopilot", icon: Bot, color: "#F97316" },
  project_deadline: { label: "Deadline", icon: Flag, color: "#ef4444" },
  google_event: { label: "Google", icon: Calendar, color: "#22c55e" },
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function UnifiedCalendar({ businessId, onOpenNotes }: Props) {
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<KeyflowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitial, setDrawerInitial] = useState<EventDrawerInitial | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeKinds, setActiveKinds] = useState<Set<KeyflowEventKind>>(
    () =>
      new Set<KeyflowEventKind>([
        "booking",
        "contact_task",
        "project_task",
        "autopilot_task",
        "project_deadline",
        "google_event",
      ]),
  );

  const range = useMemo(() => {
    if (view === "day") {
      return { from: startOfDay(cursor), to: endOfDay(cursor) };
    }
    if (view === "week") {
      const from = startOfWeek(cursor);
      const to = endOfDay(new Date(from.getTime() + 6 * 86400000));
      return { from, to };
    }
    // agenda: 14 days from cursor
    const from = startOfDay(cursor);
    const to = endOfDay(new Date(from.getTime() + 13 * 86400000));
    return { from, to };
  }, [view, cursor]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag tied to async data fetch lifecycle
    setLoading(true);
    setError(null);
    fetchKeyflowEvents(businessId, {
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error);
        setEvents(res.data?.events ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, range.from, range.to, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ connected: boolean }>(`/bookings/businesses/${businessId}/calendar/status`).then(
      (res) => {
        if (cancelled) return;
        if (res.error) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch hydration
        setCalendarConnected(res.data?.connected ?? false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  const openCreateDrawer = () => {
    setDrawerInitial({});
    setDrawerOpen(true);
  };

  const openEditDrawer = (ev: KeyflowEvent) => {
    if (ev.kind !== "google_event" || !ev.refId) return;
    const meta = (ev.meta ?? {}) as {
      location?: string;
      organizer?: string;
      attendees?: Array<{ email: string; displayName?: string }>;
      allDay?: boolean;
    };
    const attendees: string[] = Array.isArray(meta.attendees) && meta.attendees.length > 0
      ? meta.attendees.map((a) => a.email).filter(Boolean)
      : meta.organizer
        ? [meta.organizer]
        : [];
    setDrawerInitial({
      eventId: ev.refId,
      summary: ev.title,
      description: ev.description,
      start: ev.start,
      end: ev.end,
      attendees,
      location: meta.location,
      htmlLink: ev.href,
    });
    setDrawerOpen(true);
  };

  const filtered = useMemo(
    () => events.filter((e) => activeKinds.has(e.kind)),
    [events, activeKinds],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, KeyflowEvent[]>();
    for (const ev of filtered) {
      const key = startOfDay(new Date(ev.start)).toISOString();
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    return map;
  }, [filtered]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    let d = new Date(range.from);
    while (d <= range.to) {
      arr.push(new Date(d));
      d = new Date(d.getTime() + 86400000);
    }
    return arr;
  }, [range.from, range.to]);

  const toggleKind = (k: KeyflowEventKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const navigate = (dir: 1 | -1) => {
    setCursor((c) => {
      const next = new Date(c);
      const step = view === "day" ? 1 : view === "week" ? 7 : 14;
      next.setDate(next.getDate() + dir * step);
      return next;
    });
  };

  const headerLabel = useMemo(() => {
    if (view === "day") {
      return cursor.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    if (view === "week") {
      const a = startOfWeek(cursor);
      const b = new Date(a.getTime() + 6 * 86400000);
      const sameMonth = a.getMonth() === b.getMonth();
      if (sameMonth) {
        return `${a.toLocaleDateString("en-US", { month: "short" })} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
      }
      return `${a.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${b.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${b.getFullYear()}`;
    }
    const start = range.from;
    const end = range.to;
    return `Next 14 days · ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }, [view, cursor, range]);

  return (
    <div className="kf-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarDays
            className="w-4 h-4 flex-shrink-0"
            style={{ color: "hsl(var(--kf-accent1))" }}
          />
          <h3 className="text-sm font-semibold truncate">Unified Calendar</h3>
          <span
            className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium"
            style={{
              background: "hsl(var(--kf-accent2) / 0.15)",
              color: "hsl(var(--kf-accent2))",
            }}
          >
            {filtered.length} events
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center rounded-xl border border-border/50 overflow-hidden">
            {(["day", "week", "agenda"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setView(m)}
                className={`px-2.5 min-h-[36px] text-xs font-medium capitalize transition-colors ${
                  view === m
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
                style={
                  view === m
                    ? {
                        background:
                          "linear-gradient(to right, hsl(var(--kf-accent1)/0.15), hsl(var(--kf-accent2)/0.15))",
                      }
                    : undefined
                }
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-muted/50 transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="px-3 min-h-[36px] text-xs rounded-lg kf-btn-secondary"
            >
              Today
            </button>
            <button
              onClick={() => navigate(1)}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-muted/50 transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={openCreateDrawer}
            disabled={!calendarConnected}
            className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-xs font-medium rounded-lg kf-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              calendarConnected
                ? "Create a new Google Calendar event"
                : "Connect Google Calendar to create events"
            }
          >
            <Plus className="w-3.5 h-3.5" />
            New event
          </button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{headerLabel}</div>

      {calendarConnected === false && (
        <div
          className="flex items-center justify-between gap-2 p-2.5 rounded-lg text-xs"
          style={{
            background: "hsl(var(--kf-warning, 38 92% 50%) / 0.08)",
            border: "1px solid hsl(var(--kf-warning, 38 92% 50%) / 0.25)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Link2Off className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
            <span className="truncate text-foreground/90">
              Google Calendar isn’t connected. External events and create/edit are unavailable.
            </span>
          </div>
          <Link
            href="/app/connect/calendar"
            className="flex-shrink-0 inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium kf-btn-secondary"
          >
            Connect Google Calendar…
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(KIND_META) as KeyflowEventKind[]).map((k) => {
          const meta = KIND_META[k];
          const Icon = meta.icon;
          const active = activeKinds.has(k);
          return (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                active ? "" : "opacity-40"
              }`}
              style={{
                background: active ? `${meta.color}1f` : "hsl(var(--muted) / 0.4)",
                color: active ? meta.color : "hsl(var(--muted-foreground))",
                border: `1px solid ${active ? `${meta.color}55` : "transparent"}`,
              }}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
          Loading events…
        </div>
      ) : error ? (
        <div
          className="p-3 kf-radius-md text-xs"
          style={{
            background: "hsl(var(--kf-error) / 0.1)",
            border: "1px solid hsl(var(--kf-error) / 0.2)",
            color: "hsl(var(--kf-error))",
          }}
        >
          {error}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view + cursor.toDateString()}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {days.map((day) => {
              const key = startOfDay(day).toISOString();
              const dayEvents = grouped.get(key) ?? [];
              const today = isSameDay(day, new Date());
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div
                      className={`text-xs font-semibold ${
                        today ? "" : "text-muted-foreground"
                      }`}
                      style={today ? { color: "hsl(var(--kf-accent1))" } : undefined}
                    >
                      {day.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {today && (
                        <span
                          className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "hsl(var(--kf-accent1) / 0.15)",
                            color: "hsl(var(--kf-accent1))",
                          }}
                        >
                          TODAY
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {dayEvents.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground/70 italic pl-1">
                      Nothing scheduled
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {dayEvents.map((ev) => {
                        const meta = KIND_META[ev.kind];
                        const Icon = meta.icon;
                        const start = new Date(ev.start);
                        const end = new Date(ev.end);
                        const time = ev.allDay
                          ? "All day"
                          : `${fmtTime(start)} – ${fmtTime(end)}`;
                        const clickable =
                          ev.kind === "google_event" && !!ev.refId && !ev.allDay;
                        return (
                          <div
                            key={ev.id}
                            onClick={clickable ? () => openEditDrawer(ev) : undefined}
                            role={clickable ? "button" : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={
                              clickable
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openEditDrawer(ev);
                                    }
                                  }
                                : undefined
                            }
                            className={`flex items-start gap-2 p-2 rounded-lg hover:bg-muted/40 transition-colors group ${
                              clickable ? "cursor-pointer" : ""
                            }`}
                            style={{
                              borderLeft: `3px solid ${meta.color}`,
                            }}
                          >
                            <Icon
                              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                              style={{ color: meta.color }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="text-xs font-medium truncate">
                                  {ev.title}
                                </div>
                                <span
                                  className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-medium"
                                  style={{
                                    background: `${meta.color}1f`,
                                    color: meta.color,
                                  }}
                                >
                                  {meta.label}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {time}
                                {ev.priority && (
                                  <span className="ml-2 uppercase">{ev.priority}</span>
                                )}
                                {ev.status && (
                                  <span className="ml-2">{ev.status}</span>
                                )}
                              </div>
                              {ev.description && (
                                <div className="text-[10px] text-muted-foreground/80 mt-0.5 line-clamp-2">
                                  {ev.description}
                                </div>
                              )}
                            </div>
                            <div
                              className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ev.refType && ev.refId && onOpenNotes && (
                                <button
                                  onClick={() =>
                                    onOpenNotes({
                                      type: ev.refType!,
                                      id: ev.refId!,
                                      label: ev.title,
                                    })
                                  }
                                  className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary"
                                >
                                  Notes
                                </button>
                              )}
                              {ev.href && (
                                <Link
                                  href={ev.href}
                                  target={ev.kind === "google_event" ? "_blank" : undefined}
                                  rel={ev.kind === "google_event" ? "noreferrer" : undefined}
                                  className="p-1 rounded hover:bg-muted/60"
                                  aria-label="Open"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      )}

      <EventDrawer
        open={drawerOpen}
        businessId={businessId}
        initial={drawerInitial}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

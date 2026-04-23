"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  LogIn,
  FileText,
  RotateCcw,
  StickyNote,
  ExternalLink,
} from "lucide-react";
import type { Booking } from "../components/bookings-types";
import type { GoogleCalendarEvent } from "@/lib/client";
import { contactName, formatTime, toLocalDateKey } from "../components/bookings-types";

const STATUS_BLOCK_STYLE: Record<string, React.CSSProperties> = {
  PENDING: { background: "hsl(var(--kf-warning) / 0.2)", borderColor: "hsl(var(--kf-warning) / 0.4)", color: "hsl(var(--kf-warning))" },
  CONFIRMED: { background: "hsl(var(--kf-info) / 0.2)", borderColor: "hsl(var(--kf-info) / 0.4)", color: "hsl(var(--kf-info))" },
  COMPLETED: { background: "hsl(var(--kf-success) / 0.2)", borderColor: "hsl(var(--kf-success) / 0.4)", color: "hsl(var(--kf-success))" },
  CANCELLED: { background: "hsl(var(--kf-error) / 0.2)", borderColor: "hsl(var(--kf-error) / 0.4)", color: "hsl(var(--kf-error))" },
};

const GCAL_BLOCK_STYLE: React.CSSProperties = {
  background: "hsl(var(--kf-accent2) / 0.12)",
  borderColor: "hsl(var(--kf-accent2) / 0.35)",
  color: "hsl(var(--kf-accent2))",
  borderStyle: "dashed",
};

const TIMELINE_CTA: Record<string, { icon: typeof CheckCircle2; action: string; color: string; title: string }> = {
  PENDING: { icon: CheckCircle2, action: "CONFIRMED", color: "hsl(var(--kf-success))", title: "Confirm" },
  CONFIRMED: { icon: LogIn, action: "COMPLETED", color: "hsl(var(--kf-accent2))", title: "Check in" },
  COMPLETED: { icon: FileText, action: "INVOICE", color: "hsl(var(--kf-accent1))", title: "Invoice" },
  CANCELLED: { icon: RotateCcw, action: "REBOOK", color: "hsl(var(--kf-info))", title: "Rebook" },
};

const START_HOUR = 8;
const END_HOUR = 20;
const TOTAL_HOURS = END_HOUR - START_HOUR;

interface WeekTimelineProps {
  bookings: Booking[];
  googleEvents?: GoogleCalendarEvent[];
  currentDate: Date;
  onSelectBooking: (booking: Booking) => void;
  onSlotClick?: (date: string, time: string) => void;
  onSmartAction?: (booking: Booking, action: string) => void;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatGoogleTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-TT", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function WeekTimeline({
  bookings,
  googleEvents = [],
  currentDate,
  onSelectBooking,
  onSlotClick,
  onSmartAction,
}: WeekTimelineProps) {
  const today = useMemo(() => new Date(), []);
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const day of weekDays) {
      map.set(toLocalDateKey(day), []);
    }
    for (const b of bookings) {
      const key = toLocalDateKey(b.startTime);
      if (map.has(key)) map.get(key)!.push(b);
    }
    return map;
  }, [bookings, weekDays]);

  const googleEventsByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const day of weekDays) {
      map.set(toLocalDateKey(day), []);
    }
    for (const e of googleEvents) {
      if (e.allDay) continue;
      const key = toLocalDateKey(e.start);
      if (map.has(key)) map.get(key)!.push(e);
    }
    return map;
  }, [googleEvents, weekDays]);

  const allDayEventsByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const e of googleEvents) {
      if (!e.allDay) continue;
      const startDate = new Date(e.start + "T00:00:00");
      const endDate = new Date(e.end + "T00:00:00");
      const cursor = new Date(startDate);
      while (cursor < endDate) {
        const key = toLocalDateKey(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [googleEvents]);

  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    []
  );

  const hasAllDayEvents = weekDays.some(
    (day) => (allDayEventsByDay.get(toLocalDateKey(day)) ?? []).length > 0
  );

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-0">
          <div className="h-10" />
          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`h-10 flex items-center justify-center text-xs font-medium border-b border-border/30 ${
                  isToday ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="mr-1">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span
                  className={`${
                    isToday
                      ? "inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold"
                      : ""
                  }`}
                  style={
                    isToday
                      ? { background: "hsl(var(--kf-accent1))" }
                      : undefined
                  }
                >
                  {day.getDate()}
                </span>
              </div>
            );
          })}

          {hasAllDayEvents && (
            <>
              <div className="h-8 flex items-center justify-end pr-2">
                <span className="text-[9px] text-muted-foreground">All day</span>
              </div>
              {weekDays.map((day) => {
                const key = toLocalDateKey(day);
                const events = allDayEventsByDay.get(key) ?? [];
                return (
                  <div
                    key={`allday-${key}`}
                    className="h-8 border-b border-l border-border/20 px-0.5 flex items-center gap-0.5 overflow-hidden"
                  >
                    {events.map((e) => (
                      <a
                        key={e.id}
                        href={e.htmlLink ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded px-1 py-0.5 text-[8px] font-medium truncate max-w-full transition-opacity hover:opacity-80"
                        style={{
                          background: "hsl(var(--kf-accent2) / 0.15)",
                          color: "hsl(var(--kf-accent2))",
                          borderWidth: 1,
                          borderStyle: "dashed",
                          borderColor: "hsl(var(--kf-accent2) / 0.3)",
                        }}
                        title={e.summary}
                      >
                        {e.summary}
                      </a>
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="h-14 flex items-start justify-end pr-2 pt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {hour === 12
                    ? "12 PM"
                    : hour > 12
                    ? `${hour - 12} PM`
                    : `${hour} AM`}
                </span>
              </div>
              {weekDays.map((day) => {
                const key = toLocalDateKey(day);
                const dayBookings = bookingsByDay.get(key) ?? [];
                const dayGoogleEvents = googleEventsByDay.get(key) ?? [];
                const hourBookings = dayBookings.filter((b) => {
                  const h = new Date(b.startTime).getHours();
                  return h === hour;
                });
                const hourGoogleEvents = dayGoogleEvents.filter((e) => {
                  const h = new Date(e.start).getHours();
                  return h === hour;
                });
                const isToday = isSameDay(day, today);
                const hasItems = hourBookings.length > 0 || hourGoogleEvents.length > 0;

                return (
                  <div
                    key={`${key}-${hour}`}
                    className={`h-14 border-b border-l border-border/20 relative ${
                      isToday ? "bg-[hsl(var(--kf-accent1)/0.03)]" : ""
                    } ${!hasItems && onSlotClick ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""}`}
                    onClick={() => {
                      if (!hasItems && onSlotClick) {
                        onSlotClick(key, `${String(hour).padStart(2, "0")}:00`);
                      }
                    }}
                  >
                    {hourBookings.map((b) => {
                      const startMin = new Date(b.startTime).getMinutes();
                      const durationMs =
                        new Date(b.endTime).getTime() -
                        new Date(b.startTime).getTime();
                      const durationMins = Math.max(
                        15,
                        durationMs / (1000 * 60)
                      );
                      const topPercent = (startMin / 60) * 100;
                      const heightPercent = Math.min(
                        (durationMins / 60) * 100,
                        200
                      );

                      const cta = onSmartAction ? TIMELINE_CTA[b.status] : undefined;
                      const CtaIcon = cta?.icon;

                      return (
                        <div
                          key={b.id}
                          className="absolute left-0.5 right-0.5 rounded-md border px-1 py-0.5 text-[9px] leading-tight transition-opacity hover:opacity-80 z-10 group/block flex items-start gap-0.5"
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                            minHeight: "18px",
                            ...(STATUS_BLOCK_STYLE[b.status] ?? { background: "hsl(var(--muted) / 0.2)", borderColor: "hsl(var(--border) / 0.3)", color: "hsl(var(--muted-foreground))" }),
                          }}
                          title={`${formatTime(b.startTime)} - ${contactName(b)} - ${b.service?.name ?? "Service"}`}
                        >

                          <button
                            onClick={() => onSelectBooking(b)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="font-medium truncate flex items-center gap-0.5">
                              {formatTime(b.startTime)}
                              {b.notes && (
                                <StickyNote className="w-2 h-2 opacity-60 shrink-0" aria-label="Has notes" />
                              )}
                            </div>
                            <div className="truncate opacity-80">
                              {b.service?.name ?? contactName(b)}
                            </div>
                          </button>
                          {cta && CtaIcon && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSmartAction?.(b, cta.action);
                              }}
                              className="p-0.5 rounded shrink-0 opacity-0 group-hover/block:opacity-100 transition-opacity"
                              style={{ color: cta.color }}
                              title={cta.title}
                              aria-label={`${cta.title} booking`}
                            >
                              <CtaIcon className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {hourGoogleEvents.map((e) => {
                      const startMin = new Date(e.start).getMinutes();
                      const durationMs =
                        new Date(e.end).getTime() -
                        new Date(e.start).getTime();
                      const durationMins = Math.max(15, durationMs / (1000 * 60));
                      const topPercent = (startMin / 60) * 100;
                      const heightPercent = Math.min(
                        (durationMins / 60) * 100,
                        200
                      );

                      return (
                        <a
                          key={e.id}
                          href={e.htmlLink ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute left-0.5 right-0.5 rounded-md border px-1 py-0.5 text-[9px] leading-tight transition-opacity hover:opacity-80 z-[5] flex items-start gap-0.5 group/gcal"
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                            minHeight: "18px",
                            ...GCAL_BLOCK_STYLE,
                          }}
                          title={`${formatGoogleTime(e.start)} - ${e.summary}${e.location ? ` · ${e.location}` : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate flex items-center gap-0.5">
                              {formatGoogleTime(e.start)}
                            </div>
                            <div className="truncate opacity-80">
                              {e.summary}
                            </div>
                          </div>
                          <ExternalLink className="w-2 h-2 opacity-0 group-hover/gcal:opacity-60 shrink-0 mt-0.5" />
                        </a>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

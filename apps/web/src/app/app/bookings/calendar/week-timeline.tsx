"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  LogIn,
  FileText,
  RotateCcw,
} from "lucide-react";
import type { Booking } from "../components/bookings-types";
import { contactName, formatTime } from "../components/bookings-types";

const STATUS_BLOCK_STYLE: Record<string, React.CSSProperties> = {
  PENDING: { background: "hsl(var(--kf-warning) / 0.2)", borderColor: "hsl(var(--kf-warning) / 0.4)", color: "hsl(var(--kf-warning))" },
  CONFIRMED: { background: "hsl(var(--kf-info) / 0.2)", borderColor: "hsl(var(--kf-info) / 0.4)", color: "hsl(var(--kf-info))" },
  COMPLETED: { background: "hsl(var(--kf-success) / 0.2)", borderColor: "hsl(var(--kf-success) / 0.4)", color: "hsl(var(--kf-success))" },
  CANCELLED: { background: "hsl(var(--kf-error) / 0.2)", borderColor: "hsl(var(--kf-error) / 0.4)", color: "hsl(var(--kf-error))" },
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

export default function WeekTimeline({
  bookings,
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
      map.set(day.toISOString().split("T")[0], []);
    }
    for (const b of bookings) {
      const key = new Date(b.startTime).toISOString().split("T")[0];
      if (map.has(key)) map.get(key)!.push(b);
    }
    return map;
  }, [bookings, weekDays]);

  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    []
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
                const key = day.toISOString().split("T")[0];
                const dayBookings = bookingsByDay.get(key) ?? [];
                const hourBookings = dayBookings.filter((b) => {
                  const h = new Date(b.startTime).getHours();
                  return h === hour;
                });
                const isToday = isSameDay(day, today);

                return (
                  <div
                    key={`${key}-${hour}`}
                    className={`h-14 border-b border-l border-border/20 relative ${
                      isToday ? "bg-[hsl(var(--kf-accent1)/0.03)]" : ""
                    } ${hourBookings.length === 0 && onSlotClick ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""}`}
                    onClick={() => {
                      if (hourBookings.length === 0 && onSlotClick) {
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
                            <div className="font-medium truncate">
                              {formatTime(b.startTime)}
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

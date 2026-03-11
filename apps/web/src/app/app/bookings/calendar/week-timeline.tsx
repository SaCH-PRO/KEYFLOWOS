"use client";

import { useMemo } from "react";
import type { Booking } from "../components/bookings-types";
import { contactName, formatTime } from "../components/bookings-types";

const STATUS_BLOCK: Record<string, string> = {
  PENDING: "bg-amber-500/20 border-amber-500/40 text-amber-300",
  CONFIRMED: "bg-blue-500/20 border-blue-500/40 text-blue-300",
  COMPLETED: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  CANCELLED: "bg-red-500/20 border-red-500/40 text-red-300",
};

const START_HOUR = 8;
const END_HOUR = 20;
const TOTAL_HOURS = END_HOUR - START_HOUR;

interface WeekTimelineProps {
  bookings: Booking[];
  currentDate: Date;
  onSelectBooking: (booking: Booking) => void;
  onSlotClick?: (date: string, time: string) => void;
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

                      return (
                        <button
                          key={b.id}
                          onClick={() => onSelectBooking(b)}
                          className={`absolute left-0.5 right-0.5 rounded-md border px-1 py-0.5 text-[9px] leading-tight truncate transition-opacity hover:opacity-80 z-10 ${
                            STATUS_BLOCK[b.status] ??
                            "bg-slate-500/20 border-slate-500/30 text-slate-300"
                          }`}
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                            minHeight: "18px",
                          }}
                          title={`${formatTime(b.startTime)} - ${contactName(b)} - ${b.service?.name ?? "Service"}`}
                        >
                          <div className="font-medium truncate">
                            {formatTime(b.startTime)}
                          </div>
                          <div className="truncate opacity-80">
                            {b.service?.name ?? contactName(b)}
                          </div>
                        </button>
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

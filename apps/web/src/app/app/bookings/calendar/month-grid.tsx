"use client";

import { useMemo } from "react";
import type { Booking } from "../components/bookings-types";
import type { GoogleCalendarEvent } from "@/lib/client";
import { contactName, toLocalDateKey } from "../components/bookings-types";

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-[hsl(var(--kf-warning))]",
  CONFIRMED: "bg-[hsl(var(--kf-info))]",
  COMPLETED: "bg-[hsl(var(--kf-success))]",
  CANCELLED: "bg-[hsl(var(--kf-error))]",
};

interface MonthGridProps {
  bookings: Booking[];
  googleEvents?: GoogleCalendarEvent[];
  currentDate: Date;
  onSelectDay: (date: Date) => void;
  selectedDay: Date | null;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function MonthGrid({
  bookings,
  googleEvents = [],
  currentDate,
  onSelectDay,
  selectedDay,
}: MonthGridProps) {
  const today = useMemo(() => new Date(), []);

  const { weeks, monthStart } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();

    const days: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) {
      const d = new Date(year, month, -startDay + i + 1);
      days.push(d);
    }
    for (let i = 1; i <= last.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push(new Date(year, month + 1, i));
      }
    }

    const w: (Date | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      w.push(days.slice(i, i + 7));
    }
    return { weeks: w, monthStart: first };
  }, [currentDate]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = toLocalDateKey(b.startTime);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return map;
  }, [bookings]);

  const googleEventsByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const e of googleEvents) {
      if (e.allDay) {
        const startDate = new Date(e.start + "T00:00:00");
        const endDate = new Date(e.end + "T00:00:00");
        const cursor = new Date(startDate);
        while (cursor < endDate) {
          const key = toLocalDateKey(cursor);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(e);
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        const key = toLocalDateKey(e.start);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
      }
    }
    return map;
  }, [googleEvents]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1">
        {dayNames.map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-medium text-muted-foreground py-1"
          >
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-1">
          {week.map((day, di) => {
            if (!day) return <div key={di} />;
            const key = toLocalDateKey(day);
            const dayBookings = bookingsByDay.get(key) ?? [];
            const dayGoogleEvents = googleEventsByDay.get(key) ?? [];
            const totalItems = dayBookings.length + dayGoogleEvents.length;
            const isCurrentMonth =
              day.getMonth() === monthStart.getMonth();
            const isToday = isSameDay(day, today);
            const isSelected = selectedDay && isSameDay(day, selectedDay);

            return (
              <button
                key={key}
                onClick={() => onSelectDay(day)}
                className={`relative rounded-xl p-1.5 min-h-[72px] sm:min-h-[80px] text-left transition-all border ${
                  isSelected
                    ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/10 ring-1 ring-[hsl(var(--kf-accent1))]/30"
                    : isToday
                    ? "border-[hsl(var(--kf-accent1)/0.4)] bg-[hsl(var(--kf-accent1)/0.06)]"
                    : isCurrentMonth
                    ? "border-border/40 hover:border-border/70 hover:bg-muted/20"
                    : "border-transparent opacity-40"
                }`}
              >
                <span
                  className={`text-xs font-medium ${
                    isToday
                      ? "inline-flex items-center justify-center w-5 h-5 rounded-full text-white"
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
                {totalItems > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {totalItems <= 3 ? (
                      <>
                        {dayBookings.map((b) => (
                          <div
                            key={b.id}
                            className="flex items-center gap-1 truncate"
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                STATUS_DOT[b.status] ?? "bg-slate-400"
                              }`}
                            />
                            <span className="text-[9px] truncate text-muted-foreground">
                              {b.service?.name ?? contactName(b)}
                            </span>
                            {b.location && (
                              <span className="text-[8px] text-muted-foreground/50 flex-shrink-0" title={b.location}>📍</span>
                            )}
                            {b.notes && (
                              <span className="text-[8px] text-muted-foreground/50 flex-shrink-0" title={b.notes}>📝</span>
                            )}
                          </div>
                        ))}
                        {dayGoogleEvents.map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center gap-1 truncate"
                          >
                            <div
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: "hsl(var(--kf-accent2))" }}
                            />
                            <span className="text-[9px] truncate" style={{ color: "hsl(var(--kf-accent2))" }}>
                              {e.summary}
                            </span>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="flex -space-x-0.5">
                          {dayBookings.slice(0, 3).map((b) => (
                            <div
                              key={b.id}
                              className={`w-1.5 h-1.5 rounded-full ${
                                STATUS_DOT[b.status] ?? "bg-slate-400"
                              }`}
                            />
                          ))}
                          {dayGoogleEvents.slice(0, Math.max(1, 4 - dayBookings.length)).map((e) => (
                            <div
                              key={e.id}
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: "hsl(var(--kf-accent2))" }}
                            />
                          ))}
                        </div>
                        <span className="text-[9px] text-muted-foreground font-medium">
                          {totalItems}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

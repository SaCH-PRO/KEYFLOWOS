"use client";

import { useMemo } from "react";
import type { Booking } from "../components/bookings-types";
import { contactName } from "../components/bookings-types";

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-[hsl(var(--kf-warning))]",
  CONFIRMED: "bg-[hsl(var(--kf-info))]",
  COMPLETED: "bg-[hsl(var(--kf-success))]",
  CANCELLED: "bg-[hsl(var(--kf-error))]",
};

interface MonthGridProps {
  bookings: Booking[];
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
      const key = new Date(b.startTime).toISOString().split("T")[0];
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return map;
  }, [bookings]);

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
            const key = day.toISOString().split("T")[0];
            const dayBookings = bookingsByDay.get(key) ?? [];
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
                    ? "border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30"
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
                {dayBookings.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {dayBookings.length <= 3 ? (
                      dayBookings.map((b) => (
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
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="flex -space-x-0.5">
                          {dayBookings.slice(0, 4).map((b) => (
                            <div
                              key={b.id}
                              className={`w-1.5 h-1.5 rounded-full ${
                                STATUS_DOT[b.status] ?? "bg-slate-400"
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-[9px] text-muted-foreground font-medium">
                          {dayBookings.length}
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

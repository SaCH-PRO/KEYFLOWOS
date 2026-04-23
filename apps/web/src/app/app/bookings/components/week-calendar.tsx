"use client";

import { useMemo } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  LogIn,
  FileText,
  RotateCcw,
} from "lucide-react";
import type { Booking } from "./bookings-types";
import { STATUS_STYLE, formatTime, getWeekDays, isSameDay } from "./bookings-types";

const WEEK_SMART_CTA: Record<string, { icon: typeof CheckCircle2; action: string; color: string; title: string }> = {
  PENDING: { icon: CheckCircle2, action: "CONFIRMED", color: "hsl(var(--kf-success))", title: "Confirm" },
  CONFIRMED: { icon: LogIn, action: "COMPLETED", color: "hsl(var(--kf-accent2))", title: "Check in" },
  COMPLETED: { icon: FileText, action: "INVOICE", color: "hsl(var(--kf-accent1))", title: "Invoice" },
  CANCELLED: { icon: RotateCcw, action: "REBOOK", color: "hsl(var(--kf-info))", title: "Rebook" },
};

interface WeekCalendarProps {
  bookings: Booking[];
  weekOffset: number;
  setWeekOffset: (fn: (w: number) => number) => void;
  onSelectBooking: (booking: Booking) => void;
  onSmartAction?: (booking: Booking, action: string) => void;
}

export default function WeekCalendar({ bookings, weekOffset, setWeekOffset, onSelectBooking, onSmartAction }: WeekCalendarProps) {
  const baseDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekDays = useMemo(() => getWeekDays(baseDate), [baseDate]);
  const today = useMemo(() => new Date(), []);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const day of weekDays) {
      const key = day.toISOString().split("T")[0];
      map.set(key, []);
    }
    for (const b of bookings) {
      const key = new Date(b.startTime).toISOString().split("T")[0];
      if (map.has(key)) {
        map.get(key)!.push(b);
      }
    }
    return map;
  }, [bookings, weekDays]);

  return (
    <div className="kf-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Week View
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setWeekOffset(() => 0)} className="kf-btn-secondary px-3 py-1 text-xs">
            Today
          </button>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto -mx-4 px-4 pb-1">
      <div className="grid grid-cols-7 gap-1.5 min-w-[600px]">
        {weekDays.map((day) => {
          const key = day.toISOString().split("T")[0];
          const dayBookings = bookingsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div
              key={key}
              className={`rounded-xl border p-2.5 min-h-[100px] transition-colors ${
                isToday
                  ? "border-[hsl(var(--kf-accent1)/0.4)] bg-[hsl(var(--kf-accent1)/0.08)]"
                  : "border-border/60 bg-muted/10 hover:border-border/80"
              }`}
            >
              <div className={`text-sm font-semibold mb-1.5 ${isToday ? "" : "text-foreground/80"}`} style={isToday ? { color: "hsl(var(--kf-accent1))" } : undefined}>
                {day.toLocaleDateString("en-TT", { weekday: "short" })}
                <span className={`ml-1.5 ${isToday ? "px-1.5 py-0.5 rounded-full text-white" : "text-foreground/60"}`} style={isToday ? { background: "hsl(var(--kf-accent1))" } : undefined}>
                  {day.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {dayBookings.slice(0, 3).map((b) => {
                  const cta = onSmartAction ? WEEK_SMART_CTA[b.status] : undefined;
                  const CtaIcon = cta?.icon;
                  return (
                    <div
                      key={b.id}
                      className="w-full text-left rounded-lg px-1.5 py-1 text-[10px] leading-tight border transition-colors hover:opacity-80 flex items-start gap-1"
                      style={STATUS_STYLE[b.status] ?? { background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border) / 0.3)" }}
                    >
                      <button
                        onClick={() => onSelectBooking(b)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="font-medium truncate">{formatTime(b.startTime)}</div>
                        <div className="truncate opacity-80">{b.service?.name ?? "Service"}</div>
                      </button>
                      {cta && CtaIcon && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSmartAction!(b, cta.action);
                          }}
                          className="p-0.5 rounded shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                          style={{ color: cta.color }}
                          title={cta.title}
                        >
                          <CtaIcon className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {dayBookings.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-center">+{dayBookings.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import {
  Clock,
  User,
  Briefcase,
  CalendarDays,
} from "lucide-react";
import type { Booking } from "../components/bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import { contactName, formatTime } from "../components/bookings-types";

const STATUS_CARD: Record<string, string> = {
  PENDING: "border-amber-500/40 bg-amber-500/10",
  CONFIRMED: "border-blue-500/40 bg-blue-500/10",
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10",
  CANCELLED: "border-red-500/40 bg-red-500/10",
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-300",
  CONFIRMED: "bg-blue-500/20 text-blue-300",
  COMPLETED: "bg-emerald-500/20 text-emerald-300",
  CANCELLED: "bg-red-500/20 text-red-300",
};

const START_HOUR = 8;
const END_HOUR = 20;

interface DayTimelineProps {
  bookings: Booking[];
  currentDate: Date;
  onSelectBooking: (booking: Booking) => void;
  onSlotClick?: (date: string, time: string) => void;
}

export default function DayTimeline({
  bookings,
  currentDate,
  onSelectBooking,
  onSlotClick,
}: DayTimelineProps) {
  const dayBookings = useMemo(() => {
    const dateKey = currentDate.toISOString().split("T")[0];
    return bookings
      .filter((b) => new Date(b.startTime).toISOString().split("T")[0] === dateKey)
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
  }, [bookings, currentDate]);

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i),
    []
  );

  const bookingsByHour = useMemo(() => {
    const map = new Map<number, Booking[]>();
    for (const h of hours) map.set(h, []);
    for (const b of dayBookings) {
      const h = new Date(b.startTime).getHours();
      if (map.has(h)) map.get(h)!.push(b);
    }
    return map;
  }, [dayBookings, hours]);

  const dateStr = useMemo(() => {
    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
    const dd = String(currentDate.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [currentDate]);

  const dateLabel = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <CalendarDays
          className="w-4 h-4"
          style={{ color: "hsl(var(--kf-accent1))" }}
        />
        <span className="font-medium">{dateLabel}</span>
        <span className="text-muted-foreground">
          · {dayBookings.length} booking{dayBookings.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-0">
          {hours.map((hour) => {
            const hBookings = bookingsByHour.get(hour) ?? [];
            const label =
              hour === 12
                ? "12:00 PM"
                : hour > 12
                ? `${hour - 12}:00 PM`
                : `${hour}:00 AM`;

            return (
              <div
                key={hour}
                className="grid grid-cols-[70px_1fr] gap-2 min-h-[48px]"
              >
                <div className="text-right pt-1">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {label}
                  </span>
                </div>
                <div
                  className={`border-l border-border/30 pl-3 pb-2 space-y-2 ${hBookings.length === 0 && onSlotClick ? "cursor-pointer hover:bg-muted/20 transition-colors rounded-r-lg" : ""}`}
                  onClick={() => {
                    if (hBookings.length === 0 && onSlotClick) {
                      onSlotClick(dateStr, `${String(hour).padStart(2, "0")}:00`);
                    }
                  }}
                  role={hBookings.length === 0 && onSlotClick ? "button" : undefined}
                  aria-label={hBookings.length === 0 && onSlotClick ? `Book at ${label}` : undefined}
                  title={hBookings.length === 0 && onSlotClick ? `Click to book at ${label}` : undefined}
                >
                  {hBookings.map((b) => {
                    const durationMs =
                      new Date(b.endTime).getTime() -
                      new Date(b.startTime).getTime();
                    const durationMins = Math.round(durationMs / (1000 * 60));

                    return (
                      <button
                        key={b.id}
                        onClick={() => onSelectBooking(b)}
                        className={`w-full text-left rounded-xl border p-3 transition-all hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.3)] ${
                          STATUS_CARD[b.status] ??
                          "border-border/40 bg-muted/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {contactName(b)}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                  STATUS_BADGE[b.status] ??
                                  "bg-slate-500/20 text-slate-300"
                                }`}
                              >
                                {b.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTime(b.startTime)} –{" "}
                                {formatTime(b.endTime)}
                                <span className="opacity-60">
                                  ({durationMins}m)
                                </span>
                              </span>
                              {b.service && (
                                <span className="flex items-center gap-1">
                                  <Briefcase className="w-3 h-3" />
                                  {b.service.name}
                                </span>
                              )}
                              {b.staff && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  {b.staff.name}
                                </span>
                              )}
                            </div>
                          </div>
                          {b.service && (
                            <div className="text-right flex-shrink-0">
                              <div
                                className="text-sm font-semibold"
                                style={{
                                  color: "hsl(var(--kf-accent1))",
                                }}
                              >
                                {formatAmount(b.service.price)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {b.service.duration}m
                              </div>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
    </div>
  );
}

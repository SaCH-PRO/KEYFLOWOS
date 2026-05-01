"use client";

import { useMemo } from "react";
import {
  Clock,
  User,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  LogIn,
  FileText,
  RotateCcw,
  StickyNote,
  ExternalLink,
  MapPin,
} from "lucide-react";
import type { Booking } from "../components/bookings-types";
import type { GoogleCalendarEvent } from "@/lib/client";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import { contactName, formatTime, toLocalDateKey } from "../components/bookings-types";

const STATUS_CARD_STYLE: Record<string, React.CSSProperties> = {
  PENDING: { borderColor: "hsl(var(--kf-warning) / 0.4)", background: "hsl(var(--kf-warning) / 0.1)" },
  CONFIRMED: { borderColor: "hsl(var(--kf-info) / 0.4)", background: "hsl(var(--kf-info) / 0.1)" },
  COMPLETED: { borderColor: "hsl(var(--kf-success) / 0.4)", background: "hsl(var(--kf-success) / 0.1)" },
  CANCELLED: { borderColor: "hsl(var(--kf-error) / 0.4)", background: "hsl(var(--kf-error) / 0.1)" },
};

const STATUS_BADGE_STYLE: Record<string, React.CSSProperties> = {
  PENDING: { background: "hsl(var(--kf-warning) / 0.2)", color: "hsl(var(--kf-warning))" },
  CONFIRMED: { background: "hsl(var(--kf-info) / 0.2)", color: "hsl(var(--kf-info))" },
  COMPLETED: { background: "hsl(var(--kf-success) / 0.2)", color: "hsl(var(--kf-success))" },
  CANCELLED: { background: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" },
};

const START_HOUR = 8;
const END_HOUR = 20;

interface DayTimelineProps {
  bookings: Booking[];
  googleEvents?: GoogleCalendarEvent[];
  currentDate: Date;
  onSelectBooking: (booking: Booking) => void;
  onSlotClick?: (date: string, time: string) => void;
  onSmartAction?: (booking: Booking, action: string) => void;
}

const SMART_CTA: Record<string, { label: string; icon: typeof CheckCircle2; action: string; style: string }> = {
  PENDING: { label: "Confirm", icon: CheckCircle2, action: "CONFIRMED", style: "hsl(var(--kf-success))" },
  CONFIRMED: { label: "Check in", icon: LogIn, action: "COMPLETED", style: "hsl(var(--kf-accent2))" },
  COMPLETED: { label: "Invoice", icon: FileText, action: "INVOICE", style: "hsl(var(--kf-accent1))" },
  CANCELLED: { label: "Rebook", icon: RotateCcw, action: "REBOOK", style: "hsl(var(--kf-info))" },
};

function formatGoogleTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-TT", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function DayTimeline({
  bookings,
  googleEvents = [],
  currentDate,
  onSelectBooking,
  onSlotClick,
  onSmartAction,
}: DayTimelineProps) {
  const dateKey = useMemo(() => toLocalDateKey(currentDate), [currentDate]);

  const dayBookings = useMemo(() => {
    return bookings
      .filter((b) => toLocalDateKey(b.startTime) === dateKey)
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
  }, [bookings, dateKey]);

  const dayGoogleEvents = useMemo(() => {
    return googleEvents.filter((e) => {
      if (e.allDay) {
        const startDate = new Date(e.start + "T00:00:00");
        const endDate = new Date(e.end + "T00:00:00");
        const current = new Date(dateKey + "T00:00:00");
        return current >= startDate && current < endDate;
      }
      return toLocalDateKey(e.start) === dateKey;
    });
  }, [googleEvents, dateKey]);

  const timedGoogleEvents = useMemo(() => {
    return dayGoogleEvents.filter((e) => !e.allDay);
  }, [dayGoogleEvents]);

  const allDayGoogleEvents = useMemo(() => {
    return dayGoogleEvents.filter((e) => e.allDay);
  }, [dayGoogleEvents]);

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

  const googleEventsByHour = useMemo(() => {
    const map = new Map<number, GoogleCalendarEvent[]>();
    for (const h of hours) map.set(h, []);
    for (const e of timedGoogleEvents) {
      const h = new Date(e.start).getHours();
      if (map.has(h)) map.get(h)!.push(e);
    }
    return map;
  }, [timedGoogleEvents, hours]);

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

  const totalItems = dayBookings.length + dayGoogleEvents.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <CalendarDays
          className="w-4 h-4"
          style={{ color: "hsl(var(--kf-accent1))" }}
        />
        <span className="font-medium">{dateLabel}</span>
        <span className="text-muted-foreground">
          · {totalItems} event{totalItems !== 1 ? "s" : ""}
        </span>
      </div>

      {allDayGoogleEvents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allDayGoogleEvents.map((e) => (
            <a
              key={e.id}
              href={e.htmlLink ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                background: "hsl(var(--kf-accent2) / 0.1)",
                border: "1px dashed hsl(var(--kf-accent2) / 0.3)",
                color: "hsl(var(--kf-accent2))",
              }}
            >
              <CalendarDays className="w-3 h-3" />
              {e.summary}
              <span className="text-[10px] opacity-60">All day</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-50" />
            </a>
          ))}
        </div>
      )}

      <div className="space-y-0">
          {hours.map((hour) => {
            const hBookings = bookingsByHour.get(hour) ?? [];
            const hGoogleEvents = googleEventsByHour.get(hour) ?? [];
            const label =
              hour === 12
                ? "12:00 PM"
                : hour > 12
                ? `${hour - 12}:00 PM`
                : `${hour}:00 AM`;
            const hasItems = hBookings.length > 0 || hGoogleEvents.length > 0;

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
                  className={`border-l border-border/30 pl-3 pb-2 space-y-2 ${!hasItems && onSlotClick ? "cursor-pointer hover:bg-muted/20 transition-colors rounded-r-lg" : ""}`}
                  onClick={() => {
                    if (!hasItems && onSlotClick) {
                      onSlotClick(dateStr, `${String(hour).padStart(2, "0")}:00`);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!hasItems && onSlotClick && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSlotClick(dateStr, `${String(hour).padStart(2, "0")}:00`);
                    }
                  }}
                  role={!hasItems && onSlotClick ? "button" : undefined}
                  tabIndex={!hasItems && onSlotClick ? 0 : undefined}
                  aria-label={!hasItems && onSlotClick ? `Book at ${label}` : undefined}
                  title={!hasItems && onSlotClick ? `Click to book at ${label}` : undefined}
                >
                  {hBookings.map((b) => {
                    const durationMs =
                      new Date(b.endTime).getTime() -
                      new Date(b.startTime).getTime();
                    const durationMins = Math.round(durationMs / (1000 * 60));
                    const cta = onSmartAction ? SMART_CTA[b.status] : undefined;
                    const CtaIcon = cta?.icon;

                    return (
                      <div
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectBooking(b)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectBooking(b);
                          }
                        }}
                        aria-label={`${contactName(b)} - ${b.status} - ${formatTime(b.startTime)}`}
                        className="w-full text-left rounded-xl border p-3 transition-all hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.3)] cursor-pointer"
                        style={STATUS_CARD_STYLE[b.status] ?? { borderColor: "hsl(var(--border) / 0.4)", background: "hsl(var(--muted) / 0.1)" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {contactName(b)}
                              </span>
                              <span
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                                style={STATUS_BADGE_STYLE[b.status] ?? { background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}
                              >
                                {b.status}
                              </span>
                              {b.location && (
                                <MapPin className="w-3 h-3 text-muted-foreground opacity-60" aria-label="Has location" />
                              )}
                              {b.notes && (
                                <StickyNote className="w-3 h-3 text-muted-foreground opacity-60" aria-label="Has notes" />
                              )}
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
                              {b.location && (
                                <span className="flex items-center gap-1 truncate max-w-[200px]">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{b.location}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {b.service && (
                              <div className="text-right">
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
                            {cta && CtaIcon && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSmartAction?.(b, cta.action);
                                }}
                                className="px-2.5 min-h-[44px] rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0"
                                style={{
                                  background: `${cta.style.replace(")", " / 0.1)")} `,
                                  color: cta.style,
                                  borderWidth: 1,
                                  borderColor: `${cta.style.replace(")", " / 0.25)")}`,
                                }}
                                aria-label={`${cta.label} booking for ${contactName(b)}`}
                              >
                                <CtaIcon className="w-3 h-3" />
                                {cta.label}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {hGoogleEvents.map((e) => {
                    const durationMs = new Date(e.end).getTime() - new Date(e.start).getTime();
                    const durationMins = Math.round(durationMs / (1000 * 60));

                    return (
                      <a
                        key={e.id}
                        href={e.htmlLink ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-left rounded-xl border p-3 transition-all hover:ring-1 cursor-pointer block"
                        style={{
                          borderColor: "hsl(var(--kf-accent2) / 0.3)",
                          borderStyle: "dashed",
                          background: "hsl(var(--kf-accent2) / 0.06)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate" style={{ color: "hsl(var(--kf-accent2))" }}>
                                {e.summary}
                              </span>
                              <span
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                                style={{
                                  background: "hsl(var(--kf-accent2) / 0.15)",
                                  color: "hsl(var(--kf-accent2))",
                                }}
                              >
                                Google
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatGoogleTime(e.start)} – {formatGoogleTime(e.end)}
                                <span className="opacity-60">({durationMins}m)</span>
                              </span>
                              {e.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {e.location}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <ExternalLink className="w-3.5 h-3.5 opacity-40" style={{ color: "hsl(var(--kf-accent2))" }} />
                          </div>
                        </div>
                      </a>
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

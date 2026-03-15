"use client";

import { useMemo } from "react";
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  DollarSign,
} from "lucide-react";
import type { Booking, BookingStats } from "./bookings-types";
import { formatTime, contactName } from "./bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";

interface TodayStripProps {
  bookings: Booking[];
  stats: BookingStats | null;
  onSelectBooking: (booking: Booking) => void;
  onConfirmBooking: (bookingId: string) => void;
}

export default function TodayStrip({
  bookings,
  stats,
  onSelectBooking,
  onConfirmBooking,
}: TodayStripProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = today.toISOString().split("T")[0];

  const todayBookings = useMemo(
    () =>
      bookings
        .filter((b) => new Date(b.startTime).toISOString().split("T")[0] === todayKey)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [bookings, todayKey]
  );

  const todayPending = useMemo(
    () => todayBookings.filter((b) => b.status === "PENDING"),
    [todayBookings]
  );

  const todayCompleted = useMemo(
    () => todayBookings.filter((b) => b.status === "COMPLETED").length,
    [todayBookings]
  );

  const todayRevenue = useMemo(
    () =>
      todayBookings
        .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
        .reduce((sum, b) => sum + (b.service?.price ?? 0), 0),
    [todayBookings]
  );

  const metrics = [
    {
      label: "Today",
      value: stats?.todayCount ?? todayBookings.length,
      icon: CalendarDays,
      accent: "var(--kf-accent1)",
    },
    {
      label: "Pending",
      value: todayPending.length,
      icon: AlertCircle,
      accent: "var(--kf-warning)",
    },
    {
      label: "Done",
      value: todayCompleted,
      icon: CheckCircle2,
      accent: "var(--kf-success)",
    },
    {
      label: "Revenue",
      value: formatAmount(todayRevenue),
      icon: DollarSign,
      accent: "var(--kf-accent2)",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="kf-card rounded-xl px-3 py-2.5 flex items-center gap-2.5"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `hsl(${m.accent} / 0.12)` }}
            >
              <m.icon className="w-4 h-4" style={{ color: `hsl(${m.accent})` }} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {m.label}
              </p>
              <p className="text-lg font-bold truncate">{m.value}</p>
            </div>
          </div>
        ))}
      </div>

      {todayPending.length > 0 && (
        <div className="kf-card rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "hsl(var(--kf-warning))" }}
            />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Needs Confirmation
            </span>
          </div>
          <div className="space-y-1">
            {todayPending.slice(0, 4).map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/20 transition-colors group"
              >
                <button
                  onClick={() => onSelectBooking(b)}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left"
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatTime(b.startTime)}
                  </div>
                  <span className="text-xs font-medium truncate">
                    {contactName(b)}
                  </span>
                  {b.service && (
                    <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                      {b.service.name}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmBooking(b.id);
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors"
                  style={{
                    background: "hsl(var(--kf-success) / 0.1)",
                    color: "hsl(var(--kf-success))",
                    borderWidth: 1,
                    borderColor: "hsl(var(--kf-success) / 0.25)",
                  }}
                >
                  Confirm
                </button>
              </div>
            ))}
            {todayPending.length > 4 && (
              <p className="text-[10px] text-muted-foreground text-center pt-1">
                +{todayPending.length - 4} more pending
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

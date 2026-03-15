"use client";

import { useMemo } from "react";
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  ShieldAlert,
  Users,
} from "lucide-react";
import type { Booking, BookingStats } from "./bookings-types";
import type { ScheduleHealth } from "@/lib/client";
import { formatTime, contactName } from "./bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";

interface TodayStripProps {
  bookings: Booking[];
  stats: BookingStats | null;
  scheduleHealth: ScheduleHealth | null;
  staff: { id: string; name: string }[];
  onSelectBooking: (booking: Booking) => void;
  onConfirmBooking: (bookingId: string) => void;
}

export default function TodayStrip({
  bookings,
  stats,
  scheduleHealth,
  staff,
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

  const noShowRisks = useMemo(() => {
    if (!scheduleHealth?.noShowRisks) return [];
    const todayBookingIds = new Set(todayBookings.map((b) => b.id));
    return scheduleHealth.noShowRisks
      .filter((r) => r.riskLevel === "HIGH" && todayBookingIds.has(r.bookingId))
      .slice(0, 4);
  }, [scheduleHealth, todayBookings]);

  const overbookedStaff = useMemo(() => {
    const staffBookingCounts = new Map<string, number>();
    todayBookings
      .filter((b) => b.status !== "CANCELLED")
      .forEach((b) => {
        if (b.staff?.id) {
          staffBookingCounts.set(b.staff.id, (staffBookingCounts.get(b.staff.id) ?? 0) + 1);
        }
      });
    const threshold = 6;
    return Array.from(staffBookingCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([staffId, count]) => {
        const s = staff.find((m) => m.id === staffId);
        return { staffId, name: s?.name ?? "Unknown", bookingCount: count };
      });
  }, [todayBookings, staff]);

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

  const hasPriorityItems = todayPending.length > 0 || noShowRisks.length > 0 || overbookedStaff.length > 0;

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

      {hasPriorityItems && (
        <div className="kf-card rounded-xl p-3 space-y-3">
          {todayPending.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "hsl(var(--kf-warning))" }}
                />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Needs Confirmation
                </span>
                <span className="text-[10px] text-muted-foreground">({todayPending.length})</span>
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

          {noShowRisks.length > 0 && (
            <div className="space-y-2">
              {todayPending.length > 0 && <div className="border-t border-border/40" />}
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "hsl(var(--kf-error))" }}
                />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  No-Show Risk
                </span>
                <span className="text-[10px] text-muted-foreground">({noShowRisks.length})</span>
              </div>
              <div className="space-y-1">
                {noShowRisks.map((risk) => {
                  const booking = todayBookings.find((b) => b.id === risk.bookingId);
                  return (
                    <div
                      key={risk.bookingId}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/20 transition-colors"
                    >
                      <button
                        onClick={() => booking && onSelectBooking(booking)}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
                        <span className="text-xs font-medium truncate">{risk.contactName}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(risk.riskScore * 100)}% risk
                        </span>
                      </button>
                      {booking && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfirmBooking(booking.id);
                          }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors"
                          style={{
                            background: "hsl(var(--kf-info) / 0.1)",
                            color: "hsl(var(--kf-info))",
                            borderWidth: 1,
                            borderColor: "hsl(var(--kf-info) / 0.25)",
                          }}
                        >
                          Send Reminder
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {overbookedStaff.length > 0 && (
            <div className="space-y-2">
              {(todayPending.length > 0 || noShowRisks.length > 0) && <div className="border-t border-border/40" />}
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Overbooked Staff
                </span>
              </div>
              <div className="space-y-1">
                {overbookedStaff.map((s) => (
                  <div
                    key={s.staffId}
                    className="flex items-center gap-3 p-2 rounded-lg"
                  >
                    <Users className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                    <span className="text-xs font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.bookingCount} bookings today
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

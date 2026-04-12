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
  StickyNote,
  Activity,
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
  onSendReminder?: (bookingId: string) => void;
  onViewStaffLoad?: (staffId: string) => void;
}

export default function TodayStrip({
  bookings,
  stats,
  scheduleHealth,
  staff,
  onSelectBooking,
  onConfirmBooking,
  onSendReminder,
  onViewStaffLoad,
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

  const utilization = useMemo(() => {
    const util = scheduleHealth?.weeklyUtilization ?? [];
    if (util.length === 0) return null;
    return Math.round(util.reduce((s, d) => s + (d.utilizationRate ?? 0), 0) / util.length);
  }, [scheduleHealth]);

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
    ...(utilization !== null ? [{
      label: "Utilization",
      value: `${utilization}%`,
      icon: Activity,
      accent: utilization >= 70 ? "var(--kf-success)" : utilization >= 40 ? "var(--kf-warning)" : "var(--kf-error)",
    }] : []),
  ];

  const hasPriorityItems = todayPending.length > 0 || noShowRisks.length > 0 || overbookedStaff.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="kf-card rounded-xl px-3 py-2 flex items-center gap-2 min-w-0 shrink-0"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `hsl(${m.accent} / 0.12)` }}
            >
              <m.icon className="w-3.5 h-3.5" style={{ color: `hsl(${m.accent})` }} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
                {m.label}
              </p>
              <p className="text-base font-bold leading-none truncate">{m.value}</p>
            </div>
          </div>
        ))}
      </div>

      {hasPriorityItems && (
        <div className="kf-card rounded-xl p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 px-0.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-warning))" }} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Priority</span>
            <span className="text-[9px] text-muted-foreground">
              ({todayPending.length + noShowRisks.length + overbookedStaff.length})
            </span>
          </div>

          {todayPending.length > 0 && (
            <div className="space-y-0.5">
              {todayPending.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/20 transition-colors group"
                >
                  <button
                    onClick={() => onSelectBooking(b)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <AlertCircle className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
                    <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTime(b.startTime)}
                    </span>
                    <span className="text-xs font-medium truncate">
                      {contactName(b)}
                    </span>
                    {b.service && (
                      <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                        {b.service.name}
                      </span>
                    )}
                    {b.notes && (
                      <span className="text-muted-foreground/60 hidden sm:flex shrink-0" title={b.notes}>
                        <StickyNote className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmBooking(b.id);
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 transition-colors"
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
              {todayPending.length > 3 && (
                <p className="text-[9px] text-muted-foreground text-center">
                  +{todayPending.length - 3} more pending
                </p>
              )}
            </div>
          )}

          {noShowRisks.length > 0 && (
            <div className="space-y-0.5">
              {todayPending.length > 0 && <div className="border-t border-border/30" />}
              {noShowRisks.map((risk) => {
                const booking = todayBookings.find((b) => b.id === risk.bookingId);
                return (
                  <div
                    key={risk.bookingId}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/20 transition-colors"
                  >
                    <button
                      onClick={() => booking && onSelectBooking(booking)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      <ShieldAlert className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
                      <span className="text-xs font-medium truncate">{risk.contactName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(risk.riskScore * 100)}% risk
                      </span>
                    </button>
                    {booking && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSendReminder) onSendReminder(booking.id);
                          else onSelectBooking(booking);
                        }}
                        className="px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 transition-colors"
                        style={{
                          background: "hsl(var(--kf-info) / 0.1)",
                          color: "hsl(var(--kf-info))",
                          borderWidth: 1,
                          borderColor: "hsl(var(--kf-info) / 0.25)",
                        }}
                      >
                        Remind
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {overbookedStaff.length > 0 && (
            <div className="space-y-0.5">
              {(todayPending.length > 0 || noShowRisks.length > 0) && <div className="border-t border-border/30" />}
              {overbookedStaff.map((s) => (
                <div
                  key={s.staffId}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/20 transition-colors"
                >
                  <Users className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <span className="text-xs font-medium">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground flex-1">
                    {s.bookingCount} bookings
                  </span>
                  <button
                    onClick={() => onViewStaffLoad?.(s.staffId)}
                    className="px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 transition-colors"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.1)",
                      color: "hsl(var(--kf-accent1))",
                      borderWidth: 1,
                      borderColor: "hsl(var(--kf-accent1) / 0.25)",
                    }}
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

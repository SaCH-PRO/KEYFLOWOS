import type React from "react";
export type { Booking, Service, StaffMember, Contact, BookingStats } from "@/lib/client";
import type { Booking } from "@/lib/client";

export type Tab = "schedule" | "performance" | "catalog" | "waitlist";
export type SetupSubTab = "services" | "staff" | "availability" | "hours";
export type StatusFilter = "ALL" | "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

export const STATUS_STYLE: Record<string, React.CSSProperties> = {
  PENDING: { background: "hsl(var(--kf-warning) / 0.2)", color: "hsl(var(--kf-warning))", borderColor: "hsl(var(--kf-warning) / 0.3)" },
  CONFIRMED: { background: "hsl(var(--kf-success) / 0.2)", color: "hsl(var(--kf-success))", borderColor: "hsl(var(--kf-success) / 0.3)" },
  CANCELLED: { background: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))", borderColor: "hsl(var(--kf-error) / 0.3)" },
  COMPLETED: { background: "hsl(var(--secondary) / 0.2)", color: "hsl(var(--secondary))", borderColor: "hsl(var(--secondary) / 0.3)" },
};

export function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-TT", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-TT", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatFullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-TT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function contactName(booking: Booking): string {
  const c = booking.contact;
  if (!c) return "Walk-in";
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unknown";
}

export function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function toLocalDateKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

import type {
  CalendarEvent,
  CalendarEventModule,
  CalendarEventStatus,
  CalendarEventType,
} from "@/lib/client";

export const MODULE_META: Record<
  CalendarEventModule | "default",
  { label: string; color: string }
> = {
  BOOKINGS: { label: "Bookings", color: "#3b82f6" },
  CRM: { label: "CRM", color: "#14B8A6" },
  MARKETING: { label: "Marketing", color: "#a78bfa" },
  REVENUE: { label: "Revenue", color: "#F97316" },
  PROJECTS: { label: "Projects", color: "#8b5cf6" },
  ORDERS: { label: "Orders", color: "#f59e0b" },
  EXTERNAL: { label: "External", color: "#6b7280" },
  ACTIVITY: { label: "Activity", color: "#9ca3af" },
  default: { label: "Event", color: "#6b7280" },
};

export const ALL_MODULES: CalendarEventModule[] = [
  "BOOKINGS",
  "CRM",
  "MARKETING",
  "REVENUE",
  "PROJECTS",
  "ORDERS",
  "EXTERNAL",
  "ACTIVITY",
];

export const ALL_TYPES: CalendarEventType[] = [
  "BOOKING",
  "CONTENT_POST",
  "EMAIL_CAMPAIGN",
  "CONTACT_TASK",
  "FOLLOW_UP",
  "INVOICE_DUE",
  "INVOICE_OVERDUE",
  "QUOTE_EXPIRY",
  "PROJECT_TASK",
  "SHIPMENT",
  "REORDER",
  "RECURRING_INVOICE",
  "EXTERNAL_GOOGLE_EVENT",
  "ACTIVITY_LOG",
];

export const ALL_STATUSES: CalendarEventStatus[] = [
  "SCHEDULED",
  "TENTATIVE",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "OVERDUE",
  "FAILED",
];

export type TimePreset =
  | "today"
  | "thisWeek"
  | "next7"
  | "next30"
  | "overdue"
  | "unscheduled";

export const TIME_PRESETS: { key: TimePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "next7", label: "Next 7 days" },
  { key: "next30", label: "Next 30 days" },
  { key: "overdue", label: "Overdue" },
  { key: "unscheduled", label: "Unscheduled" },
];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  return endOfDay(new Date(s.getTime() + 6 * 86400000));
}

export function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  return startOfDay(x);
}

export function endOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  return endOfDay(x);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function fmtMoney(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
    }).format(amount);
  } catch {
    return `${currency ?? "USD"} ${amount.toFixed(2)}`;
  }
}

export function moduleMeta(m: CalendarEventModule | string | null | undefined) {
  if (!m) return MODULE_META.default;
  return (MODULE_META as Record<string, { label: string; color: string }>)[m] ?? MODULE_META.default;
}

export function presetRange(preset: TimePreset, now = new Date()): { start: string; end: string } {
  const today = startOfDay(now);
  if (preset === "today") {
    return { start: today.toISOString(), end: endOfDay(now).toISOString() };
  }
  if (preset === "thisWeek") {
    return { start: startOfWeek(now).toISOString(), end: endOfWeek(now).toISOString() };
  }
  if (preset === "next7") {
    return {
      start: today.toISOString(),
      end: endOfDay(new Date(today.getTime() + 6 * 86400000)).toISOString(),
    };
  }
  if (preset === "next30") {
    return {
      start: today.toISOString(),
      end: endOfDay(new Date(today.getTime() + 29 * 86400000)).toISOString(),
    };
  }
  if (preset === "overdue") {
    const past = new Date(today);
    past.setDate(past.getDate() - 60);
    return { start: past.toISOString(), end: endOfDay(now).toISOString() };
  }
  // unscheduled — just return the next 30 days as the lookup window
  return {
    start: today.toISOString(),
    end: endOfDay(new Date(today.getTime() + 29 * 86400000)).toISOString(),
  };
}

/**
 * Drag-to-reschedule policy.
 *  - locked: never draggable (paid invoice, completed, payment received, external Google).
 *  - confirm: requires confirmation dialog (synced to Google / customer-facing / paid invoice).
 */
export function reschedulePolicy(ev: CalendarEvent): {
  locked: boolean;
  needsConfirm: boolean;
  reason?: string;
} {
  const meta = (ev.meta ?? {}) as { paid?: boolean; invoiceStatus?: string };
  const isPaidInvoice =
    ev.sourceType === "invoice" &&
    (meta.paid === true || (meta.invoiceStatus ?? "").toLowerCase() === "paid");

  if (ev.status === "COMPLETED") {
    return { locked: true, needsConfirm: false, reason: "Completed events cannot be moved." };
  }
  if (ev.sourceType === "payment") {
    return { locked: true, needsConfirm: false, reason: "Payments cannot be rescheduled." };
  }
  if (isPaidInvoice) {
    return { locked: true, needsConfirm: false, reason: "Paid invoices cannot be rescheduled." };
  }
  if (ev.sourceType === "google_event" || ev.type === "EXTERNAL_GOOGLE_EVENT") {
    return { locked: true, needsConfirm: false, reason: "External Google events are read-only." };
  }

  const draggable = new Set([
    "booking",
    "contact_task",
    "project_task",
    "social_post",
    "reminder",
  ]);
  if (
    !draggable.has(ev.sourceType) &&
    !ev.sourceType.startsWith("manual_") &&
    ev.sourceType !== "activity"
  ) {
    return {
      locked: true,
      needsConfirm: false,
      reason: "This source does not support drag-to-reschedule.",
    };
  }

  const syncedToGoogle = ev.syncStatus === "SYNCED" || !!ev.googleEventId;
  const customerFacing = ev.visibility === "PUBLIC";
  if (syncedToGoogle || customerFacing) {
    return {
      locked: false,
      needsConfirm: true,
      reason: syncedToGoogle
        ? "This event is synced to Google Calendar."
        : "This event is customer-facing.",
    };
  }
  return { locked: false, needsConfirm: false };
}

export function statusColor(status: CalendarEventStatus): string {
  switch (status) {
    case "COMPLETED":
      return "#22c55e";
    case "CONFIRMED":
      return "#14B8A6";
    case "IN_PROGRESS":
      return "#3b82f6";
    case "TENTATIVE":
      return "#a78bfa";
    case "CANCELLED":
      return "#6b7280";
    case "OVERDUE":
    case "FAILED":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

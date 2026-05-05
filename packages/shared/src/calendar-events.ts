/**
 * Canonical CalendarEvent type registry.
 *
 * Every "scheduled / due / planned" record across the product (bookings,
 * social posts, email campaigns, contact tasks, invoices, quotes, projects,
 * orders, recurring invoices, external Google events, etc.) is projected
 * into a single CalendarEvent row. The strings below are the only legal
 * values for `CalendarEvent.type` and `CalendarEvent.module`.
 *
 * Keep this list in sync with the Prisma schema comments and with the
 * projection helpers in apps/server/src/modules/calendar.
 */

export const CALENDAR_EVENT_TYPES = [
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
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_MODULES = [
  "BOOKINGS",
  "MARKETING",
  "CRM",
  "REVENUE",
  "PROJECTS",
  "ORDERS",
  "EXTERNAL",
  "ACTIVITY",
] as const;

export type CalendarEventModule = (typeof CALENDAR_EVENT_MODULES)[number];

export const CALENDAR_EVENT_STATUSES = [
  "SCHEDULED",
  "TENTATIVE",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "OVERDUE",
  "FAILED",
] as const;

export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const CALENDAR_EVENT_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export type CalendarEventPriority = (typeof CALENDAR_EVENT_PRIORITIES)[number];

export const CALENDAR_EVENT_VISIBILITIES = [
  "PRIVATE",
  "TEAM",
  "PUBLIC",
] as const;

export type CalendarEventVisibility =
  (typeof CALENDAR_EVENT_VISIBILITIES)[number];

export const CALENDAR_SYNC_STATUSES = [
  "LOCAL",
  "PENDING",
  "SYNCED",
  "ERROR",
  "DISABLED",
] as const;

export type CalendarSyncStatus = (typeof CALENDAR_SYNC_STATUSES)[number];

/**
 * Source-type strings stored on `CalendarEvent.sourceType`. These map 1:1
 * to the originating Prisma model so any module can call
 * `CalendarProjectionService.upsertFromSource({ sourceType, sourceId, ... })`
 * without importing the calendar module's internals.
 */
export const CALENDAR_SOURCE_TYPES = [
  "booking",
  "social_post",
  "email_campaign",
  "contact_task",
  "invoice",
  "invoice_overdue",
  "quote",
  "project",
  "project_task",
  "marketplace_order",
  "shipment",
  "recurring_invoice",
  "google_event",
  "activity",
] as const;

export type CalendarSourceType = (typeof CALENDAR_SOURCE_TYPES)[number];

/**
 * Default visual colors per event type. The UI is free to override per
 * event via `CalendarEvent.color`.
 */
export const CALENDAR_EVENT_DEFAULT_COLORS: Record<CalendarEventType, string> =
  {
    BOOKING: "#0EA5E9",
    CONTENT_POST: "#A855F7",
    EMAIL_CAMPAIGN: "#EC4899",
    CONTACT_TASK: "#F59E0B",
    FOLLOW_UP: "#F97316",
    INVOICE_DUE: "#10B981",
    INVOICE_OVERDUE: "#EF4444",
    QUOTE_EXPIRY: "#84CC16",
    PROJECT_TASK: "#6366F1",
    SHIPMENT: "#14B8A6",
    REORDER: "#22D3EE",
    RECURRING_INVOICE: "#34D399",
    EXTERNAL_GOOGLE_EVENT: "#4285F4",
    ACTIVITY_LOG: "#94A3B8",
  };

export interface CalendarEventInput {
  businessId: string;
  title: string;
  description?: string | null;
  type: CalendarEventType;
  module: CalendarEventModule;
  startAt: Date;
  endAt?: Date | null;
  allDay?: boolean;
  timezone?: string | null;
  status?: CalendarEventStatus;
  priority?: CalendarEventPriority;
  color?: string | null;
  visibility?: CalendarEventVisibility;
  sourceType: CalendarSourceType;
  sourceId: string;
  sourceUrl?: string | null;
  contactId?: string | null;
  staffId?: string | null;
  assigneeId?: string | null;
  amount?: number | null;
  currency?: string | null;
  meta?: Record<string, unknown> | null;
}

"use client";

import {
  CreditCard,
  Wallet,
  Building2,
  FileText,
  DollarSign,
} from "lucide-react";
import { formatCurrency as formatMoney } from "@/lib/currency";
import { getCachedBusiness } from "@/lib/workspace";
import type { RecurringExpense } from "@/lib/client";

export const CATEGORY_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e",
  "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e",
];

export const PERIODS = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "ytd", label: "Year to Date" },
  { value: "12m", label: "12 Months" },
];

export const PAYMENT_ICONS: Record<string, typeof CreditCard> = {
  cash: Wallet, card: CreditCard, bank_transfer: Building2, linx: CreditCard,
  mobile_money: Wallet, cheque: FileText, other: DollarSign, unspecified: DollarSign,
};

/** Trinidad: the zone a business has unless it names another (Business.timezone's default). */
export const DEFAULT_TIME_ZONE = "America/Port_of_Spain";

function cachedBusiness(): { currency?: unknown; timezone?: unknown } | null {
  try {
    return (getCachedBusiness() as { currency?: unknown; timezone?: unknown } | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * EXPENSES-HUB-2 (BUG-027): the business currency, as the workspace cached it
 * (the server writes it on every expense that names none, FOLLOW3-B4 / D-13).
 * TTD only when nothing is known.
 */
export function businessCurrency(): string {
  const c = cachedBusiness()?.currency;
  return typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim()) ? c.trim().toUpperCase() : "TTD";
}

/** The business's time zone when the workspace carries one, else Trinidad's. */
export function businessTimeZone(): string {
  const tz = cachedBusiness()?.timezone;
  if (typeof tz === "string" && tz.trim()) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz.trim() });
      return tz.trim();
    } catch {
      // an unknown zone: Trinidad's
    }
  }
  return DEFAULT_TIME_ZONE;
}

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function dayInZone(at: Date, timeZone: string = businessTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** EXPENSES-HUB-2 (BUG-028): today in the business's zone (Trinidad), never the UTC date. */
export function todayInBusinessZone(now: Date = new Date()): string {
  return dayInZone(now);
}

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

/**
 * EXPENSES-HUB-2 (BUG-061): the day a schedule is next due, one period after
 * `day` (the expense saved now is this period's). Calendar arithmetic: a
 * month from 31 January is 28 (or 29) February, not 3 March.
 */
export function nextRunAfter(day: string, frequency: string): string {
  const p = parseDay(day);
  if (!p) return day;
  const months: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
  const days: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14 };
  let next: Date;
  if (days[frequency]) next = new Date(Date.UTC(p.y, p.m - 1, p.d + days[frequency]));
  else {
    const add = months[frequency] ?? 1;
    const lastDay = new Date(Date.UTC(p.y, p.m - 1 + add + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(p.y, p.m - 1 + add, Math.min(p.d, lastDay)));
  }
  return next.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (YYYY-MM-DD), or null when either is not a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** An amount in its own currency, else in the business currency (BUG-027: it was always "TTD"). */
export function formatCurrency(amount: number, currency?: string | null): string {
  const code = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : businessCurrency();
  return formatMoney(amount, code);
}

/**
 * A calendar date (an expense's date, a schedule's next run): stored as
 * midnight UTC, so it is read as that day, not as the instant in local time
 * (in Port of Spain that was the day before).
 */
export function formatDate(dateStr: string): string {
  const p = parseDay(dateStr);
  const at = p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : new Date(dateStr);
  return at.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** A calendar date, short: "Dec 25". */
export function formatShortDate(dateStr: string): string {
  const p = parseDay(dateStr);
  const at = p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : new Date(dateStr);
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** What a saved expense (or bill) gives its recurring schedule. */
export interface ScheduleSource {
  description: string;
  amount: number;
  /** The expense's date (YYYY-MM-DD): this period's; the schedule is next due one period later. */
  date: string;
  frequency: string;
  vendor?: string | null;
  paymentMethod?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  projectId?: string | null;
  contactId?: string | null;
  serviceId?: string | null;
  /** A bill to pay later: the schedule creates bills, due as many days after their date as this one. */
  bill?: { dueDate?: string | null } | null;
}

/**
 * EXPENSES-HUB-2 (BUG-061): the body of POST /expenses/.../recurring for a
 * saved expense marked recurring. No currency: the server writes the business
 * currency (FOLLOW3-B4, D-13).
 */
export function recurringScheduleBody(src: ScheduleSource): Partial<RecurringExpense> {
  const date = parseDay(src.date) ? src.date.slice(0, 10) : todayInBusinessZone();
  const body: Partial<RecurringExpense> = {
    name: src.description,
    description: src.description,
    amount: src.amount,
    frequency: src.frequency,
    nextRunDate: nextRunAfter(date, src.frequency),
    createsBill: Boolean(src.bill),
  };
  if (src.vendor) body.vendor = src.vendor;
  if (src.paymentMethod && !src.bill) body.paymentMethod = src.paymentMethod;
  if (src.categoryId) body.categoryId = src.categoryId;
  if (src.notes) body.notes = src.notes;
  if (src.projectId) body.projectId = src.projectId;
  if (src.contactId) body.contactId = src.contactId;
  if (src.serviceId) body.serviceId = src.serviceId;
  if (src.bill?.dueDate) {
    const offset = daysBetween(date, src.bill.dueDate);
    if (offset !== null && offset >= 0) body.dueOffsetDays = offset;
  }
  return body;
}

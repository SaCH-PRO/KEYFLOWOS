"use client";

import {
  CreditCard,
  Wallet,
  Building2,
  FileText,
  DollarSign,
} from "lucide-react";
import { formatCurrency as formatMoney } from "@/lib/currency";
import { getCachedBusiness, getStoredBusinessId } from "@/lib/workspace";
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

/**
 * The cached workspace business, only when it is the business in hand (`businessId`, else the stored one):
 * another tab that switched business can leave Y cached while X's form is open (SEC-EXH2-1).
 */
function cachedBusiness(businessId?: string | null): { currency?: unknown; timezone?: unknown } | null {
  try {
    const cached = (getCachedBusiness() as { id?: unknown; currency?: unknown; timezone?: unknown } | null) ?? null;
    if (!cached) return null;
    let expected: string | null = businessId ?? null;
    if (!expected) {
      try {
        expected = getStoredBusinessId();
      } catch {
        expected = null;
      }
    }
    if (expected && cached.id !== expected) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * EXPENSES-HUB-2 (BUG-027): the business currency, as the workspace cached it
 * (the server writes it on every expense that names none, FOLLOW3-B4 / D-13).
 * TTD only when nothing is known.
 */
export function businessCurrency(businessId?: string | null): string {
  const c = cachedBusiness(businessId)?.currency;
  return typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim()) ? c.trim().toUpperCase() : "TTD";
}

/** The business's time zone when the workspace carries one, else Trinidad's. */
export function businessTimeZone(businessId?: string | null): string {
  const tz = cachedBusiness(businessId)?.timezone;
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
export function todayInBusinessZone(now: Date = new Date(), businessId?: string | null): string {
  return dayInZone(now, businessTimeZone(businessId));
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
export function nextRunAfter(day: string, frequency: string, periods = 1): string {
  const p = parseDay(day);
  if (!p) return day;
  const months: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
  const days: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14 };
  let next: Date;
  if (days[frequency]) next = new Date(Date.UTC(p.y, p.m - 1, p.d + days[frequency] * periods));
  else {
    const add = (months[frequency] ?? 1) * periods;
    const lastDay = new Date(Date.UTC(p.y, p.m - 1 + add + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(p.y, p.m - 1 + add, Math.min(p.d, lastDay)));
  }
  return next.toISOString().slice(0, 10);
}

/**
 * COR-F1: the first run of a schedule for an expense dated `day`: the first period boundary from `day` strictly
 * after `today`. The server generates one expense per due period from nextRunDate, so a first run in the past
 * would book every missed period at once (a back-dated expense would flood the books); there is no catch-up.
 * Each boundary is counted from `day` itself, so a month-end date keeps its day where the month has it.
 */
export function firstRunAfter(day: string, frequency: string, today: string): string {
  if (!parseDay(day) || !parseDay(today)) return nextRunAfter(day, frequency);
  let periods = 1;
  let next = nextRunAfter(day, frequency, periods);
  while (next <= today && periods < 100_000) {
    periods += 1;
    next = nextRunAfter(day, frequency, periods);
  }
  return next;
}

/** The day after `day` (YYYY-MM-DD). */
export function dayAfter(day: string): string {
  const p = parseDay(day);
  if (!p) return day;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + 1)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (YYYY-MM-DD), or null when either is not a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** An amount in its own currency, else in the business currency (BUG-027: it was always "TTD"). */
export function formatCurrency(amount: number, currency?: string | null, businessId?: string | null): string {
  const code = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : businessCurrency(businessId);
  return formatMoney(amount, code);
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?Z)?$/;

/**
 * A date as a person reads it. A calendar day (date-only, or exactly midnight UTC, as the forms store an
 * expense's date) is that day; a stored instant (an expense dated `new Date()` elsewhere, a schedule's run
 * time) is the day it falls on in the business's zone. Read in local time, a calendar day showed a day early
 * in Port of Spain (COR-F2).
 */
function displayDay(dateStr: string, options: Intl.DateTimeFormatOptions, businessId?: string | null): string {
  const day = CALENDAR_DAY.exec(dateStr);
  if (day) return new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  const at = new Date(dateStr);
  if (Number.isNaN(at.getTime())) return dateStr;
  return at.toLocaleDateString("en-US", { ...options, timeZone: businessTimeZone(businessId) });
}

/** `businessId`: the business the date belongs to (SEC-r1-1); without it, the stored one. */
export function formatDate(dateStr: string, businessId?: string | null): string {
  return displayDay(dateStr, { year: "numeric", month: "short", day: "numeric" }, businessId);
}

/** A date, short: "Dec 25". */
export function formatShortDate(dateStr: string, businessId?: string | null): string {
  return displayDay(dateStr, { month: "short", day: "numeric" }, businessId);
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
export function recurringScheduleBody(src: ScheduleSource, businessId?: string | null): Partial<RecurringExpense> {
  const today = todayInBusinessZone(new Date(), businessId);
  const date = parseDay(src.date) ? src.date.slice(0, 10) : today;
  const body: Partial<RecurringExpense> = {
    name: src.description,
    description: src.description,
    amount: src.amount,
    frequency: src.frequency,
    nextRunDate: firstRunAfter(date, src.frequency, today),
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

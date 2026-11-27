"use client";

import {
  CreditCard,
  Wallet,
  Building2,
  FileText,
  DollarSign,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
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

/** A real calendar day written YYYY-MM-DD (not "9/1/2025", not 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const p = parseDay(value);
  if (!p) return false;
  const at = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return at.getUTCFullYear() === p.y && at.getUTCMonth() === p.m - 1 && at.getUTCDate() === p.d;
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
export function recurringScheduleBody(src: ScheduleSource, businessId?: string | null, timeZone?: string): Partial<RecurringExpense> {
  // R18-8: the zone the save started in, when given (the cache may hold another business by now).
  const today = timeZone ? dayInZone(new Date(), timeZone) : todayInBusinessZone(new Date(), businessId);
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

/**
 * EXPENSES-HUB-3 R12: a check that the business an action was started for is still the one this component shows (its
 * latest `businessId` prop). A reply to an action started on A that lands after the switch to B says and reloads
 * nothing. The default for components rendered without the data hook's `isCurrentBusiness`.
 *
 * R13: a fallback only. Its ref follows the prop at commit, so a reply that lands after the switch is announced but
 * before React commits it still reads the old business. A parent that has the data hook should pass its ref-based
 * `isCurrentBusiness` (adopted at the switch itself), as the page does for the recurring panel.
 */
export function useShownBusiness(businessId: string | null | undefined): (forBusiness: string) => boolean {
  const shown = useRef(businessId);
  useLayoutEffect(() => { shown.current = businessId; }, [businessId]);
  return useCallback((forBusiness: string) => Boolean(forBusiness) && shown.current === forBusiness, []);
}

/**
 * EXPENSES-HUB-3 R15: the localStorage key the workspace keeps the chosen business under (lib/workspace.ts
 * BUSINESS_ID_KEY, not exported there). A spec checks it against the key setStoredBusinessId writes.
 */
export const EXPENSES_BUSINESS_ID_KEY = "kf_business_id";

/**
 * EXPENSES-HUB-3 R15: the CSV's file name names the business it is for (taken when the export is asked for), so an
 * export that arrives after a switch cannot pass for the other business's: expenses-<business>-<YYYY-MM-DD>.csv.
 */
export function expenseExportFileName(businessId: string, now: Date = new Date()): string {
  // R17-7: storage that is blocked (getCachedBusiness throws) names the file after the business id.
  let cached: { id?: string; name?: string } | null = null;
  try {
    cached = getCachedBusiness();
  } catch {
    cached = null;
  }
  // R16-5: only this business's cache entry names it; another's never does.
  const name = cached?.id === businessId && typeof cached.name === "string" ? cached.name : "";
  // R16-4: letters and digits of any script (NFKD drops accents: "Café Ñandú" is "cafe-nandu"); a name with none
  // falls back to the business id's slug, so two such businesses never share a file name; at most 60 characters;
  // nothing path-like survives (only letters, digits and single dashes do). Dated on the business's own day.
  const slug = exportSlug(name) || exportSlug(businessId) || "business";
  return `expenses-${slug}-${todayInBusinessZone(now, businessId)}.csv`;
}

const EXPORT_SLUG_MAX = 60;
// R19-4: and at most 200 bytes of UTF-8, so the whole name (expenses-, the slug, -YYYY-MM-DD.csv) stays under 255.
const EXPORT_SLUG_MAX_BYTES = 200;
function exportSlug(text: string): string {
  const kept = text
    // R18-7: emoji variation selectors and the keycap mark carry no letter of their own.
    .replace(/[\uFE00-\uFE0F\u20E3\u{E0100}-\u{E01EF}]/gu, "")
    // R19-4: enclosing marks (a keycap, a circle) belong to no word.
    .replace(/\p{Me}/gu, "")
    .normalize("NFKD")
    // R17-4: combining marks are dropped only after a Latin letter (accents: "Café Ñandú" is cafe-nandu). In other
    // scripts they are part of the word (Devanagari vowel signs, Japanese voicing, Thai tone marks, Arabic harakat).
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    // R18-7 / R19-4: a mark with no letter before it (at the start, after a dash, after a digit) is part of no word.
    .replace(/(?<![\p{L}\p{M}])\p{M}+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return capGraphemes(kept, EXPORT_SLUG_MAX, EXPORT_SLUG_MAX_BYTES).replace(/-+$/g, "");
}

/**
 * R18-7 / R19-4: the first `max` user-perceived characters (graphemes), within `maxBytes` of UTF-8: a cluster is kept
 * whole or not at all, and one too large to fit (a letter with hundreds of marks) is not kept.
 */
function capGraphemes(text: string, max: number, maxBytes: number): string {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  const clusters = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (g) => g.segment) : Array.from(text);
  const encoder = new TextEncoder();
  let out = "";
  let n = 0;
  let size = 0;
  for (const cluster of clusters) {
    if (n >= max) break;
    const bytes = encoder.encode(cluster).length;
    if (size + bytes > maxBytes) break;
    out += cluster;
    size += bytes;
    n += 1;
  }
  return out;
}

/** EXPENSES-HUB-3 R17: what a write that will not start says when another business is chosen. */
export const BUSINESS_CHANGED_ELSEWHERE = "The business changed in another tab. Reload this page, then try again.";
/** EXPENSES-HUB-3 R18-4: what it says when the chosen business cannot be read (storage blocked). */
export const BUSINESS_UNREADABLE = "Couldn't check which business is open. Reload the page.";

/**
 * EXPENSES-HUB-3 R17/R18: the one start check of every write in this folder, and what a refused start says (null when
 * the write may start). A write starts only for the business the workspace has chosen (the stored id, which another
 * tab can change before its storage event reaches this tab), and, when a check is given (the data hook's, or the
 * component's own), only while that check still shows it. Storage that cannot be read refuses (R18-4). A write that
 * asks first (window.confirm) runs the check again once the answer is in: the tab saw no event while the dialog was
 * open (R18-1).
 *
 * Two exceptions, both deliberate: an export that arrives after a switch still downloads (the owner asked for it,
 * and its file names the business it is for: expenseExportFileName); and a save whose first write has landed
 * completes its remaining steps (extra fields, schedule, Drive copy) for the same business, in that business's zone
 * taken when the save started, silently (expense-form-sidesheet.tsx, expense-form-modal.tsx), so a bill is never
 * left without its schedule or a schedule without its receipt.
 */
export function startRefusal(businessId: string | null | undefined, isCurrent?: (businessId: string) => boolean): string | null {
  if (!businessId) return BUSINESS_CHANGED_ELSEWHERE;
  let stored: string | null = null;
  try {
    stored = getStoredBusinessId();
  } catch {
    return BUSINESS_UNREADABLE;
  }
  return stored === businessId && (isCurrent ? isCurrent(businessId) : true) ? null : BUSINESS_CHANGED_ELSEWHERE;
}

/** Whether a write for `businessId` may start (startRefusal says nothing against it). */
export function canStartFor(businessId: string | null | undefined, isCurrent?: (businessId: string) => boolean): boolean {
  return startRefusal(businessId, isCurrent) === null;
}

/** The start check, saying why when it refuses: true when the write must not start. */
export function refusedStart(businessId: string | null | undefined, isCurrent?: (businessId: string) => boolean): boolean {
  const refusal = startRefusal(businessId, isCurrent);
  if (refusal) toast.error(refusal);
  return refusal !== null;
}

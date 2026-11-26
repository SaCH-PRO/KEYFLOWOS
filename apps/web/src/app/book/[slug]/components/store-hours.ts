/**
 * CUSTOMER-PAGE-HONESTY: what the store pages say about opening hours, shared by the store hero (business-hero.tsx)
 * and /book/<slug>'s trust bar (page.tsx). Nothing is said when the business has set no hours, and "now" and "today"
 * are read on the business's own clock (Business.timezone), not the visitor's.
 *
 * Business.businessHours is saved under two spellings of the day: sun..sat (Your page's hours editor and the server's
 * booking availability) and sunday..saturday (the profile editor); both are read.
 */
import type { BusinessHours } from "./types";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** A day as the store pages read it: closed, open between two valid times, or (null) not set. */
type DaySpan = { closed: true } | { closed: false; open: number; close: number; openText: string; closeText: string };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Minutes past midnight of an HH:MM (or HH:MM:SS) time; "24:00" only as a close, the end of the day. */
function minutesOf(value: unknown, asClose = false): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (asClose && /^24:00(?::00)?$/.test(text)) return 24 * 60;
  const m = HHMM.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** HH:MM as shown on the page (seconds dropped). */
const shown = (value: unknown) => String(value).trim().slice(0, 5);

/**
 * A day's hours under either spelling Business.businessHours is saved with: sun..sat (Your page's hours editor and
 * the server's booking availability) or sunday..saturday (the profile editor). A day is set only when `closed` is
 * exactly true, or `closed` is false, undefined or null and its open and close are valid HH:MM (or HH:MM:SS) times;
 * a close of 24:00 is the end of the day, and a close earlier than the open runs past midnight. Any other value (a
 * `closed` of "true", 1 or "false", '9am', a missing or equal time) is not set. Both the hero and the trust
 * bar read days only through this, so they never disagree.
 */
function readDay(hours: BusinessHours, dayKey: string): DaySpan | null {
  const raw = (hours as Record<string, unknown>)[dayKey.slice(0, 3)] ?? (hours as Record<string, unknown>)[dayKey];
  if (!raw || typeof raw !== "object") return null;
  const e = raw as { open?: unknown; close?: unknown; closed?: unknown };
  if (e.closed === true) return { closed: true };
  // Any other closed flag than false, undefined or null ("true", 1, "false") is unknown: the day says nothing.
  if (e.closed !== false && e.closed !== undefined && e.closed !== null) return null;
  const open = minutesOf(e.open);
  const close = minutesOf(e.close, true);
  if (open === null || close === null || open === close) return null;
  return { closed: false, open, close, openText: shown(e.open), closeText: shown(e.close) };
}

function hasHoursSet(hours?: BusinessHours | null): hours is BusinessHours {
  if (!hours || typeof hours !== "object") return false;
  return DAY_KEYS.some((d) => readDay(hours, d) !== null);
}

const previousDay = (dayKey: string) => DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + 6) % 7];
const runsPastMidnight = (d: DaySpan | null): d is Extract<DaySpan, { closed: false }> => !!d && !d.closed && d.close < d.open;

/** The weekday and minutes past midnight now on the business's own clock (the visitor's when its zone is unknown). */
function nowIn(timeZone?: string | null): { dayKey: string; mins: number } {
  const now = new Date();
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const dayKey = get("weekday").toLowerCase();
      const hour = Number(get("hour")) % 24;
      const minute = Number(get("minute"));
      if (DAY_KEYS.includes(dayKey) && Number.isFinite(hour) && Number.isFinite(minute)) return { dayKey, mins: hour * 60 + minute };
    } catch {
      // An unknown zone: fall back to the visitor's clock.
    }
  }
  return { dayKey: DAY_KEYS[now.getDay()], mins: now.getHours() * 60 + now.getMinutes() };
}

/**
 * CUSTOMER-PAGE-HONESTY: whether the business is open, only when it has set its opening hours (null otherwise: the
 * page then says nothing about being open), read on the business's own clock. Yesterday's span that runs past
 * midnight is still open in the small hours.
 */
export function getOpenStatus(hours?: BusinessHours | null, timeZone?: string | null): { isOpen: boolean; label: string } | null {
  if (!hasHoursSet(hours)) return null;
  const { dayKey, mins } = nowIn(timeZone);
  const yesterday = readDay(hours, previousDay(dayKey));
  if (runsPastMidnight(yesterday) && mins < yesterday.close) return { isOpen: true, label: `Open · Closes ${yesterday.closeText}` };
  const today = readDay(hours, dayKey);
  if (!today) return null;
  if (today.closed) return { isOpen: false, label: "Closed Today" };
  if (today.close < today.open) {
    if (mins >= today.open) return { isOpen: true, label: `Open · Closes ${today.closeText}` };
    return { isOpen: false, label: `Opens at ${today.openText}` };
  }
  if (mins >= today.open && mins < today.close) return { isOpen: true, label: `Open · Closes ${today.closeText}` };
  if (mins < today.open) return { isOpen: false, label: `Opens at ${today.openText}` };
  return { isOpen: false, label: "Closed Now" };
}

/**
 * CUSTOMER-PAGE-HONESTY: today's opening hours on the business's own clock, for the store's trust bar ("09:00 – 17:00",
 * or "Closed" on a day it is closed), and null when the business has set no hours or today's are not set (the page
 * then says nothing). While yesterday's span runs past midnight, that span is the one shown.
 */
export function todaysHoursLabel(hours?: BusinessHours | null, timeZone?: string | null): string | null {
  if (!hasHoursSet(hours)) return null;
  const { dayKey, mins } = nowIn(timeZone);
  const yesterday = readDay(hours, previousDay(dayKey));
  if (runsPastMidnight(yesterday) && mins < yesterday.close) return `${yesterday.openText} – ${yesterday.closeText}`;
  const today = readDay(hours, dayKey);
  if (!today) return null;
  if (today.closed) return "Closed";
  return `${today.openText} – ${today.closeText}`;
}

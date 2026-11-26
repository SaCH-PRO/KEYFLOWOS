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

/**
 * A day's hours under either spelling Business.businessHours is saved with: sun..sat (Your page's hours editor and
 * the server's booking availability) or sunday..saturday (the profile editor).
 */
function dayEntry(hours: BusinessHours, dayKey: string) {
  return hours[dayKey.slice(0, 3)] ?? hours[dayKey];
}

function hasHoursSet(hours?: BusinessHours | null): hours is BusinessHours {
  if (!hours || typeof hours !== "object") return false;
  return DAY_KEYS.some((d) => {
    const e = dayEntry(hours, d);
    return !!e && (e.closed || (typeof e.open === "string" && typeof e.close === "string"));
  });
}

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
 * page then says nothing about being open), read on the business's own clock.
 */
export function getOpenStatus(hours?: BusinessHours | null, timeZone?: string | null): { isOpen: boolean; label: string } | null {
  if (!hasHoursSet(hours)) return null;
  const { dayKey, mins: nowMins } = nowIn(timeZone);
  const entry = dayEntry(hours, dayKey);
  if (!entry || entry.closed) return { isOpen: false, label: "Closed Today" };
  if (typeof entry.open !== "string" || typeof entry.close !== "string") return null;
  const [openH, openM] = entry.open.split(":").map(Number);
  const [closeH, closeM] = entry.close.split(":").map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  if (![openMins, closeMins].every(Number.isFinite)) return null;
  if (nowMins >= openMins && nowMins < closeMins) return { isOpen: true, label: `Open · Closes ${entry.close}` };
  if (nowMins < openMins) return { isOpen: false, label: `Opens at ${entry.open}` };
  return { isOpen: false, label: "Closed Now" };
}

/**
 * CUSTOMER-PAGE-HONESTY: today's opening hours on the business's own clock, for the store's trust bar ("09:00 – 17:00",
 * or "Closed" on a day it is closed), and null when the business has set no hours (the page then says nothing).
 */
export function todaysHoursLabel(hours?: BusinessHours | null, timeZone?: string | null): string | null {
  if (!hasHoursSet(hours)) return null;
  const entry = dayEntry(hours, nowIn(timeZone).dayKey);
  if (!entry || entry.closed) return "Closed";
  if (typeof entry.open !== "string" || typeof entry.close !== "string") return null;
  return `${entry.open} – ${entry.close}`;
}

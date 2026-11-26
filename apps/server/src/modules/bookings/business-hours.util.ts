/**
 * Shared reader for Business.businessHours (V1-91 / P227 FU-SLOTS-HOURS-READER).
 *
 * Business.businessHours is persisted under two day-key spellings:
 *   - Short keys: sun, mon, tue, wed, thu, fri, sat (Your page hours editor)
 *   - Long keys:  sunday, monday, tuesday, wednesday, thursday, friday, saturday (Profile editor)
 *
 * Short keys take precedence over long keys when both exist (matching
 * apps/web/src/app/book/[slug]/components/store-hours.ts).
 */

export const SHORT_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const LONG_DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** Default business hours window (09:00–17:00) used by getAvailableSlots when a day is unconfigured. */
export const DEFAULT_BUSINESS_OPEN_MIN = 9 * 60;
export const DEFAULT_BUSINESS_CLOSE_MIN = 17 * 60;

export type ParsedBusinessDayHours =
  | { closed: true }
  | { closed: false; openMin: number; closeMin: number; open: string; close: string };

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MIDNIGHT_END_RE = /^24:00(?::00)?$/;

/**
 * Parse a strict `HH:MM` or `HH:MM:SS` time string (`00:00`–`23:59`, plus
 * `24:00` when `allowMidnightEnd` is true) into minutes past midnight, or null
 * if malformed.
 */
export function parseTimeToMinutes(value: unknown, allowMidnightEnd = false): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (allowMidnightEnd && MIDNIGHT_END_RE.test(text)) {
    return 24 * 60;
  }
  const match = HHMM_RE.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function lookupRawDayEntry(hours: Record<string, unknown>, weekday: number): unknown {
  const shortKey = SHORT_DAY_KEYS[weekday];
  const longKey = LONG_DAY_KEYS[weekday];

  if (Object.prototype.hasOwnProperty.call(hours, shortKey) && hours[shortKey] != null) {
    return hours[shortKey];
  }
  if (Object.prototype.hasOwnProperty.call(hours, longKey) && hours[longKey] != null) {
    return hours[longKey];
  }

  // Case-insensitive own-property fallback (Object.keys never walks the prototype chain).
  const keys = Object.keys(hours);
  for (const key of keys) {
    if (key.toLowerCase() === shortKey && hours[key] != null) {
      return hours[key];
    }
  }
  for (const key of keys) {
    if (key.toLowerCase() === longKey && hours[key] != null) {
      return hours[key];
    }
  }
  return undefined;
}

/**
 * Read a single weekday's configured hours from `Business.businessHours`.
 *
 * Returns:
 *   - `{ closed: true }` when the day explicitly has `closed === true`
 *   - `{ closed: false, openMin, closeMin, open, close }` when open with valid
 *     `open < close` times (`00:00`–`23:59`, `close` may be `24:00`)
 *   - `null` when `businessHours` is null/malformed, the day key is absent,
 *     `closed` is a non-boolean sentinel, or open/close are missing/invalid/inverted
 */
export function readBusinessDayHours(
  businessHours: unknown,
  weekday: number,
): ParsedBusinessDayHours | null {
  if (!businessHours || typeof businessHours !== 'object' || Array.isArray(businessHours)) {
    return null;
  }
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return null;
  }

  const raw = lookupRawDayEntry(businessHours as Record<string, unknown>, weekday);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const entry = raw as { open?: unknown; close?: unknown; closed?: unknown };
  if (entry.closed === true) {
    return { closed: true };
  }
  if (entry.closed !== false && entry.closed !== undefined && entry.closed !== null) {
    return null;
  }

  const openMin = parseTimeToMinutes(entry.open, false);
  const closeMin = parseTimeToMinutes(entry.close, true);
  if (openMin === null || closeMin === null || openMin >= closeMin) {
    return null;
  }

  return {
    closed: false,
    openMin,
    closeMin,
    open: formatMinutes(openMin),
    close: formatMinutes(closeMin),
  };
}

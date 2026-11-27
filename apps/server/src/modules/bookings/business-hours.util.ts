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

import { isISO8601 } from 'class-validator';

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

/** Public booking slot grid interval in minutes, shared by getAvailableSlots and publicCreateBooking (P226). */
export const PUBLIC_SLOT_INTERVAL_MINS = 30;

/** Minutes in a standard 24-hour calendar day. */
const MINUTES_PER_DAY = 24 * 60;

export type ParsedBusinessDayHours =
  | { closed: true }
  | { closed: false; openMin: number; closeMin: number; open: string; close: string };

export interface BusinessDateWindow {
  openMin: number;
  closeMin: number;
  /** Grid anchor in this date's minute coordinates (negative for previous-day overnight spillover). */
  gridAnchorMin: number;
  open: string;
  close: string;
  /** True when this window is the post-midnight spillover from the previous weekday's overnight shift. */
  spillover: boolean;
}

export type ResolvedBusinessDateSchedule =
  | { status: 'unconfigured'; windows: BusinessDateWindow[] }
  | { status: 'closed'; windows: [] }
  | { status: 'open'; windows: BusinessDateWindow[] };

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

function ownProp(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function parseDayEntry(raw: unknown): ParsedBusinessDayHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const entry = raw as Record<string, unknown>;
  const closed = ownProp(entry, 'closed');
  if (closed === true) {
    return { closed: true };
  }
  if (closed !== false && closed !== undefined && closed !== null) {
    return null;
  }

  const openMin = parseTimeToMinutes(ownProp(entry, 'open'), false);
  const closeMinRaw = parseTimeToMinutes(ownProp(entry, 'close'), true);
  if (openMin === null || closeMinRaw === null || openMin === closeMinRaw) {
    return null;
  }

  // D-311 (P229 FU-SLOTS-OVERNIGHT-HOURS): when close is earlier than open
  // (e.g. 18:00–02:00 or 18:00–00:00), the shift crosses midnight and ends at
  // closeMinRaw + 1440 in the opening day's minute coordinates.
  const closeMin = closeMinRaw < openMin ? closeMinRaw + MINUTES_PER_DAY : closeMinRaw;

  return {
    closed: false,
    openMin,
    closeMin,
    open: formatMinutes(openMin),
    close: formatMinutes(closeMinRaw),
  };
}

/**
 * Yield raw candidate entries for `weekday` in strict precedence order:
 *   1. Exact lowercase short key (`mon`)
 *   2. Case-insensitive own keys matching short key (`MON`, `Mon`, ...)
 *   3. Exact lowercase long key (`monday`)
 *   4. Case-insensitive own keys matching long key (`Monday`, `MONDAY`, ...)
 *
 * Uses `Object.prototype.hasOwnProperty.call` and `Object.keys` only (never
 * walks the prototype chain).
 */
function candidateDayEntries(hours: Record<string, unknown>, weekday: number): unknown[] {
  const shortKey = SHORT_DAY_KEYS[weekday];
  const longKey = LONG_DAY_KEYS[weekday];
  const candidates: unknown[] = [];

  if (Object.prototype.hasOwnProperty.call(hours, shortKey) && hours[shortKey] != null) {
    candidates.push(hours[shortKey]);
  }

  const keys = Object.keys(hours);
  for (const key of keys) {
    if (key !== shortKey && key.toLowerCase() === shortKey && hours[key] != null) {
      candidates.push(hours[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(hours, longKey) && hours[longKey] != null) {
    candidates.push(hours[longKey]);
  }

  for (const key of keys) {
    if (key !== longKey && key.toLowerCase() === longKey && hours[key] != null) {
      candidates.push(hours[key]);
    }
  }

  return candidates;
}

/**
 * Read a single weekday's configured hours from `Business.businessHours`.
 *
 * Evaluates candidate keys in strict short-over-long precedence order and
 * returns the first candidate that parses to a valid configuration (so an
 * incomplete/malformed short key cannot shadow a valid long key like
 * `{ closed: true }`):
 *   - `{ closed: true }` when the day explicitly has `closed === true`
 *   - `{ closed: false, openMin, closeMin, open, close }` when open with valid
 *     distinct `open` and `close` times (`00:00`–`23:59`, `close` may be `24:00`;
 *     overnight spans `open > close` return `closeMin = close + 1440`)
 *   - `null` when `businessHours` is null/malformed, the day key is absent, or
 *     no candidate entry parses cleanly
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

  const candidates = candidateDayEntries(businessHours as Record<string, unknown>, weekday);
  for (const raw of candidates) {
    const parsed = parseDayEntry(raw);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

/**
 * D-311 (P229 FU-SLOTS-OVERNIGHT-HOURS): resolve all active business-hour
 * windows on `weekday`, including any post-midnight spillover from the previous
 * weekday's overnight shift (`prevDay.closeMin > 1440`).
 *
 * - `status: 'open'` when `today` is open OR `today` is closed while the
 *   previous day's overnight shift spills past midnight into `weekday`.
 * - `status: 'closed'` when `today` is explicitly closed and no overnight
 *   spillover enters `weekday`.
 * - `status: 'unconfigured'` when `today` has no valid entry (still carrying
 *   any previous-day overnight spillover in `windows`).
 */
export function readBusinessDateWindows(
  businessHours: unknown,
  weekday: number,
): ResolvedBusinessDateSchedule {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { status: 'unconfigured', windows: [] };
  }

  const prevWeekday = (weekday + 6) % 7;
  const prevDay = readBusinessDayHours(businessHours, prevWeekday);
  const today = readBusinessDayHours(businessHours, weekday);

  const windows: BusinessDateWindow[] = [];
  if (prevDay && !prevDay.closed && prevDay.closeMin > MINUTES_PER_DAY) {
    windows.push({
      openMin: 0,
      closeMin: prevDay.closeMin - MINUTES_PER_DAY,
      gridAnchorMin: prevDay.openMin - MINUTES_PER_DAY,
      open: prevDay.open,
      close: prevDay.close,
      spillover: true,
    });
  }

  if (today === null) {
    return { status: 'unconfigured', windows };
  }
  if (today.closed) {
    return windows.length > 0 ? { status: 'open', windows } : { status: 'closed', windows: [] };
  }

  windows.push({
    openMin: today.openMin,
    closeMin: today.closeMin,
    gridAnchorMin: today.openMin,
    open: today.open,
    close: today.close,
    spillover: false,
  });

  return { status: 'open', windows };
}

/**
 * V1-91 / P226 (FU-PUBLIC-BOOKING-GRID, SEC-SLOTS-M1) & P229 (D-311): whether
 * a booking start instant lands on the exact slot grid that `getAvailableSlots`
 * emits for a window anchored at `gridAnchorMin` (minutes past midnight in the
 * business timezone; may be negative for a previous-day overnight spillover):
 *   - zero seconds and zero milliseconds (`zonedInstant` emits whole minutes)
 *   - `(startMinsOfDay - gridAnchorMin) % intervalMins === 0`
 */
export function isOnSlotGrid(
  start: Date,
  startMinsOfDay: number,
  gridAnchorMin: number,
  intervalMins = PUBLIC_SLOT_INTERVAL_MINS,
): boolean {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return false;
  }
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) {
    return false;
  }
  if (
    !Number.isInteger(startMinsOfDay) ||
    !Number.isFinite(gridAnchorMin) ||
    !Number.isFinite(intervalMins) ||
    intervalMins <= 0
  ) {
    return false;
  }
  const remainder = (((startMinsOfDay - gridAnchorMin) % intervalMins) + intervalMins) % intervalMins;
  return remainder === 0;
}

/**
 * V1-91 / P226 [R1-SEC-01]: strict RFC 3339 / ISO 8601 date-time with explicit
 * timezone offset (`Z` or `±HH:MM`, `T` separator, hours `00`–`23`, no trailing
 * whitespace, no date-only / ordinal / timezone-less / `24:00` rollover forms).
 */
export const STRICT_ISO_DATETIME_WITH_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

/**
 * True iff `raw` is a strict RFC 3339 / ISO 8601 date-time string with an
 * explicit timezone designator, a valid calendar date (no Feb 30 rollover),
 * and parses to a non-NaN Date.
 */
export function isStrictIsoDateTimeWithTz(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (!STRICT_ISO_DATETIME_WITH_TZ_RE.test(raw)) return false;
  if (!isISO8601(raw, { strict: true, strictSeparator: true })) return false;
  return !Number.isNaN(new Date(raw).getTime());
}



/**
 * Timezone-safe fixture timestamp helper for `today-aggregate.integration.test.ts`
 * (P203 / FU-TODAY-AGGREGATE-TZ-SEED).
 *
 * Seeding "today" bookings with forward offsets like `now + 2h` crosses local
 * midnight in `America/Port_of_Spain` (UTC-4) between 02:00 and 04:00 UTC,
 * causing TodayService's local-day `[dayStart, dayEnd]` filter to exclude the
 * fixture. Anchoring fixture times to explicit local-clock hours on `now`'s
 * calendar date in the business timezone keeps them strictly inside
 * `[dayStart, dayEnd]` at every minute of the 24-hour UTC clock and across
 * DST / month / year boundaries.
 *
 * Plain JS on purpose (like `sql-like.js` and `semantic-sight.js`):
 * `apps/server/tsconfig.json` pins `rootDir` to `./src` and relies on every
 * TypeScript file under `test/` being excluded as `*.test.ts` / `*.spec.ts`.
 */

const DEFAULT_TIMEZONE = 'America/Port_of_Spain';

/**
 * Resolves a business timezone string using the exact fallback rules of
 * `TodayService.resolveValidTimeZone`: blank/missing -> `America/Port_of_Spain`,
 * unrecognized IANA zone -> `UTC`.
 *
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function resolveSeedTimeZone(raw) {
  const candidate = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const num = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second'),
  };
}

/**
 * Computes the UTC instant corresponding to `(year, month, day, hour, minute)`
 * in `timeZone` using two offset-refinement passes so fixed-offset zones,
 * positive offsets, month/year rollovers, and DST transitions stay exact.
 *
 * @param {number} year
 * @param {number} month 1-indexed month
 * @param {number} day 1-indexed day (0 rolls back to previous month's last day)
 * @param {number} hour 0..23
 * @param {number} minute 0..59
 * @param {string} timeZone valid IANA timezone
 * @returns {Date}
 */
function zonedDateTimeUtc(year, month, day, hour, minute, timeZone) {
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetLocalMs;
  for (let i = 0; i < 2; i++) {
    const gp = zonedDateParts(new Date(guess), timeZone);
    const guessLocalMs = Date.UTC(gp.year, gp.month - 1, gp.day, gp.hour, gp.minute, gp.second, 0);
    const diff = targetLocalMs - guessLocalMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/**
 * Returns the UTC `Date` for `hour:minute:00.000` on `now`'s local calendar date
 * in `timeZone`.
 *
 * @param {string | null | undefined} timeZone
 * @param {number} hour integer 0..23
 * @param {number} [minute=0] integer 0..59
 * @param {Date} [now=new Date()]
 * @returns {Date}
 */
export function localTimeTodayUtc(timeZone, hour, minute = 0, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('localTimeTodayUtc: expected a valid Date for now');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`localTimeTodayUtc: hour must be an integer 0..23, received ${String(hour)}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`localTimeTodayUtc: minute must be an integer 0..59, received ${String(minute)}`);
  }
  const tz = resolveSeedTimeZone(timeZone);
  const p = zonedDateParts(now, tz);
  return zonedDateTimeUtc(p.year, p.month, p.day, hour, minute, tz);
}

/**
 * Builds deterministic fixture timestamps for `today-aggregate.integration.test.ts`
 * anchored to `now`'s business-local calendar day in `timeZone`:
 * - `bookingStart` / `bookingEnd`: 12:00–13:00 local
 * - `privateBookingStart` / `privateBookingEnd`: 14:00–15:00 local
 * - `dueToday`: 12:00 local (strictly inside `[dayStart, dayEnd]`)
 * - `yesterday`: 12:00 local on the previous local calendar day (`< dayStart` and `< now`)
 *
 * @param {Date} [now=new Date()]
 * @param {string | null | undefined} [timeZone=DEFAULT_TIMEZONE]
 * @returns {{
 *   timeZone: string;
 *   bookingStart: Date;
 *   bookingEnd: Date;
 *   privateBookingStart: Date;
 *   privateBookingEnd: Date;
 *   dueToday: Date;
 *   yesterday: Date;
 * }}
 */
export function todaySeedFixtures(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('todaySeedFixtures: expected a valid Date for now');
  }
  const tz = resolveSeedTimeZone(timeZone);
  const p = zonedDateParts(now, tz);
  const bookingStart = zonedDateTimeUtc(p.year, p.month, p.day, 12, 0, tz);
  const bookingEnd = new Date(bookingStart.getTime() + 60 * 60_000);
  const privateBookingStart = zonedDateTimeUtc(p.year, p.month, p.day, 14, 0, tz);
  const privateBookingEnd = new Date(privateBookingStart.getTime() + 60 * 60_000);
  const dueToday = new Date(bookingStart.getTime());
  const yesterday = zonedDateTimeUtc(p.year, p.month, p.day - 1, 12, 0, tz);

  return {
    timeZone: tz,
    bookingStart,
    bookingEnd,
    privateBookingStart,
    privateBookingEnd,
    dueToday,
    yesterday,
  };
}

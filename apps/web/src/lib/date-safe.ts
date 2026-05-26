/**
 * Safe date parsing that never returns Invalid Date.
 * Use instead of `new Date(input)` to prevent NaN propagation.
 */
export function parseDate(input: string | Date | number | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Days between two dates. Returns null if either date is invalid.
 */
export function daysBetween(start: Date | string | null | undefined, end: Date | string | null | undefined): number | null {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((e.getTime() - s.getTime()) / msPerDay);
}

/**
 * Is a date in the past? Returns null if invalid.
 */
export function isPast(date: Date | string | null | undefined): boolean | null {
  const d = parseDate(date);
  if (!d) return null;
  return d.getTime() < Date.now();
}

/**
 * Format a date safely for display. Falls back to empty string.
 */
export function formatDateSafe(
  input: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-US", opts);
}

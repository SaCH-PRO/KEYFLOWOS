/**
 * A transaction lost to a deadlock or a serialization failure, which running
 * it again can get past: Prisma's P2034 ("write conflict or deadlock"), or
 * SQLSTATE 40P01 (deadlock_detected) / 40001 (serialization_failure). With the
 * driver adapter (@prisma/adapter-pg) a deadlock on a model query arrives as a
 * PrismaClientUnknownRequestError with no code, its message naming the
 * PostgresError's code ("40P01", "deadlock detected"), and a raw query's as
 * P2010 "Raw query failed. Code: `40P01`", so the code, the meta and the
 * message are all read.
 */
export function isLostTransactionConflict(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown } | null;
  if (!e) return false;
  const codes = new Set(['P2034', '40P01', '40001']);
  if (typeof e.code === 'string' && codes.has(e.code)) return true;
  if (typeof e.meta?.code === 'string' && codes.has(e.meta.code)) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return /\bcode: \\?"(40P01|40001)\\?"|Code: `(40P01|40001)`|deadlock detected|could not serialize access/.test(message);
}

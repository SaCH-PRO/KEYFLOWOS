/**
 * Centralized Business secret redaction.
 *
 * Architectural rule (Phase 2): no service may return a raw Prisma Business
 * record containing secret columns across a transport boundary. The Business
 * table stores per-provider OAuth tokens in plaintext; these must never be
 * serialized into API/WebSocket/event/job payloads. Server-side token readers
 * (e.g. the Google Suite connector) load these columns directly from Prisma and
 * must NOT depend on sanitized service results.
 */

/** OAuth token columns stored on Business that must never leave the boundary. */
export const BUSINESS_SECRET_FIELDS = [
  'gmailAccessToken',
  'gmailRefreshToken',
  'calendarAccessToken',
  'calendarRefreshToken',
  'driveAccessToken',
  'driveRefreshToken',
  'formsAccessToken',
  'formsRefreshToken',
  'contactsAccessToken',
  'contactsRefreshToken',
  'msContactsAccessToken',
  'msContactsRefreshToken',
  'bpAccessToken',
  'bpRefreshToken',
] as const;

export type BusinessSecretField = (typeof BUSINESS_SECRET_FIELDS)[number];

/**
 * Return a shallow copy of a Business record with all secret token columns
 * removed. Preserves every other field (non-breaking for legitimate consumers).
 * Passes through null/undefined so it can wrap optional lookups directly.
 */
export function sanitizeBusiness<T extends Record<string, unknown>>(
  business: T,
): Omit<T, BusinessSecretField>;
export function sanitizeBusiness<T extends Record<string, unknown>>(
  business: T | null | undefined,
): Omit<T, BusinessSecretField> | null | undefined;
export function sanitizeBusiness<T extends Record<string, unknown>>(
  business: T | null | undefined,
): Omit<T, BusinessSecretField> | null | undefined {
  if (business == null) return business as null | undefined;
  const clone: Record<string, unknown> = { ...business };
  for (const field of BUSINESS_SECRET_FIELDS) {
    delete clone[field];
  }
  return clone as Omit<T, BusinessSecretField>;
}

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
 * R0-SEC2b-WHATSAPP-SECRET-READS (review SEC2-R2): what a Business read answers
 * for metaData.whatsapp. The stored value carries the WhatsApp credentials
 * (accessToken, authToken, accountSid, as token-crypto ciphertext that one
 * platform key decrypts for every business) and the phoneNumberId the shared
 * webhook routes inbound messages by. None of it leaves through a Business
 * read, for any reader, the owner included: whether a config is stored is all
 * these reads say. The owner reads phoneNumberId and each credential's last 4
 * characters from GET /whatsapp/businesses/:businessId/config, the one view
 * that knows its reader.
 */
export interface MaskedWhatsAppMeta {
  configured: boolean;
}

/** metaData with its whatsapp entry masked; any other value is returned as it is. */
function maskMetaData(metaData: unknown): unknown {
  if (metaData === null || typeof metaData !== 'object' || Array.isArray(metaData)) return metaData;
  if (!Object.prototype.hasOwnProperty.call(metaData, 'whatsapp')) return metaData;
  const meta = metaData as Record<string, unknown>;
  const whatsapp: MaskedWhatsAppMeta = { configured: Boolean(meta.whatsapp) };
  return { ...meta, whatsapp };
}

/**
 * Return a shallow copy of a Business record with all secret token columns
 * removed and metaData.whatsapp masked (MaskedWhatsAppMeta; R0-SEC2b). The
 * input is not modified, so a caller that writes the row back writes what it
 * read from the database. Preserves every other field (non-breaking for
 * legitimate consumers). Passes through null/undefined so it can wrap optional
 * lookups directly.
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
  if ('metaData' in clone) clone.metaData = maskMetaData(clone.metaData);
  return clone as Omit<T, BusinessSecretField>;
}

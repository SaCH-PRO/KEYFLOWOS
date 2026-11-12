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

import { isWipayPublicSandboxKey } from '../connectors/implementations/wipay-merchant';

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

/**
 * R0-SEC2c-PAYMENT-SECRETS-WRITE-ONLY (R0-SEC2b review SEC2b-R3): the payment
 * provider secrets the web payments tab stores in Business.metaData. They are
 * write-only: the payment services read them server side, straight from
 * Prisma, and a Business read answers each one only as MaskedSecretMeta, to
 * every reader, the owner included. A stored value that is blank or null is no
 * secret: the read leaves the key out (not configured), so a client that tests
 * the key for truthiness keeps its meaning. IdentityService.updateBusiness
 * writes them (a new non-blank string replaces, null removes, anything else
 * keeps the stored value).
 */
export const BUSINESS_META_PAYMENT_SECRET_KEYS = [
  'stripeSecretKey',
  'stripeWebhookSecret',
  'paypalClientSecret',
  'wipayApiKey',
] as const;

export type BusinessMetaPaymentSecretKey = (typeof BUSINESS_META_PAYMENT_SECRET_KEYS)[number];

/** What a Business read answers for a stored payment secret or SEO connection entry. */
export interface MaskedSecretMeta {
  configured: boolean;
}

/**
 * W3-D12b-SEO-SECRET-MASK (FOLLOW3-D12 review D12-ST-2): the SEO connection
 * entries Business.metaData carries, metaData.ga4 (SeoGoogleAnalyticsService)
 * and metaData.gsc (SeoGoogleSearchConsoleService). Each holds the Google
 * OAuth tokens (accessToken, refreshToken) beside the property id or site URL
 * and the connect and sync stamps, so each is secret-bearing as a whole: a
 * Business read answers the entry only as MaskedSecretMeta ({configured:true}),
 * to every reader, the owner included, and leaves out a null or blank one (not
 * connected), as for the payment secrets. The SEO services read their entries
 * server side, straight from Prisma, never through this projection; the
 * connection state (connected, the property id or site URL, lastSync, no
 * token) is GET /seo/businesses/:businessId/connectors/ga4 and .../gsc, which
 * the web SEO page reads.
 */
export const BUSINESS_META_SEO_CONNECTION_KEYS = ['ga4', 'gsc'] as const;

export type BusinessMetaSeoConnectionKey = (typeof BUSINESS_META_SEO_CONNECTION_KEYS)[number];

/** The metaData keys a Business read answers only as MaskedSecretMeta (or leaves out when nothing is stored). */
const MASKED_SECRET_META_KEYS: readonly string[] = [
  ...BUSINESS_META_PAYMENT_SECRET_KEYS,
  ...BUSINESS_META_SEO_CONNECTION_KEYS,
];

/** Whether a stored metaData value holds a secret (anything but null, undefined or a blank string). */
export function isStoredSecret(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || value.trim() !== '';
}

/**
 * W11-WIPAY-SANDBOX-KEY-WRITE (owner ruling D-105, review SEC-W10WK-1 part 2):
 * whether a stored metaData.wipayApiKey is WiPay's public sandbox key, read as
 * the WiPay merchant reads it (a string compared trimmed, or a finite number
 * stringified). That key is no key wherever it is stored (resolveWipayMerchant
 * reads it as unset: WiPay is not offered), so a Business read leaves it out
 * (not configured), as it does a blank one, and the payments tab does not show
 * WiPay connected. Every other stored WiPay key still reads {configured:true}.
 */
function isStoredWipaySandboxKey(value: unknown): boolean {
  if (typeof value === 'string') return isWipayPublicSandboxKey(value);
  if (typeof value === 'number' && Number.isFinite(value)) return isWipayPublicSandboxKey(String(value));
  return false;
}

/** metaData with its whatsapp entry, payment secrets and SEO connections masked; any other value is returned as it is. */
function maskMetaData(metaData: unknown): unknown {
  if (metaData === null || typeof metaData !== 'object' || Array.isArray(metaData)) return metaData;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(metaData, key);
  if (!has('whatsapp') && !MASKED_SECRET_META_KEYS.some(has)) return metaData;
  const meta: Record<string, unknown> = { ...(metaData as Record<string, unknown>) };
  if (has('whatsapp')) {
    const whatsapp: MaskedWhatsAppMeta = { configured: Boolean(meta.whatsapp) };
    meta.whatsapp = whatsapp;
  }
  for (const key of MASKED_SECRET_META_KEYS) {
    if (!has(key)) continue;
    if (key === 'wipayApiKey' && isStoredWipaySandboxKey(meta[key])) {
      delete meta[key];
    } else if (isStoredSecret(meta[key])) {
      const masked: MaskedSecretMeta = { configured: true };
      meta[key] = masked;
    } else {
      delete meta[key];
    }
  }
  return meta;
}

/**
 * Return a shallow copy of a Business record with all secret token columns
 * removed, metaData.whatsapp masked (MaskedWhatsAppMeta; R0-SEC2b), each
 * metaData payment secret masked (MaskedSecretMeta; R0-SEC2c) and each SEO
 * connection entry masked (MaskedSecretMeta; W3-D12b, D12-ST-2). The input is
 * not modified, so a caller that writes the row back writes what it read from
 * the database. Preserves every other field (non-breaking for legitimate
 * consumers). Passes through null/undefined so it can wrap optional lookups
 * directly.
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

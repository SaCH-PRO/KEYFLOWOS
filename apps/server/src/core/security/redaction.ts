/**
 * Centralized deep redaction for secret/tenant-sensitive fields.
 *
 * Used anywhere a structured value is persisted or emitted across a boundary
 * (audit/event snapshots, log payloads). A single policy is safer than an
 * ever-growing per-call-site denylist: extend it here and every consumer
 * benefits. Matching is case-insensitive substring on the field NAME, so a
 * nested `gmailAccessToken` matches the `accesstoken` pattern.
 *
 * NOTE: patterns must be specific enough not to over-match ordinary fields —
 * hence `apikey`/`accesskey`/`privatekey` rather than a bare `key`.
 */
export const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token', // accessToken, refreshToken, *TokenEncrypted, etc.
  'credential', // credentials, encryptedCredentials
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'authorization',
  'cookie',
  'sessionid',
  'session_token',
  'hashedkey',
  'vapidprivate',
  'encryptionkey',
] as const;

const REDACTED = '***REDACTED***';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Recursively redact sensitive fields in-place across objects and arrays.
 * Returns the same reference for convenience. Non-sensitive values are left
 * untouched. Arrays are traversed element-by-element; sensitive keys at any
 * depth are replaced with a marker regardless of casing.
 */
export function deepRedact<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepRedact(item);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (isSensitiveKey(key)) {
        obj[key] = REDACTED;
      } else {
        deepRedact(obj[key]);
      }
    }
  }
  return value;
}

/**
 * Structured-clone a value (dropping functions/cycles) and deep-redact it.
 * Returns undefined for non-object inputs so callers can skip empty snapshots.
 */
export function safeRedactedSnapshot(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  try {
    return deepRedact(JSON.parse(JSON.stringify(input)));
  } catch {
    return undefined;
  }
}

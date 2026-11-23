/**
 * Centralized deep redaction for secret/tenant-sensitive fields.
 *
 * Used anywhere a structured value is persisted or emitted across a boundary
 * (audit/event snapshots, log payloads). A single policy is safer than an
 * ever-growing per-call-site denylist: extend it here and every consumer
 * benefits. Two policies apply, in this order:
 *
 *   1. By field NAME (SENSITIVE_FIELD_PATTERNS): case-insensitive substring,
 *      so a nested `gmailAccessToken` matches the `accesstoken` pattern; the
 *      whole value becomes ***REDACTED***.
 *   2. By VALUE (SENSITIVE_VALUE_PATTERNS, RR-REDACTION-BY-CONTENT): every
 *      string leaf under a non-sensitive key is passed through
 *      redactSensitiveText, which replaces card numbers (<card>) and
 *      secret-shaped tokens (<secret>) inside free text. A note that says
 *      "card 4111 1111 1111 1111" or "use key sk-..." no longer reaches an
 *      audit snapshot or a log payload intact. Numbers are not text: a numeric
 *      leaf is left alone.
 *
 * NOTE: patterns must be specific enough not to over-match ordinary fields —
 * hence `apikey`/`accesskey`/`privatekey` rather than a bare `key`; and the
 * value patterns are shaped (a Luhn check, a key prefix plus 20 key
 * characters, a PEM header), so an invoice number, a phone number, a UUID or a
 * 16-digit number that fails Luhn is untouched.
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

const CARD_MARKER = '<card>';
const SECRET_MARKER = '<secret>';

export interface SensitiveValuePattern {
  /** A stable name, for tests and for reading a diff of the policy. */
  readonly name: string;
  readonly marker: typeof CARD_MARKER | typeof SECRET_MARKER;
  /** A global pattern. String.replace resets lastIndex, so calls share no state. */
  readonly pattern: RegExp;
  /** An extra check on each match; the match is replaced only when it returns true. */
  readonly accept?: (match: string) => boolean;
}

/** Luhn check over the digits of a candidate card number (separators already stripped). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Characters a provider key is made of after its prefix. */
const KEY_CHARS = String.raw`[A-Za-z0-9_-]`;

/**
 * The value policy, applied to every string leaf deepRedact reaches and to
 * any free text a caller passes to redactSensitiveText. Order matters only
 * where patterns could overlap: the PEM block goes first so its body (base64
 * that may contain digit runs) is replaced whole.
 */
export const SENSITIVE_VALUE_PATTERNS: readonly SensitiveValuePattern[] = [
  {
    name: 'pem-private-key-block',
    marker: SECRET_MARKER,
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    name: 'jwt',
    marker: SECRET_MARKER,
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  },
  {
    // The token after the scheme word, however short: "Bearer abc.def.ghi" in an echoed header is still a credential.
    name: 'bearer-token',
    marker: SECRET_MARKER,
    pattern: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  {
    name: 'aws-access-key-id',
    marker: SECRET_MARKER,
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
  },
  {
    // sk- (OpenAI, sk-proj-...), sk-ant- (Anthropic), xoxb- (Slack), ghp_ and github_pat_ (GitHub), then 20+ key characters.
    name: 'provider-key-prefix',
    marker: SECRET_MARKER,
    pattern: new RegExp(String.raw`\b(?:sk-ant-|sk-|xoxb-|ghp_|github_pat_)${KEY_CHARS}{20,}`, 'g'),
  },
  {
    // 13 to 19 digits, single spaces or dashes allowed between them, not inside a longer digit run; Luhn must hold.
    name: 'card-number-luhn',
    marker: CARD_MARKER,
    pattern: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    accept: (match) => {
      const digits = match.replace(/[ -]/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
  },
];

/**
 * Replace every card number and secret-shaped token in free text with its
 * marker, keeping the rest of the text (what an operator or an audit reader
 * needs). The Bearer pattern keeps the scheme word and replaces the token.
 * Idempotent: a marker matches no pattern.
 */
export function redactSensitiveText(text: string): string {
  let out = text;
  for (const { pattern, marker, accept } of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, (match: string, ...rest: unknown[]) => {
      if (accept && !accept(match)) return match;
      // A leading capture group (the Bearer scheme word) is kept in front of the marker.
      const lead = typeof rest[0] === 'string' ? (rest[0] as string) : '';
      return `${lead}${marker}`;
    });
  }
  return out;
}

/**
 * Recursively redact sensitive fields in-place across objects and arrays.
 * Returns the same reference for convenience. A sensitive key at any depth is
 * replaced with a marker regardless of casing; every other string leaf is
 * passed through redactSensitiveText (a string given directly is one leaf,
 * and its redacted copy is returned). Numbers, booleans and null are left
 * untouched. Arrays are traversed element-by-element.
 */
export function deepRedact<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = deepRedact(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (isSensitiveKey(key)) {
        obj[key] = REDACTED;
      } else {
        obj[key] = deepRedact(obj[key]);
      }
    }
  }
  return value;
}

/**
 * Anything shaped like an email address: a run of characters with no
 * whitespace, angle bracket, quote, backtick, parenthesis, comma, semicolon,
 * colon or square bracket on each side of an `@`.
 */
const ADDRESS_PATTERN = /[^\s<>"'`(),;:[\]]+@[^\s<>"'`(),;:[\]]+/g;

/**
 * Replace every address-shaped token in free text with `<address>`, for a log
 * line (9B-D2: a sender's log line carries no recipient address). The rest of
 * the text stays, since it is what an operator needs. W4-HOUSEKEEPING: the one
 * copy both email senders use (SystemEmailService kept it private and
 * TransactionalEmailService repeated it since W3-C2b-EMAIL-LOG-LEAK).
 * String.replace resets a global pattern's lastIndex, so calls share no state.
 */
export function redactAddresses(text: string): string {
  return text.replace(ADDRESS_PATTERN, '<address>');
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

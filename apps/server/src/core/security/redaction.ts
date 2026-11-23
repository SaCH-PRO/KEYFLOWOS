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
  /**
   * A global pattern. Use it only through redactSensitiveText: String.replace
   * resets lastIndex, so calls share no state, but `.test`/`.exec` on a global
   * RegExp do not, and would answer the second call differently.
   */
  readonly pattern: RegExp;
  /**
   * Rewrites one match. Absent: the match becomes the marker, after the named
   * group `lead` when the pattern has one (the Bearer scheme word is kept).
   */
  readonly rewrite?: (match: string) => string;
}

/** Luhn check over a string of digits. */
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

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;

/**
 * A card number is a window of 13 to 19 digits, made of whole groups of a
 * digit run (groups are split by one to three spaces or dashes), that passes
 * Luhn; a 13-digit window must start with 4 (legacy Visa is the only 13-digit
 * scheme, and that rule keeps every 13-digit epoch-millisecond id intact). The
 * run is scanned left to right, longest window first, so a card followed or
 * preceded by a CVV, an expiry month or a quantity is still found inside the
 * run, and the neighbours stay. An unbroken group longer than 19 digits is not
 * a card (longer than any scheme) and is left whole.
 *
 * Residual, by design: about one in ten 14 to 19 digit numeric identifiers
 * passes Luhn (an IMEI always does), so such an id in a note becomes <card>.
 */
function redactCardWindows(run: string): string {
  const groups = run.split(/([ -]{1,3})/); // digit group, separator, digit group, ...
  const out: string[] = [];
  let i = 0;
  while (i < groups.length) {
    // Windows from group i, each the digits so far: windows[k] covers groups i .. i + 2k.
    const windows: string[] = [];
    let digits = '';
    for (let j = i; j < groups.length && digits.length + groups[j].length <= CARD_MAX_DIGITS; j += 2) {
      digits += groups[j];
      windows.push(digits);
    }
    let redacted = false;
    for (let k = windows.length - 1; k >= 0; k -= 1) {
      const candidate = windows[k];
      if (candidate.length < CARD_MIN_DIGITS) break;
      if (candidate.length === CARD_MIN_DIGITS && candidate[0] !== '4') continue;
      if (luhnValid(candidate)) {
        out.push(CARD_MARKER);
        i += 2 * k + 1;
        redacted = true;
        break;
      }
    }
    if (!redacted) {
      out.push(groups[i]);
      i += 1;
    }
    if (i < groups.length) {
      out.push(groups[i]); // the separator after the group or window
      i += 1;
    }
  }
  return out.join('');
}

/** Characters a provider key is made of after its prefix. */
const KEY_CHARS = String.raw`[A-Za-z0-9_-]`;
/** Characters a bearer token is made of (RFC 6750 b64token). */
const TOKEN_CHARS = String.raw`[A-Za-z0-9._~+/=-]`;

const freeze = (entry: SensitiveValuePattern): Readonly<SensitiveValuePattern> => Object.freeze(entry);

/**
 * The value policy, applied to every string leaf deepRedact reaches and to
 * any free text a caller passes to redactSensitiveText. Order matters where
 * patterns could overlap: the PEM block goes first so its body (base64 that
 * may hold digit runs) is replaced whole.
 */
export const SENSITIVE_VALUE_PATTERNS: readonly Readonly<SensitiveValuePattern>[] = Object.freeze([
  freeze({
    // To the matching END header, or to the end of the text when the block is cut off (a sliced error
    // string): the prefix of a key is still a key. Because a cut-off block consumes the rest of the
    // text, a text with many BEGIN headers and no END is scanned once (linear), not once per header.
    name: 'pem-private-key-block',
    marker: SECRET_MARKER,
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|[\s\S]*$)/g,
  }),
  freeze({
    // Header and claims segments, then any signature, empty included (alg none).
    name: 'jwt',
    marker: SECRET_MARKER,
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g,
  }),
  freeze({
    // The scheme word is kept (named group `lead`); the token goes. A token is 8 or more token characters
    // holding at least one digit or one of . _ ~ + / = -, or 20 or more letters, so "bearer instruments"
    // in prose stays. An optional colon after the word covers an echoed "Authorization: Bearer: <t>".
    name: 'bearer-token',
    marker: SECRET_MARKER,
    pattern: new RegExp(
      String.raw`(?<lead>\bBearer:?\s+)(?:(?=[A-Za-z]*[0-9._~+/=-])${TOKEN_CHARS}{8,}|[A-Za-z]{20,})`,
      'gi',
    ),
  }),
  freeze({
    name: 'aws-access-key-id',
    marker: SECRET_MARKER,
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
  }),
  freeze({
    // sk- (OpenAI, sk-proj-...), sk-ant- (Anthropic), xoxb- (Slack), ghp_ and github_pat_ (GitHub), then 20+ key characters.
    name: 'provider-key-prefix',
    marker: SECRET_MARKER,
    pattern: new RegExp(String.raw`\b(?:sk-ant-|sk-|xoxb-|ghp_|github_pat_)${KEY_CHARS}{20,}`, 'g'),
  }),
  freeze({
    // A maximal run of digit groups joined by one to three spaces or dashes, not preceded by a digit or a
    // plus sign (an E.164 phone number is never a card). The windows inside it are found by redactCardWindows.
    name: 'card-number-luhn',
    marker: CARD_MARKER,
    pattern: /(?<![\d+])\d+(?:[ -]{1,3}\d+)*(?!\d)/g,
    rewrite: redactCardWindows,
  }),
]);

/**
 * Replace every card number and secret-shaped token in free text with its
 * marker, keeping the rest of the text (what an operator or an audit reader
 * needs). The Bearer pattern keeps the scheme word and replaces the token.
 * Idempotent: a marker matches no pattern.
 */
export function redactSensitiveText(text: string): string {
  let out = text;
  for (const { pattern, marker, rewrite } of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, (match: string, ...rest: unknown[]) => {
      if (rewrite) return rewrite(match);
      const groups = rest.length && typeof rest[rest.length - 1] === 'object' ? (rest[rest.length - 1] as Record<string, string | undefined>) : undefined;
      return `${groups?.lead ?? ''}${marker}`;
    });
  }
  return out;
}

/**
 * Recursively redact sensitive fields in-place across objects and arrays.
 * Returns the same reference for convenience. A sensitive key at any depth is
 * replaced with a marker regardless of casing; every other string leaf is
 * passed through redactSensitiveText and written back in place (a string
 * given directly is one leaf, and its redacted copy is returned). Numbers,
 * booleans and null are left untouched. Arrays are traversed
 * element-by-element. The input must be a plain, mutable value: pass a copy
 * (safeRedactedSnapshot clones first); a frozen object or a getter-only
 * property throws, as a sensitive key on a frozen object always did.
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

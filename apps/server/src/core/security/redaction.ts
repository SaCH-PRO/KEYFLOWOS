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
 * value patterns are shaped (a Luhn check over card-shaped groups, a key
 * prefix plus 20 key characters, a PEM header), so an invoice number, a phone
 * number, a date, a UUID or a 16-digit number that fails Luhn is untouched.
 * Residual over-redaction, by design: about one in ten 14 to 19 digit numeric
 * identifiers passes Luhn (every IMEI does) and becomes <card>; a grouped
 * numeric list (several four- or five-digit groups in a row) is redacted
 * about one time in ten to one in four, rising with the number of groups; a
 * card-shaped digit group that completes a valid window with a card is
 * redacted with it; a cut-off PEM block takes the rest of its string leaf.
 * See redactCardWindows for the card rules, the measured rates and what is
 * not covered.
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
 * digit run (groups are split by one to three spaces, tabs, no-break, thin or
 * narrow no-break spaces, hyphens or en dashes), that passes Luhn, and is
 * card-shaped: a single unbroken group; a multi-group window whose first
 * group has 4+ digits and every group 3+ (4-4-4-4, 4-6-5, 4-4-4-4-3); or a
 * generic four-digit mask whose last group has 1 or 2 digits after groups of
 * exactly four (4-4-4-1, 4-4-4-2, 4-4-4-4-1, 4-4-4-4-2: a 13-digit Visa, a
 * 14-digit Diners, a 17 or 18 digit Maestro typed under a #### mask). So a
 * date's parts or a phone's 3-3-4 never join a window. A 13-digit window must
 * start with 4 (legacy Visa is the only 13-digit scheme, and that rule keeps
 * every 13-digit epoch-millisecond id intact). EVERY valid window in the run
 * is redacted (their union), so a neighbouring group that happens to complete
 * a valid window with the head of a card can never leave the card's tail
 * visible; the neighbours outside every valid window stay, and two adjacent
 * cards merge into one marker. An unbroken group longer than 19 digits is
 * not a card (longer than any scheme) and is left whole.
 *
 * Residual over-redaction, by design and measured on synthetic notes (the
 * reviewers' corpora, 3,000 notes per row): about one in ten single 14 to 19
 * digit numeric identifiers passes Luhn (an IMEI always does) and becomes
 * <card>; grouped numeric lists pay the union rule, about one in ten for four
 * four-digit groups, rising by about one in ten per extra group (six groups:
 * about one in four), and one in five for lists of four five-digit ids; the
 * short-tail mask rule adds about one in ten more to lists of three or four
 * four-digit groups followed by a one or two digit token (an IBAN body, a SKU
 * list and a count); a card-shaped neighbour that completes a valid window
 * with a card is redacted with it, about one in ten for a 1 or 4 digit
 * neighbour and one in five for 2 or 3 digits, where two windows can pass.
 * Not covered, by design: a card broken across lines, or joined by dots,
 * slashes, underscores, four or more spaces, or any dash or space other than
 * the ones named above; a card typed in two-digit pairs or with a short
 * group before the last (4-3-3-3-1); a card written directly after a plus
 * sign (the E.164 rule); a digit glued to the number; full-width digits.
 */
const CARD_SEPARATOR = /([ \t\u00a0\u2009\u202f\u2013-]{1,3})/;

/** Groups of exactly four, then a last group of one or two digits: a number typed under a generic #### mask. */
function genericMaskWithShortTail(groupLengths: readonly number[]): boolean {
  const last = groupLengths[groupLengths.length - 1];
  return last >= 1 && last <= 2 && groupLengths.length >= 4 && groupLengths.slice(0, -1).every((len) => len === 4);
}

/** Monotone under appending a group: once a window is not card-shaped, no longer window from the same start is. */
function cardShaped(groupLengths: readonly number[]): boolean {
  if (groupLengths.length === 1) return true;
  if (groupLengths[0] >= 4 && groupLengths.every((len) => len >= 3)) return true;
  return genericMaskWithShortTail(groupLengths);
}

function redactCardWindows(run: string): string {
  const parts = run.split(CARD_SEPARATOR); // digit group, separator, digit group, ...
  const groups: string[] = [];
  const separators: string[] = [];
  for (let k = 0; k < parts.length; k += 1) (k % 2 === 0 ? groups : separators).push(parts[k]);
  const covered: boolean[] = new Array<boolean>(groups.length).fill(false);

  for (let i = 0; i < groups.length; i += 1) {
    let digits = '';
    const lengths: number[] = [];
    for (let j = i; j < groups.length && digits.length + groups[j].length <= CARD_MAX_DIGITS; j += 1) {
      digits += groups[j];
      lengths.push(groups[j].length);
      if (digits.length < CARD_MIN_DIGITS) continue;
      if (digits.length === CARD_MIN_DIGITS && digits[0] !== '4') continue;
      if (!cardShaped(lengths)) break; // a longer window from i cannot become card-shaped again
      if (luhnValid(digits)) for (let g = i; g <= j; g += 1) covered[g] = true;
    }
  }

  const out: string[] = [];
  for (let g = 0; g < groups.length; g += 1) {
    const joinsPrevious = g > 0 && covered[g - 1] && covered[g];
    if (g > 0 && !joinsPrevious) out.push(separators[g - 1]);
    if (!covered[g]) out.push(groups[g]);
    else if (!joinsPrevious) out.push(CARD_MARKER);
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
    // holding at least one digit or one of _ ~ + / = -, or a dot followed by more token text, or 20 or
    // more letters, and does not end in a period: so "bearer instruments" and "the bearer payment." in
    // prose stay. An optional colon after the word covers an echoed "Authorization: Bearer: <t>".
    name: 'bearer-token',
    marker: SECRET_MARKER,
    pattern: new RegExp(
      String.raw`(?<lead>\bBearer:?\s+)(?:(?=[A-Za-z]*(?:[0-9_~+/=-]|\.${TOKEN_CHARS}))${TOKEN_CHARS}{7,}[A-Za-z0-9_~+/=-]|[A-Za-z]{20,})`,
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
    // A maximal run of digit groups joined by one to three spaces, tabs, no-break, thin or narrow no-break
    // spaces, hyphens or en dashes, not preceded by a digit or a plus sign (an E.164 phone number is never a
    // card). The windows inside it are found by redactCardWindows.
    name: 'card-number-luhn',
    marker: CARD_MARKER,
    pattern: /(?<![\d+])\d+(?:[ \t\u00a0\u2009\u202f\u2013-]{1,3}\d+)*(?!\d)/g,
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

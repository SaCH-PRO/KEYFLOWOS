/**
 * Pure validators used by the data-quality scanner. Kept side-effect free
 * (except for the optional MX lookup) so they can be unit-tested and reused
 * by the inline validators on the contact form.
 */

import { promises as dns } from 'dns';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidation = {
  ok: boolean;
  reason?: 'syntax' | 'no_mx' | 'mx_lookup_failed';
  suggestedFix?: string;
};

export type PhoneValidation = {
  ok: boolean;
  e164?: string;
  reason?: 'empty' | 'too_short' | 'invalid';
  suggestedFix?: string;
};

const COMMON_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotnail.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
};

const REQUIRED_BY_RELATIONSHIP: Record<string, string[]> = {
  CLIENT: ['email', 'phone'],
  PROSPECT: ['email'],
  LEAD: ['email'],
  PARTNER: ['email', 'companyName'],
  VENDOR: ['email', 'companyName'],
  SUPPLIER: ['email', 'companyName'],
  REFERRAL: ['email'],
};

const STALE_DEFAULT_DAYS = 180;

const mxCache = new Map<string, { ok: boolean; expiresAt: number }>();
const MX_TTL_MS = 6 * 60 * 60 * 1000;

export function syntaxValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function suggestEmailFix(email: string): string | undefined {
  const at = email.indexOf('@');
  if (at < 0) return undefined;
  const domain = email.slice(at + 1).toLowerCase().trim();
  const fix = COMMON_TYPOS[domain];
  if (fix) return `${email.slice(0, at)}@${fix}`;
  return undefined;
}

/**
 * Email validation with MX lookup. The lookup is skipped when the syntax is
 * invalid (cheaper) or when running in test mode (`KF_DISABLE_MX=1`) so unit
 * tests don't depend on DNS. Cached per-domain for 6h to keep the nightly
 * scan fast.
 */
export async function validateEmail(email: string | null | undefined): Promise<EmailValidation> {
  if (!email) return { ok: true };
  const trimmed = email.trim();
  if (!trimmed) return { ok: true };
  if (!syntaxValidEmail(trimmed)) {
    return { ok: false, reason: 'syntax', suggestedFix: suggestEmailFix(trimmed) };
  }
  if (process.env.KF_DISABLE_MX === '1') return { ok: true };

  const domain = trimmed.slice(trimmed.indexOf('@') + 1).toLowerCase();
  const cached = mxCache.get(domain);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    if (cached.ok) return { ok: true };
    return { ok: false, reason: 'no_mx', suggestedFix: suggestEmailFix(trimmed) };
  }
  try {
    const records = await dns.resolveMx(domain);
    const ok = Array.isArray(records) && records.length > 0;
    mxCache.set(domain, { ok, expiresAt: now + MX_TTL_MS });
    if (ok) return { ok: true };
    return { ok: false, reason: 'no_mx', suggestedFix: suggestEmailFix(trimmed) };
  } catch (err: any) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    // Soft-fail on transient/unknown DNS errors so we don't flag every contact
    // when DNS is flaky. We only persist a hard failure when the domain has no
    // MX records (ENODATA / ENOTFOUND).
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      mxCache.set(domain, { ok: false, expiresAt: now + MX_TTL_MS });
      return { ok: false, reason: 'no_mx', suggestedFix: suggestEmailFix(trimmed) };
    }
    return { ok: true, reason: 'mx_lookup_failed' };
  }
}

/**
 * The dialling rules of one country, as far as reading a contact's phone needs them
 * (WA-E164-SERVER): a number typed without its country code is read under the business's
 * country (Business.country). Kept to the countries the CRM serves (Trinidad and Tobago and its
 * neighbours, North America, the UK) without dragging in libphonenumber; a country not listed
 * here has no rules, and a local number under it cannot be read (it is kept as typed and
 * flagged, never guessed).
 */
export type PhoneCountry = {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** ITU-T E.164 country calling code, digits only ('1', '592', '44'). */
  callingCode: string;
  /** Digits of a national (significant) number, after the country code. */
  nationalLengths: readonly number[];
  /**
   * North American Numbering Plan members with ONE area code: a seven-digit local number is
   * behind it ('712-3401' in Trinidad and Tobago is +1 868 712 3401). Countries with several
   * area codes (the US, Canada, Jamaica, ...) need the area code typed.
   */
  areaCode?: string;
  /** The trunk prefix dialled at home in front of the national number ('0'), dropped in E.164. */
  trunkPrefix?: string;
  /** Other ways Business.country may name it (compared lower-case, '&' read as 'and'). */
  names: readonly string[];
};

const NANP = { callingCode: '1', nationalLengths: [10] } as const;

const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: 'TT', ...NANP, areaCode: '868', names: ['tto', 'trinidad and tobago', 'trinidad', 'tobago', 't and t', 'tandt'] },
  { iso: 'US', ...NANP, names: ['usa', 'united states', 'united states of america', 'america'] },
  { iso: 'CA', ...NANP, names: ['can', 'canada'] },
  { iso: 'JM', ...NANP, names: ['jam', 'jamaica'] },
  { iso: 'PR', ...NANP, names: ['pri', 'puerto rico'] },
  { iso: 'DO', ...NANP, names: ['dom', 'dominican republic'] },
  { iso: 'BB', ...NANP, areaCode: '246', names: ['brb', 'barbados'] },
  { iso: 'BS', ...NANP, areaCode: '242', names: ['bhs', 'bahamas', 'the bahamas'] },
  { iso: 'AG', ...NANP, areaCode: '268', names: ['atg', 'antigua and barbuda', 'antigua'] },
  { iso: 'DM', ...NANP, areaCode: '767', names: ['dma', 'dominica'] },
  { iso: 'GD', ...NANP, areaCode: '473', names: ['grd', 'grenada'] },
  { iso: 'KN', ...NANP, areaCode: '869', names: ['kna', 'saint kitts and nevis', 'st kitts and nevis'] },
  { iso: 'LC', ...NANP, areaCode: '758', names: ['lca', 'saint lucia', 'st lucia'] },
  { iso: 'VC', ...NANP, areaCode: '784', names: ['vct', 'saint vincent and the grenadines', 'st vincent and the grenadines'] },
  { iso: 'BM', ...NANP, areaCode: '441', names: ['bmu', 'bermuda'] },
  { iso: 'KY', ...NANP, areaCode: '345', names: ['cym', 'cayman islands'] },
  { iso: 'VG', ...NANP, areaCode: '284', names: ['vgb', 'british virgin islands'] },
  { iso: 'VI', ...NANP, areaCode: '340', names: ['vir', 'us virgin islands', 'united states virgin islands'] },
  { iso: 'AI', ...NANP, areaCode: '264', names: ['aia', 'anguilla'] },
  { iso: 'MS', ...NANP, areaCode: '664', names: ['msr', 'montserrat'] },
  { iso: 'TC', ...NANP, areaCode: '649', names: ['tca', 'turks and caicos islands', 'turks and caicos'] },
  { iso: 'SX', ...NANP, areaCode: '721', names: ['sxm', 'sint maarten'] },
  { iso: 'GY', callingCode: '592', nationalLengths: [7], names: ['guy', 'guyana'] },
  { iso: 'SR', callingCode: '597', nationalLengths: [6, 7], names: ['sur', 'suriname'] },
  { iso: 'BZ', callingCode: '501', nationalLengths: [7], names: ['blz', 'belize'] },
  { iso: 'AW', callingCode: '297', nationalLengths: [7], names: ['abw', 'aruba'] },
  { iso: 'HT', callingCode: '509', nationalLengths: [8], names: ['hti', 'haiti'] },
  { iso: 'GB', callingCode: '44', nationalLengths: [9, 10], trunkPrefix: '0', names: ['gbr', 'uk', 'united kingdom', 'great britain', 'england', 'scotland', 'wales'] },
  { iso: 'VE', callingCode: '58', nationalLengths: [10], trunkPrefix: '0', names: ['ven', 'venezuela'] },
];

/** A business with no country set is in Trinidad and Tobago (WA-E164-SERVER, journey C). */
export const DEFAULT_PHONE_COUNTRY_ISO = 'TT';

const PHONE_COUNTRY_BY_NAME: ReadonlyMap<string, PhoneCountry> = new Map(
  PHONE_COUNTRIES.flatMap((c) => [[c.iso.toLowerCase(), c] as const, ...c.names.map((n) => [n, c] as const)]),
);

function countryKey(written: string): string {
  return written.trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The dialling rules for Business.country as it is written: an ISO code ('TT', 'tt'), the
 * three-letter code ('TTO') or the name ('Trinidad and Tobago', 'Trinidad & Tobago'). Unset or
 * blank is Trinidad and Tobago; a country with no rules here is null. A calling code written
 * with '+' ('+1 868', '+44') is read as that code, the shape this reader took before.
 */
export function resolvePhoneCountry(country?: string | null): PhoneCountry | null {
  const written = (country ?? '').trim();
  if (!written) return PHONE_COUNTRY_BY_NAME.get(DEFAULT_PHONE_COUNTRY_ISO.toLowerCase()) ?? null;
  if (written.startsWith('+')) {
    const digits = written.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('1') && digits.length === 4) {
      return { iso: '', ...NANP, areaCode: digits.slice(1), names: [] };
    }
    if (digits.startsWith('1')) return { iso: '', ...NANP, names: [] };
    return { iso: '', callingCode: digits, nationalLengths: [], names: [] };
  }
  return PHONE_COUNTRY_BY_NAME.get(countryKey(written)) ?? null;
}

/** Fewest and most digits of an international number (E.164: at most 15). */
const MIN_PHONE_DIGITS = 7;
const MAX_E164_DIGITS = 15;

/** A NANP national number: a ten-digit number whose area code starts 2-9. */
function validNanpNational(national: string): boolean {
  return /^[2-9]\d{9}$/.test(national);
}

/** The digits of a number written with its country code, if they can be an E.164 number. */
function readInternational(digits: string): string | null {
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_E164_DIGITS) return null;
  // A North American number is +1 and ten digits.
  if (digits.startsWith('1') && !(digits.length === 11 && validNanpNational(digits.slice(1)))) return null;
  return digits;
}

/** The national number of `digits` typed without a country code, read under `rules`. */
function readNational(digits: string, rules: PhoneCountry): string | null {
  let national = digits;
  if (rules.callingCode === '1') {
    if (national.length === 11 && national.startsWith('1')) national = national.slice(1);
    if (national.length === 7 && rules.areaCode) national = `${rules.areaCode}${national}`;
    return validNanpNational(national) ? `1${national}` : null;
  }
  const fits = (n: string) => rules.nationalLengths.includes(n.length);
  if (rules.trunkPrefix && national.startsWith(rules.trunkPrefix) && fits(national.slice(rules.trunkPrefix.length))) {
    national = national.slice(rules.trunkPrefix.length);
  } else if (national.startsWith(rules.callingCode) && fits(national.slice(rules.callingCode.length)) && !fits(national)) {
    // The country code typed without '+'.
    national = national.slice(rules.callingCode.length);
  }
  return fits(national) ? `${rules.callingCode}${national}` : null;
}

/**
 * E.164 normalisation without libphonenumber (WA-E164-SERVER). A number written with '+' (or
 * the international prefix 00, or 011 under a North American country) carries its country
 * code: its digits are the number, a North American one being +1 and ten digits. A number
 * written without one is read under `country` (Business.country as written, see
 * resolvePhoneCountry; unset is Trinidad and Tobago): '712-3401', '868-712-3401' and
 * '1 (868) 712-3401' are all +18687123401 in Trinidad and Tobago, '600-1234' is +5926001234 in
 * Guyana, '07911 123456' is +447911123456 in the UK. A number that cannot be read this way
 * (no digits, too few or too many, a local number under a country with no rules here) is not
 * ok; the write paths keep it as typed and flag it, never drop it.
 */
export function normalizeToE164(phone: string | null | undefined, country?: string | null): PhoneValidation {
  if (!phone) return { ok: true };
  const raw = phone.trim();
  if (!raw) return { ok: true };
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return { ok: false, reason: 'invalid' };
  if (digits.length < MIN_PHONE_DIGITS) return { ok: false, reason: 'too_short' };
  const rules = resolvePhoneCountry(country);

  let international: string | null | undefined;
  if (raw.startsWith('+')) international = readInternational(digits);
  else if (digits.startsWith('00')) international = readInternational(digits.slice(2));
  else if (rules?.callingCode === '1' && digits.startsWith('011')) international = readInternational(digits.slice(3));

  let e164Digits: string | null;
  if (international !== undefined) {
    e164Digits = international;
  } else {
    if (digits.length > MAX_E164_DIGITS) return { ok: false, reason: 'invalid' };
    e164Digits = rules ? readNational(digits, rules) : null;
  }
  if (!e164Digits) return { ok: false, reason: 'invalid' };
  const e164 = `+${e164Digits}`;
  return { ok: true, e164, suggestedFix: raw === e164 ? undefined : e164 };
}

/**
 * What a write path stores for a phone or WhatsApp number as typed (WA-E164-SERVER): null for
 * none; a number typed with its country code ('+...') as written, trimmed (its key,
 * normalizePhone, is already the E.164 digits; the required Release 0 create case pins that
 * spelling); any other number that reads under the business's country in E.164; a number that
 * does not read as typed, with `unreadable` set so the caller flags it. `e164` is the number's
 * E.164 form whenever it reads.
 */
export function contactPhoneForStorage(
  typed: string | null | undefined,
  country?: string | null,
): { value: string | null; e164: string | null; unreadable: boolean } {
  const value = typed?.trim() ? typed.trim() : null;
  if (!value) return { value: null, e164: null, unreadable: false };
  const read = normalizeToE164(value, country);
  if (!read.ok || !read.e164) return { value, e164: null, unreadable: true };
  return { value: value.startsWith('+') ? value : read.e164, e164: read.e164, unreadable: false };
}

/**
 * Whether a stored phone key (Contact.phoneNormalized: the digits and any '+' of the number as it
 * was typed) is the number `e164`, read under the business's country (WA-E164-SERVER review
 * SEC-E164-1/2): equal, or the key read the way a number typed today is read (normalizeToE164
 * under Business.country). A contact stored before phones were kept in E.164 keeps the key of
 * its spelling (no backfill in v1), so in Trinidad and Tobago '7123401', '8687123401' and
 * '18687123401' are all +18687123401, while '7123401' is never '+5927123401' (Guyana) nor any
 * other country's number that happens to end with the same digits. This is an identity decision
 * (who already holds the number), so it does not use the country-agnostic search reading
 * (samePhoneKey), which lets a national number sit behind ANY country calling code.
 */
export function phoneKeyReadsAs(key: string | null | undefined, e164: string, country?: string | null): boolean {
  if (!key) return false;
  if (key === e164) return true;
  const read = normalizeToE164(key, country);
  return read.ok && read.e164 === e164;
}

/** The contact fields a phone flag (an 'invalid_phone' data-quality issue) is written for. */
export const PHONE_FLAG_FIELDS = ['phone', 'whatsappNumber'] as const;
export type PhoneFlagField = typeof PHONE_FLAG_FIELDS[number];

/**
 * The phone flag a contact carries for numbers that do not read under the business's country
 * (WA-E164-SERVER): the first of its phone and WhatsApp number that is present and does not
 * read, as the 'invalid_phone' issue the data-quality scan writes for it, or null when both
 * read (or are empty). One issue per contact and kind (ContactDataIssue is unique on both), so
 * a contact whose phone and WhatsApp number both fail is flagged on the phone.
 */
export function phoneFlagFor(
  contact: { phone?: string | null; whatsappNumber?: string | null },
  country?: string | null,
): { field: PhoneFlagField; message: string; recommendedFix: Record<string, unknown> } | null {
  for (const field of PHONE_FLAG_FIELDS) {
    const value = contact[field];
    if (!value || !value.trim()) continue;
    const read = normalizeToE164(value, country);
    if (read.ok) continue;
    return field === 'phone'
      ? { field, message: 'Phone number is not in a recognisable international format.', recommendedFix: { action: 'edit_phone' } }
      : { field, message: 'WhatsApp number is not in a recognisable international format.', recommendedFix: { action: 'edit_whatsapp' } };
  }
  return null;
}

export function requiredFieldsFor(relationshipType?: string | null): string[] {
  if (!relationshipType) return REQUIRED_BY_RELATIONSHIP.LEAD;
  const key = relationshipType.toUpperCase();
  return REQUIRED_BY_RELATIONSHIP[key] ?? REQUIRED_BY_RELATIONSHIP.LEAD;
}

export function missingRequiredFields(contact: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  relationshipType?: string | null;
}): string[] {
  const required = requiredFieldsFor(contact.relationshipType);
  const missing: string[] = [];
  for (const field of required) {
    const value = (contact as Record<string, unknown>)[field];
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      missing.push(field);
    }
  }
  return missing;
}

export function isStale(opts: {
  lastInteractionAt?: Date | null;
  lastVerifiedAt?: Date | null;
  createdAt: Date;
  staleDays: number;
  now?: Date;
}): boolean {
  const days = opts.staleDays > 0 ? opts.staleDays : STALE_DEFAULT_DAYS;
  const reference = opts.lastVerifiedAt ?? opts.lastInteractionAt ?? opts.createdAt;
  if (!reference) return false;
  const now = opts.now ?? new Date();
  const diff = now.getTime() - reference.getTime();
  return diff > days * 86_400_000;
}

/**
 * Compute a 0-100 hygiene score from the boolean signals we already have.
 * Weighting reflects how much each signal damages outreach: a bad email
 * hurts more than a stale touch.
 */
export function computeQualityScore(signals: {
  emailValid: boolean;
  emailPresent: boolean;
  phoneValid: boolean;
  phonePresent: boolean;
  hasMissingRequired: boolean;
  hasDuplicate: boolean;
  isStale: boolean;
}): number {
  let score = 100;
  if (signals.emailPresent && !signals.emailValid) score -= 30;
  else if (!signals.emailPresent) score -= 10;
  if (signals.phonePresent && !signals.phoneValid) score -= 20;
  else if (!signals.phonePresent) score -= 5;
  if (signals.hasMissingRequired) score -= 15;
  if (signals.hasDuplicate) score -= 20;
  if (signals.isStale) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export const DATA_QUALITY_KINDS = [
  'invalid_email',
  'invalid_phone',
  'missing_required',
  'stale_data',
  'suspected_duplicate',
] as const;

export type DataQualityKind = typeof DATA_QUALITY_KINDS[number];

export function severityFor(kind: DataQualityKind): 'low' | 'medium' | 'high' {
  switch (kind) {
    case 'invalid_email':
    case 'suspected_duplicate':
      return 'high';
    case 'invalid_phone':
    case 'missing_required':
      return 'medium';
    case 'stale_data':
      return 'low';
  }
}

// Exposed for tests so the cache doesn't bleed across runs.
export function __resetMxCacheForTests(): void {
  mxCache.clear();
}

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
  } catch (err) {
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
 * Best-effort E.164 normalisation without dragging in libphonenumber. We
 * extract digits, accept a leading + as country-code preserved, and require
 * 8-15 digits total (E.164 max). For local numbers without a country code we
 * attach the business default if provided. This isn't as precise as
 * libphonenumber but covers the common Trinidad/Caribbean/US cases the CRM
 * sees today and keeps the dependency surface small.
 */
export function normalizeToE164(phone: string | null | undefined, defaultCountryCode?: string): PhoneValidation {
  if (!phone) return { ok: true };
  const raw = phone.trim();
  if (!raw) return { ok: true };
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return { ok: false, reason: 'invalid' };
  if (digits.length < 7) return { ok: false, reason: 'too_short' };
  if (digits.length > 15) return { ok: false, reason: 'invalid' };
  if (hasPlus) {
    return { ok: true, e164: `+${digits}`, suggestedFix: raw === `+${digits}` ? undefined : `+${digits}` };
  }
  // Treat 11+ digit numbers starting with country prefix as already global.
  if (digits.length >= 11) {
    const e164 = `+${digits}`;
    return { ok: true, e164, suggestedFix: e164 };
  }
  if (defaultCountryCode) {
    const cc = defaultCountryCode.replace(/[^0-9]/g, '');
    if (cc) {
      const e164 = `+${cc}${digits}`;
      return { ok: true, e164, suggestedFix: e164 };
    }
  }
  // Without a country code we can't safely produce E.164 — surface as invalid
  // with a recommended fix if the user can supply one.
  return { ok: false, reason: 'invalid', suggestedFix: undefined };
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

import type { PrismaService } from '../../core/prisma/prisma.service';
import { samePhoneNumber } from '../structure/position-holders';
import { contactWhereBase } from './crm.helpers';

export function normalizeEmail(email?: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

/**
 * The stored phone key (Contact.phoneNormalized): the digits and any '+' of the number as typed.
 * Two spellings of one number keep two keys ('868-555-0102' is '8685550102', '+1 868 555 0102' is
 * '+18685550102'); the readers below compare keys as numbers, not as strings (SWP-CRM-SEARCH,
 * BUG-083). Stored keys are not rewritten here: every writer and reader of the column
 * (EntityResolutionService, the connector syncs, the partial unique index) agrees on this shape.
 */
export function normalizePhone(phone?: string | null): string | null {
  return phone ? phone.replace(/[^0-9+]/g, '') : null;
}

/** The fewest digits read as a phone number of their own (a national number), as samePhoneNumber reads them. */
const MIN_PHONE_DIGITS = 7;

/** The longest country calling code (ITU-T E.164). */
const MAX_COUNTRY_CODE_DIGITS = 3;

/**
 * Whether two phone keys (or spellings) are one number (SWP-CRM-SEARCH, BUG-083): equal, or one
 * number by samePhoneNumber (structure/position-holders.ts), the rule KEY already applies to staff
 * phones: the same digits with or without '+', or a national number of 7+ digits written without
 * '+' ('8685550102') that the other's digits end with behind exactly a country calling code
 * ('+18685550102', '18685550102'). A local number shorter than that, or digits behind something
 * that is not a country code, is not a match.
 */
export function samePhoneKey(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a === b || samePhoneNumber(a, b);
}

/** The row holding `key`: the one stored with exactly this key first, else one holding the same number. */
export function findPhoneKeyMatch<T extends { phoneNormalized: string | null }>(rows: readonly T[], key: string): T | undefined {
  return rows.find((row) => row.phoneNormalized === key) ?? rows.find((row) => samePhoneKey(row.phoneNormalized, key));
}

/**
 * What a list search matches inside phoneNormalized for the text typed (SWP-CRM-SEARCH, BUG-083):
 * the text's key as before (any digits typed match a stored key containing them), its digits
 * without '+' (a key stored without the '+'), and, for a number written with its country code
 * ('+1 868 555 0102', or 11+ digits), the national number behind each country calling code it may
 * start with ('8685550102', a key stored the national way). A stored national key is a substring
 * of the international one, so a national search already finds an international key.
 */
export function phoneSearchKeys(search: string): string[] {
  const keys = new Set<string>();
  const normalized = normalizePhone(search);
  if (normalized) keys.add(normalized);
  const digits = search.replace(/\D/g, '');
  if (digits.length >= MIN_PHONE_DIGITS) {
    keys.add(digits);
    if (search.includes('+') || digits.length > 10) {
      for (let k = 1; k <= MAX_COUNTRY_CODE_DIGITS; k += 1) {
        const national = digits.slice(k);
        if (national.length >= MIN_PHONE_DIGITS && samePhoneNumber(national, `+${digits}`)) keys.add(national);
      }
    }
  }
  return [...keys];
}

const DUPLICATE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  emailNormalized: true,
  phone: true,
  phoneNormalized: true,
} as const;

/**
 * The live contacts of a business holding one of `emails` (normalised, exact) or one of `phones`
 * (phone keys). A phone matches a contact holding the same number in any spelling
 * (samePhoneKey): candidates are the exact keys plus the keys ending with the same last seven
 * digits, then each is kept only when it is one number with a phone asked for.
 */
export async function findExistingBulk(
  prisma: PrismaService,
  businessId: string,
  emails: string[],
  phones: string[],
) {
  const existingByEmail = emails.length > 0
    ? await prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId), emailNormalized: { in: emails } },
        select: DUPLICATE_SELECT,
      })
    : [];

  let existingByPhone: Array<typeof existingByEmail[number]> = [];
  if (phones.length > 0) {
    const tails = new Set<string>();
    for (const phone of phones) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= MIN_PHONE_DIGITS) tails.add(digits.slice(-MIN_PHONE_DIGITS));
    }
    const candidates = await prisma.client.contact.findMany({
      where: {
        ...contactWhereBase(businessId),
        OR: [
          { phoneNormalized: { in: phones } },
          ...[...tails].map((tail) => ({ phoneNormalized: { endsWith: tail } })),
        ],
      },
      select: DUPLICATE_SELECT,
    });
    existingByPhone = candidates.filter((row) => phones.some((phone) => samePhoneKey(row.phoneNormalized, phone)));
  }

  return { existingByEmail, existingByPhone };
}

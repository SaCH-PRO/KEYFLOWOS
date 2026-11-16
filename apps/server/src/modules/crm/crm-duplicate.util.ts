import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { samePhoneNumber } from '../structure/position-holders';
import { contactWhereBase } from './crm.helpers';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { phoneKeyReadsAs } from './crm-data-quality.util';

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

/** Whether a stored phone key holds the phone asked for (a key or spelling); samePhoneKey by default. */
export type SamePhone = (storedKey: string | null, asked: string) => boolean;

/**
 * The row holding `key`: the one stored with exactly this key first, else one holding the same
 * number (`samePhone`: samePhoneKey by default; the import preview passes the reading under the
 * business's country, WA-E164-SERVER review COR-E164-5).
 */
export function findPhoneKeyMatch<T extends { phoneNormalized: string | null }>(
  rows: readonly T[],
  key: string,
  samePhone: SamePhone = samePhoneKey,
): T | undefined {
  return rows.find((row) => row.phoneNormalized === key) ?? rows.find((row) => samePhone(row.phoneNormalized, key));
}

/**
 * The live contacts of a business, other than `exceptId`, that hold the number `e164`
 * (WA-E164-SERVER; review SEC-E164-1/2): stored under exactly that key, or under another
 * spelling's key that reads as that number under the business's country (phoneKeyReadsAs) — a
 * contact stored before phones were kept in E.164 keeps the key of its spelling (no backfill in
 * v1): in Trinidad and Tobago '7123401', '8687123401' and '18687123401' hold +18687123401, and
 * '7123401' does not hold '+5927123401'. With `otherKeysOnly`, a holder under exactly the E.164
 * key is left out (the write's identity unique decides it; its P2002 is mapped to the same 409).
 * Candidates are the keys ending with the number's last seven digits (reading a key under a
 * country only ever changes its front), oldest first. Tenant-wide: the caller bounds what it
 * discloses.
 */
export async function livePhoneHolderIds(
  client: Pick<PrismaService['client'], 'contact'>,
  businessId: string,
  e164: string,
  country: string | null | undefined,
  opts: { exceptId?: string; otherKeysOnly?: boolean } = {},
): Promise<string[]> {
  const tail = e164.replace(/\D/g, '').slice(-MIN_PHONE_DIGITS);
  if (tail.length < MIN_PHONE_DIGITS) return [];
  const rows = await client.contact.findMany({
    where: {
      ...contactWhereBase(businessId),
      phoneNormalized: opts.otherKeysOnly ? { endsWith: tail, not: e164 } : { endsWith: tail },
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    select: { id: true, phoneNormalized: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.filter((row) => phoneKeyReadsAs(row.phoneNormalized, e164, country)).map((row) => row.id);
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
 * (`samePhone`: samePhoneKey by default; CrmService.checkDuplicates passes the reading under the
 * business's country, WA-E164-SERVER review COR-E164-5): candidates are the exact keys plus the
 * keys ending with the same last seven digits, then each is kept only when it is one number with
 * a phone asked for.
 *
 * With `actorUserId`, only contacts that member may open are read: both reads carry the M7
 * visibility clause GET contacts/:contactId applies (resolveCrmAccess + visibilityClause), as
 * CrmService.rejectContactIdentityTaken does. The answer names each holder (id, name, email,
 * phone, keys) and the id is a working key, so a holder the member is denied detail on (a
 * 'my book' STAFF, or a view-all STAFF against another member's PRIVATE row) is not matched here
 * either (SWP-CRM-SEARCH review SEC-CRMS-1). Callers with no actor (internal jobs) read the
 * whole tenant.
 */
export async function findExistingBulk(
  prisma: PrismaService,
  businessId: string,
  emails: string[],
  phones: string[],
  actorUserId?: string | null,
  samePhone: SamePhone = samePhoneKey,
) {
  // The member's visibility, AND'd onto both reads (none for OWNER, SUPER_ADMIN or no actor).
  let visible: { AND?: Prisma.ContactWhereInput[] } = {};
  if (actorUserId && (emails.length > 0 || phones.length > 0)) {
    const access = await resolveCrmAccess(prisma, businessId, actorUserId);
    const visClause = visibilityClause(access, actorUserId);
    if (visClause) visible = { AND: [visClause as Prisma.ContactWhereInput] };
  }

  const existingByEmail = emails.length > 0
    ? await prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId), emailNormalized: { in: emails }, ...visible },
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
        ...visible,
      },
      select: DUPLICATE_SELECT,
    });
    existingByPhone = candidates.filter((row) => phones.some((phone) => row.phoneNormalized === phone || samePhone(row.phoneNormalized, phone)));
  }

  return { existingByEmail, existingByPhone };
}

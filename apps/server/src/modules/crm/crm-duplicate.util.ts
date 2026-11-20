import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { contactPhoneForStorage, normalizeToE164, phoneKeyReadsAs, resolvePhoneCountry } from './crm-data-quality.util';

export function normalizeEmail(email?: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

/**
 * The digits and any '+' of a phone as written: the shape of the stored phone key
 * (Contact.phoneNormalized). Since WA-E164-SERVER a contact write stores the phone in E.164 read
 * under the business's country, so the key it stores is the E.164 number (contactPhoneKey); a
 * key stored before (or by a writer that kept the spelling) is the digits of that spelling
 * ('868-555-0102' is '8685550102'). The readers below compare keys as numbers, under the
 * business's country (FU-PHONE-COUNTRY-DUPLICATES, D-211), never as strings;
 * scripts/backfill-phone-keys.ts rewrites the old keys.
 */
export function normalizePhone(phone?: string | null): string | null {
  return phone ? phone.replace(/[^0-9+]/g, '') : null;
}

/**
 * The identity key a contact write stores for the phone it stores (Contact.phoneNormalized): its
 * digits and '+', or null when it has no digit (WA-E164-SERVER: a phone such as 'ask at the front
 * desk' is kept as typed and holds no key, so two of them are two contacts).
 */
export function contactPhoneKey(phone?: string | null): string | null {
  const key = normalizePhone(phone);
  return key && /\d/.test(key) ? key : null;
}

/**
 * What a contact write stores for a phone as it was delivered (FU-PHONE-COUNTRY-DUPLICATES, D-211;
 * the reading of WA-E164-SERVER's createContact): `phone` is contactPhoneForStorage's value (E.164
 * under the business's country; a number typed with '+' as written; one that does not read as
 * typed, `unreadable`), `phoneNormalized` its identity key, `e164` the number when it reads.
 * EntityResolutionService and the Google and Outlook contact syncs write through this, so every
 * door keys a number the way POST .../contacts does.
 */
export function contactPhoneRead(
  typed: string | null | undefined,
  country: string | null | undefined,
): { phone: string | null; phoneNormalized: string | null; e164: string | null; unreadable: boolean } {
  const read = contactPhoneForStorage(typed, country);
  return { phone: read.value, phoneNormalized: contactPhoneKey(read.value), e164: read.e164, unreadable: read.unreadable };
}

/** The fewest digits read as a phone number of their own (a national number). */
const MIN_PHONE_DIGITS = 7;

/**
 * Whether two phone keys (or spellings) are one number (SWP-CRM-SEARCH, BUG-083; owner ruling
 * D-211, FU-PHONE-COUNTRY-DUPLICATES): equal, or both read as the same E.164 number under the
 * business's country (normalizeToE164; `country` is Business.country as written, unset is
 * Trinidad and Tobago). A key written with '+' is the number it spells; one written without is
 * read in the business's country only, so in Trinidad and Tobago '8685550102', '18685550102' and
 * the seven-digit '5550102' are +1 868 555 0102, while '+44 868 555 0102' and '+592 555 0102' are
 * other numbers. A key that does not read (too short; a local number under a country with no
 * rules here) is only its own key. Before D-211 a national number matched behind ANY country
 * calling code (samePhoneNumber).
 */
export function samePhoneKey(a: string | null | undefined, b: string | null | undefined, country: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const readA = normalizeToE164(a, country);
  const readB = normalizeToE164(b, country);
  return readA.ok && readB.ok && !!readA.e164 && readA.e164 === readB.e164;
}

/** Whether a stored phone key holds the phone asked for (a key or spelling), read under the business's country. */
export type SamePhone = (storedKey: string | null, asked: string) => boolean;

/**
 * The row holding `key`: the one stored with exactly this key first, else one holding the same
 * number (`samePhone`: the caller's reading under the business's country; the import preview
 * passes the one the create and the import use, WA-E164-SERVER review COR-E164-5).
 */
export function findPhoneKeyMatch<T extends { phoneNormalized: string | null }>(
  rows: readonly T[],
  key: string,
  samePhone: SamePhone,
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
 * The live contacts of a business, other than `exceptId`, holding the phone a write would store
 * (contactPhoneRead; FU-PHONE-COUNTRY-DUPLICATES, D-211): when it reads, every holder of that
 * number (livePhoneHolderIds: its E.164 key, or a key stored before E.164 that reads as it under
 * the business's country); when it does not read, the holders of exactly its key (a number that
 * cannot be read is only its own spelling). Oldest first. Tenant-wide: the caller bounds what it
 * discloses.
 */
export async function livePhoneKeyHolderIds(
  client: Pick<PrismaService['client'], 'contact'>,
  businessId: string,
  read: { e164: string | null; phoneNormalized: string | null },
  country: string | null | undefined,
  opts: { exceptId?: string } = {},
): Promise<string[]> {
  if (read.e164) return livePhoneHolderIds(client, businessId, read.e164, country, { exceptId: opts.exceptId });
  if (!read.phoneNormalized) return [];
  const rows = await client.contact.findMany({
    where: {
      ...contactWhereBase(businessId),
      phoneNormalized: read.phoneNormalized,
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map((row) => row.id);
}

/**
 * What a list search matches inside phoneNormalized for the text typed (SWP-CRM-SEARCH, BUG-083):
 * the text's key as before (any digits typed match a stored key containing them), its digits
 * without '+' (a key stored without the '+'), and, when the text reads as a number of the
 * business's own country (normalizeToE164 under `country`, Business.country as written; unset is
 * Trinidad and Tobago), that number's national spelling ('8685550102' for '+1 868 555 0102' in
 * Trinidad and Tobago; with the trunk prefix too where the country dials one), the shape a key
 * stored before E.164 has. A number of another country is searched only as typed: in Trinidad and
 * Tobago '+44 868 555 0102' does not find '868-555-0102', nor '+592 555 0102' the seven-digit
 * '555-0102' (owner ruling D-211, FU-PHONE-COUNTRY-DUPLICATES; before, the national number behind
 * ANY country calling code was searched). A stored national key is a substring of the
 * international one, so a national search already finds an international key.
 */
export function phoneSearchKeys(search: string, country?: string | null): string[] {
  const keys = new Set<string>();
  const normalized = normalizePhone(search);
  if (normalized) keys.add(normalized);
  const digits = search.replace(/\D/g, '');
  if (digits.length >= MIN_PHONE_DIGITS) {
    keys.add(digits);
    const read = normalizeToE164(search, country);
    const rules = resolvePhoneCountry(country);
    if (read.ok && read.e164 && rules?.callingCode && read.e164.startsWith(`+${rules.callingCode}`)) {
      const national = read.e164.slice(1 + rules.callingCode.length);
      for (const spelling of [national, rules.trunkPrefix ? `${rules.trunkPrefix}${national}` : null]) {
        if (spelling && spelling.length >= MIN_PHONE_DIGITS && phoneKeyReadsAs(spelling, read.e164, country)) keys.add(spelling);
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
 * (`samePhone`: the reading under the business's country; CrmService.checkDuplicates passes the
 * one its create and import use, WA-E164-SERVER review COR-E164-5): candidates are the exact keys
 * plus the keys ending with the same last seven digits, then each is kept only when it is one
 * number with a phone asked for.
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
  actorUserId: string | null | undefined,
  samePhone: SamePhone,
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

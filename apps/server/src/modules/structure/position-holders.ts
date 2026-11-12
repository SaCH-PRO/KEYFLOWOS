import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Who stands behind a staff position, as HTTP knows them (V1-21b). KEY knows a WhatsApp/SMS
 * sender only by the phone; StructureService.resolveStaffByPhone (the tool envelope) and
 * AiOversightService.resolveApprovalByAssignment (a reply approval) read the holder and the
 * phone members here, so both are capped by the same rows.
 */

/** The holder's account, as AuthMiddleware reads it (V1-21b review 5 INP4-1). */
export const HOLDER_ACCOUNT = { deletedAt: true, bannedAt: true } as const;

/** A membership with its user's account state, as the envelope and the approval cap read it. */
export type HolderMembershipRow = Prisma.MembershipGetPayload<{ include: { user: { select: typeof HOLDER_ACCOUNT } } }>;

/**
 * ITU-T E.164 country calling codes (1 to 3 digits). Used only to accept that digits in front of
 * a national number are a country code; a number is never rewritten with one.
 */
const COUNTRY_CALLING_CODES: ReadonlySet<string> = new Set(
  [
    '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
    '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86',
    '90', '91', '92', '93', '94', '95', '98',
    '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229', '230', '231',
    '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244', '245', '246', '247', '248',
    '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260', '261', '262', '263', '264', '265', '266',
    '267', '268', '269', '290', '291', '297', '298', '299',
    '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375', '376',
    '377', '378', '379', '380', '381', '382', '383', '385', '386', '387', '389',
    '420', '421', '423',
    '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592', '593', '594', '595', '596',
    '597', '598', '599',
    '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688',
    '689', '690', '691', '692',
    '800', '808', '850', '852', '853', '855', '856', '870', '878', '880', '881', '882', '883', '886', '888',
    '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977',
    '979', '992', '993', '994', '995', '996', '998',
  ],
);

/** The shortest national number compared against another number's trailing digits. */
const MIN_NATIONAL_DIGITS = 7;

/**
 * A national trunk 0 written in parentheses after the country code ('+44 (0)20 7946 0958'): dialled
 * at home, dropped from abroad (V1-21c FB2-PLUS0). Only a lone 0 in parentheses is read so.
 */
const PARENTHESISED_TRUNK_ZERO = /\(\s*0\s*\)/g;

/**
 * Russia and Kazakhstan (country code 7) write their national trunk prefix as 8, not 0:
 * '8 (912) 345-67-89' is '+79123456789' (V1-21c FB2-PLUS0). The 8 is read as a trunk prefix only
 * where it is written as one, set apart from the number by a space, '(', '-' or '.', in front of
 * a 10-digit national number, and only against country code 7. A bare run of digits that begins
 * with 8 is read as written: it is how Meta writes a sender in country codes 81 to 88 (Vietnam
 * '84951234567', Hong Kong '85291234567'), and read as a trunk 8 it would be the +7 number with
 * the same last ten digits (V1-21c review CR-1). Nor is a national number that merely begins
 * with 8 ('868-555-0122') ever shortened into another country's number. A position's contactPhone
 * arrives as normalizePhone leaves it (digits and '+'), so the trunk 8 is read on User.phone,
 * which keeps its spelling.
 */
const TRUNK_EIGHT_NATIONAL = /^8(\d{10})$/;
const TRUNK_EIGHT_WRITTEN = /^8[\s(.-]/;
const TRUNK_EIGHT_COUNTRY_CODES: ReadonlySet<string> = new Set(['7']);

/**
 * The digits of `phone`, and what each reading of them can be: `international`, digits that carry
 * their country code; `national`, a national number with the country codes it may follow behind
 * (null: any).
 */
function readings(phone: string | null | undefined): {
  international: Set<string>;
  national: Map<string, ReadonlySet<string> | null>;
} {
  const raw = (phone ?? '').trim();
  const international = new Set<string>();
  const national = new Map<string, ReadonlySet<string> | null>();
  const addNational = (n: string, codes: ReadonlySet<string> | null) => {
    if (national.get(n) !== null) national.set(n, codes);
  };
  // As written, and with a parenthesised trunk 0 dropped, as it is dialled from abroad.
  for (const spelling of new Set([raw, raw.replace(PARENTHESISED_TRUNK_ZERO, '')])) {
    const digits = spelling.replace(/\D/g, '');
    if (!digits) continue;
    international.add(digits);
    // An international access prefix ('00', NANP '011') in front of a country code.
    for (const access of ['011', '00']) {
      if (digits.startsWith(access) && digits.length > access.length) {
        international.add(digits.slice(access.length));
        break;
      }
    }
    // Written with '+', the digits carry their country code; written without, they may be a
    // national number, kept as written (Italy keeps its leading 0), without a trunk '0', or
    // without country code 7's trunk '8' where it is written as one.
    if (!raw.includes('+')) {
      addNational(digits, null);
      if (/^0[1-9]/.test(digits)) addNational(digits.slice(1), null);
      const trunkEight = TRUNK_EIGHT_WRITTEN.test(spelling.trim()) ? TRUNK_EIGHT_NATIONAL.exec(digits) : null;
      if (trunkEight) addNational(trunkEight[1], TRUNK_EIGHT_COUNTRY_CODES);
    }
  }
  return { international, national };
}

/**
 * Whether two spellings are one phone number (V1-21b review 9 FB-2). User.phone is free text
 * (BootstrapDto checks IsString and MaxLength(30) only) and a position's contactPhone is stored
 * as normalizePhone leaves it, so '868-555-0122' and '+18685550122' must match: the digits are
 * equal, or one side is a national number (at least MIN_NATIONAL_DIGITS digits, written without
 * '+') that the other's digits end with, behind exactly a country calling code. A shorter local
 * number ('555-0122') or digits behind something other than a country code are no match. A '(0)'
 * after the country code and country code 7's trunk '8', written apart from the number, are read
 * as trunk prefixes (V1-21c FB2-PLUS0): '+44 (0) 7700 900123' is '+447700900123',
 * '8 (912) 345-67-89' is '+79123456789'; '84951234567' (Vietnam, as Meta writes it) is not
 * '+74951234567' (V1-21c review CR-1).
 */
export function samePhoneNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = readings(a);
  const rb = readings(b);
  for (const x of ra.international) if (rb.international.has(x)) return true;
  const nationalBehindCode = (nat: ReadonlyMap<string, ReadonlySet<string> | null>, intl: ReadonlySet<string>) => {
    for (const [n, codes] of nat) {
      if (n.length < MIN_NATIONAL_DIGITS) continue;
      for (const i of intl) {
        if (i.length <= n.length || !i.endsWith(n)) continue;
        const code = i.slice(0, i.length - n.length);
        if (COUNTRY_CALLING_CODES.has(code) && (codes === null || codes.has(code))) return true;
      }
    }
    return false;
  };
  return nationalBehindCode(ra.national, rb.international) || nationalBehindCode(rb.national, ra.international);
}

/**
 * The membership HTTP reads for the holder of `assignment` in `businessId` (V1-21b review 7
 * INP4-2): ModuleScopeGuard and resolveCrmAccess look it up by (user, business). The row the
 * assignment names is that row when it is in this business; when it is in another, the holder
 * is its user and their row here is looked up (none: no membership, and the holder is capped to
 * nothing). The holder is not known, and no row is read, when the assignment names no
 * membership or names one of a user other than its own userId (the callers then fail closed).
 * Moved here unchanged from StructureService (V1-21b review 9).
 */
export async function holderMembershipHere(
  prisma: PrismaService,
  businessId: string,
  assignment: { userId: string | null; membership: HolderMembershipRow | null },
): Promise<HolderMembershipRow | null> {
  const named = assignment.membership;
  if (!named || named.businessId === businessId) return named;
  if (assignment.userId && assignment.userId !== named.userId) return null;
  return prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: named.userId, businessId } },
    include: { user: { select: HOLDER_ACCOUNT } },
  });
}

/**
 * The memberships of `businessId` whose user's account phone is `phone`, however either is
 * spelled (samePhoneNumber; V1-21b review 7 INP4-3, review 9 FB-2). Every member with a phone is
 * read: a cap on the number of rows could leave the matching one out.
 *
 * Open, an owner decision (V1-21b FB-2 part 2, left documented by V1-21c): the cap follows
 * User.phone as it is now, and a member sets their own User.phone. A member whose narrowed
 * membership caps a contact-only position filed on their number can change their account phone,
 * and the position is then capped by its JobRole alone again.
 */
export async function membersByPhone(prisma: PrismaService, businessId: string, phone: string | null | undefined) {
  if (!phone || !phone.replace(/\D/g, '')) return [];
  const members = await prisma.client.membership.findMany({
    where: { businessId, user: { phone: { not: null } } },
    include: { user: { select: { phone: true, ...HOLDER_ACCOUNT } } },
  });
  return members.filter((m) => samePhoneNumber(m.user?.phone, phone));
}

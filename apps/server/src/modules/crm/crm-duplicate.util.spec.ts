/**
 * FU-PHONE-COUNTRY-DUPLICATES (owner ruling D-211, 'phonecountry': phone duplicates match only
 * within the business's own country code) — the phone duplicate rule of crm-duplicate.util
 * (SWP-CRM-SEARCH) reads a number written without a country code in the business's country only.
 *
 * SWP-CRM-SEARCH read two phone keys as one number by samePhoneNumber
 * (structure/position-holders.ts): the same digits, or a national number of 7+ digits that the
 * other spelling ends with behind ANY country calling code. So in a Trinidad and Tobago business
 * '868-555-0101' (key '8685550101') was '+44 868 555 0101' (a UK number), and a seven-digit local
 * number ('555-0102') was '+592 555 0102' (Guyana). The list search built its extra keys the same
 * way, so a search for the UK or Guyana number found the local customer.
 *
 * The rule now: a key typed with '+' is the number it spells; a key typed without one is read under
 * the business's country (normalizeToE164 under Business.country; unset is Trinidad and Tobago),
 * as WA-E164-SERVER's write paths read a phone. Pure functions, no database: the HTTP proof is
 * apps/server/test/phone-country-duplicates.integration.test.ts.
 *
 * Cases tagged RED-BEFORE fail on the packet's source base (94283786); CONTROL cases pass before
 * and after.
 */
import { describe, it, expect } from 'vitest';
import { contactPhoneKey, phoneSearchKeys, samePhoneKey } from './crm-duplicate.util';

/** Trinidad and Tobago is what an unset Business.country reads as (resolvePhoneCountry). */
const TT = null;

describe('samePhoneKey reads a key typed without a country code in the business country only (D-211)', () => {
  it("RED-BEFORE: '+44 868 555 0101' (UK) is not '868-555-0101' in a Trinidad and Tobago business, in either order", () => {
    expect(samePhoneKey('8685550101', '+448685550101', TT)).toBe(false);
    expect(samePhoneKey('+448685550101', '8685550101', TT)).toBe(false);
    expect(samePhoneKey('8685550101', '448685550101', 'Trinidad and Tobago')).toBe(false);
  });

  it("RED-BEFORE: a seven-digit local number ('555-0102') is not the same digits behind another country's code ('+592 555 0102', '+44 555 0102')", () => {
    expect(samePhoneKey('5550102', '+5925550102', TT)).toBe(false);
    expect(samePhoneKey('+5925550102', '5550102', TT)).toBe(false);
    expect(samePhoneKey('5550102', '+445550102', TT)).toBe(false);
  });

  it("RED-BEFORE: under the business's own country a local key is the number: '868-555-0101', '1 868 555 0101' and the seven-digit '555-0101' are +1 868 555 0101 in Trinidad and Tobago", () => {
    expect(samePhoneKey('8685550101', '+18685550101', TT)).toBe(true);
    expect(samePhoneKey('18685550101', '+18685550101', TT)).toBe(true);
    expect(samePhoneKey('5550101', '+18685550101', TT)).toBe(true);
    expect(samePhoneKey('5550101', '8685550101', TT)).toBe(true);
    expect(samePhoneKey('+18685550101', '+18685550101', TT)).toBe(true);
  });

  it("CONTROL: a Guyana business reads its own local numbers behind +592 and not behind +1 868 ('555-0105' is +592 555 0105 there)", () => {
    expect(samePhoneKey('5550105', '+5925550105', 'Guyana')).toBe(true);
    expect(samePhoneKey('5550105', '+18685550105', 'Guyana')).toBe(false);
  });

  it("RED-BEFORE: a key that does not read (too short, or a local number under a country with no rules) is only its own key: under 'Atlantis' the local '555-0106' is not '+1 555 0106'", () => {
    expect(samePhoneKey('12345', '12345', TT)).toBe(true);
    expect(samePhoneKey('12345', '+112345', TT)).toBe(false);
    expect(samePhoneKey('5550106', '+15550106', 'Atlantis')).toBe(false);
    expect(samePhoneKey('5550106', '5550106', 'Atlantis')).toBe(true);
    expect(samePhoneKey(null, '5550106', TT)).toBe(false);
  });
});

describe('phoneSearchKeys: a number typed with its country code finds a key stored the national way only under the business country (D-211)', () => {
  it("RED-BEFORE: '+44 868 555 0101' in a Trinidad and Tobago business does not search for the national '8685550101'", () => {
    expect(phoneSearchKeys('+44 868 555 0101', TT)).not.toContain('8685550101');
    expect(phoneSearchKeys('+44 868 555 0101', TT)).toEqual(expect.arrayContaining(['+448685550101', '448685550101']));
  });

  it("RED-BEFORE: '+592 555 0102' in a Trinidad and Tobago business does not search for the seven digits '5550102'", () => {
    expect(phoneSearchKeys('+592 555 0102', TT)).not.toContain('5550102');
  });

  it("CONTROL: '+1 868 555 0101' and '1 868 555 0101' still search for the national '8685550101' in Trinidad and Tobago", () => {
    expect(phoneSearchKeys('+1 868 555 0101', TT)).toContain('8685550101');
    expect(phoneSearchKeys('1 868 555 0101', TT)).toContain('8685550101');
  });

  it("CONTROL: in a Guyana business '+592 555 0105' searches for the local '5550105' (its own country's code)", () => {
    expect(phoneSearchKeys('+592 555 0105', 'Guyana')).toContain('5550105');
  });

  it("CONTROL: digits typed without a country code are searched as typed (any key holding them)", () => {
    expect(phoneSearchKeys('555-01', TT)).toEqual(['55501']);
    expect(phoneSearchKeys('868-555-0101', TT)).toContain('8685550101');
  });
});

describe('contactPhoneKey: the identity key a contact write stores for the phone it stores', () => {
  it("RED-BEFORE (new): digits and '+' of the stored phone; null for a phone with no digit", () => {
    expect(contactPhoneKey('+1 868 555 0101')).toBe('+18685550101');
    expect(contactPhoneKey('+18685550101')).toBe('+18685550101');
    expect(contactPhoneKey('ask at the front desk')).toBeNull();
    expect(contactPhoneKey('')).toBeNull();
    expect(contactPhoneKey(null)).toBeNull();
  });
});

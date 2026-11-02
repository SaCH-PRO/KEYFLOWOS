/**
 * V1-21b review 9 FB-2 — a member is matched to a staff position's phone however either number
 * is spelled.
 *
 * KEY knows a staff sender only by the phone, so a position is capped by the members whose account
 * phone is the position's (review 7 INP4-3), and a contact-only position may not be filed on a
 * member's phone. Both compared every digit, while User.phone is free text (BootstrapDto checks
 * only IsString and MaxLength(30)): '868-555-0122' (8685550122) did not match '+18685550122'
 * (18685550122), so the member's narrowing never reached the position. samePhoneNumber compares
 * the digits, and when one side lacks the country code, its national number against the other's
 * trailing digits, provided what the other has in front of them is a country calling code. An
 * international access prefix ('00', '011') and a national trunk '0' are read as such. A shorter
 * local number is no match. Real-database cases: test/staff-bridge-boundary.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import * as holders from './position-holders';

describe('samePhoneNumber (V1-21b review 9 FB-2)', () => {
  const samePhoneNumber = (holders as Record<string, unknown>).samePhoneNumber as (
    a: string | null | undefined,
    b: string | null | undefined,
  ) => boolean;

  it.each<[string | null | undefined, string | null | undefined, boolean]>([
    ['+18685550122', '+18685550122', true],
    ['+1 (868) 555-0122', '+18685550122', true],
    ['868-555-0122', '+18685550122', true],
    ['(868) 555 0122', '18685550122', true],
    ['whatsapp:+18685550122', '868.555.0122', true],
    ['868-555-0122', '(868) 555 0122', true],
    ['0018685550122', '+18685550122', true],
    ['01118685550122', '+18685550122', true],
    ['07700 900122', '+44 7700 900122', true],
    ['0113 246 0000', '+44 113 246 0000', true],
    ['06 1234 5678', '+39 06 1234 5678', true],
    ['555-0122', '+18685550122', false],
    ['8685550122', '+28685550122', false],
    ['8685550122', '+998685550122', false],
    ['+18685550122', '+18685550123', false],
    ['+44 7700 900122', '+1 7700 900122', false],
    ['+8685550122', '+18685550122', false],
    ['', '+18685550122', false],
    [null, '+18685550122', false],
    [undefined, undefined, false],
  ])('%s ~ %s -> %s', (a, b, same) => {
    expect(samePhoneNumber(a, b)).toBe(same);
    expect(samePhoneNumber(b, a)).toBe(same);
  });
});

/**
 * V1-21c FB2-PLUS0 — the spellings V1-21b's final verification found unmatched.
 *
 * A '(0)' after the country code is the national trunk 0, written for callers at home and dropped
 * when the number is dialled from abroad: '+44 (0) 7700 900123' is '+447700900123'. In Russia and
 * Kazakhstan (country code 7) the national trunk prefix is 8, not 0: '8 (912) 345-67-89' is
 * '+79123456789'. The trunk 8 is read only against country code 7, so a national number that merely
 * begins with 8 (NANP '868-555-0122') is never shortened into another country's number.
 */
describe('samePhoneNumber — a trunk 0 written as (0), and the trunk 8 (V1-21c FB2-PLUS0)', () => {
  const samePhoneNumber = (holders as Record<string, unknown>).samePhoneNumber as (
    a: string | null | undefined,
    b: string | null | undefined,
  ) => boolean;

  it.each<[string, string, boolean]>([
    // the three spellings of the finding
    ['+44 (0) 7700 900123', '+447700900123', true],
    ['+44 (0)20 7946 0958', '+442079460958', true],
    ['8 (912) 345-67-89', '+79123456789', true],
    // the same numbers in their other spellings
    ['+44 (0)20 7946 0958', '020 7946 0958', true],
    ['+44 (0) 7700 900123', '07700 900123', true],
    ['0044 (0) 7700 900123', '+44 7700 900123', true],
    ['+44(0)7700900123', 'whatsapp:+447700900123', true],
    ['8 (912) 345-67-89', '+7 (912) 345-67-89', true],
    ['8 (701) 234 56 78', '+7 701 234 5678', true],
    // different numbers are still refused
    ['+44 (0) 7700 900123', '+447700900124', false],
    ['+44 (0)20 7946 0958', '+442079460959', false],
    ['+44 (0) 7700 900123', '+33 7700 900123', false],
    ['8 (912) 345-67-89', '+79123456780', false],
    // the trunk 8 is country code 7's only
    ['8 (912) 345-67-89', '+19123456789', false],
    ['8 (912) 345-67-89', '+389123456789', false],
    ['868-555-0122', '+33685550122', false],
    ['868-555-0122', '+7685550122', false],
    // only a '(0)' is a trunk 0: other digits in parentheses are part of the number
    ['+44 (1) 7700 900123', '+447700900123', false],
  ])('%s ~ %s -> %s', (a, b, same) => {
    expect(samePhoneNumber(a, b)).toBe(same);
    expect(samePhoneNumber(b, a)).toBe(same);
  });
});

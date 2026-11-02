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

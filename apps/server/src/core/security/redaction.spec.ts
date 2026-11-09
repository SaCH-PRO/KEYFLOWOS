import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deepRedact, safeRedactedSnapshot, SENSITIVE_FIELD_PATTERNS, redactAddresses } from './redaction';

const R = '***REDACTED***';

describe('redaction — previous denylist gap (business-event interceptor)', () => {
  // The interceptor previously used exactly these keys with substring matching.
  const OLD_KEYS = ['password', 'token', 'secret', 'refreshToken', 'accessToken', 'apiKey'];
  const oldRedactMisses = (field: string) =>
    !OLD_KEYS.some((k) => field.toLowerCase().includes(k.toLowerCase()));

  it('documents that the old denylist missed credentials and privateKey', () => {
    // These are the concrete fields (SupplierConnection.credentials, private keys)
    // that the previous policy failed to redact — the reason for centralizing.
    expect(oldRedactMisses('credentials')).toBe(true);
    expect(oldRedactMisses('privateKey')).toBe(true);
    // ...while it did catch the token-family fields:
    expect(oldRedactMisses('gmailAccessToken')).toBe(false);
  });
});

describe('deepRedact — comprehensive sensitive-key policy', () => {
  it('redacts credentials and privateKey (the previous gaps)', () => {
    const out = deepRedact({ credentials: 'blob', privateKey: 'pk', apiKey: 'ak' });
    expect(out).toEqual({ credentials: R, privateKey: R, apiKey: R });
  });

  it('redacts the token family case-insensitively', () => {
    const out = deepRedact({ AccessToken: 'a', refresh_token: 'b', WebhookSecret: 'c', Password: 'd' });
    expect(out).toEqual({ AccessToken: R, refresh_token: R, WebhookSecret: R, Password: R });
  });

  it('redacts secrets nested inside objects', () => {
    const out = deepRedact({ config: { provider: 'plaid', accessToken: 'x', label: 'ok' } });
    expect(out).toEqual({ config: { provider: 'plaid', accessToken: R, label: 'ok' } });
  });

  it('redacts secrets inside arrays of objects', () => {
    const out = deepRedact({ connections: [{ id: '1', token: 'a' }, { id: '2', refreshToken: 'b' }] });
    expect(out).toEqual({ connections: [{ id: '1', token: R }, { id: '2', refreshToken: R }] });
  });

  it('redacts a relation-included Business record (14 OAuth token columns)', () => {
    const out = deepRedact({
      after: {
        id: 'biz1',
        name: 'Acme',
        business: {
          id: 'biz1',
          gmailAccessToken: 'x',
          calendarRefreshToken: 'y',
          bpAccessToken: 'z',
        },
      },
    }) as any;
    expect(out.after.name).toBe('Acme');
    expect(out.after.business.gmailAccessToken).toBe(R);
    expect(out.after.business.calendarRefreshToken).toBe(R);
    expect(out.after.business.bpAccessToken).toBe(R);
  });

  it('leaves non-sensitive fields untouched', () => {
    const input = { id: 'x', name: 'Bob', amount: 100, tags: ['a', 'b'], nested: { city: 'PoS' } };
    expect(deepRedact(structuredClone(input))).toEqual(input);
  });

  it('does not over-match ordinary key-like words', () => {
    const input = { monkey: 'ok', keyword: 'ok', publicKeyId: 'ok-not-secret' };
    // "publicKeyId" contains no sensitive pattern (no bare "key" pattern exists).
    expect(deepRedact(structuredClone(input))).toEqual(input);
  });

  it('policy does not include a bare "key" pattern (avoids false positives)', () => {
    expect((SENSITIVE_FIELD_PATTERNS as readonly string[]).includes('key')).toBe(false);
  });
});

describe('safeRedactedSnapshot', () => {
  it('returns undefined for non-object input', () => {
    expect(safeRedactedSnapshot(null)).toBeUndefined();
    expect(safeRedactedSnapshot('str')).toBeUndefined();
    expect(safeRedactedSnapshot(42)).toBeUndefined();
  });

  it('clones (does not mutate the original) and redacts', () => {
    const original = { accessToken: 'secret', name: 'keep' };
    const snap = safeRedactedSnapshot(original);
    expect(snap).toEqual({ accessToken: R, name: 'keep' });
    expect(original.accessToken).toBe('secret'); // original untouched
  });
});

/**
 * W4-HOUSEKEEPING (9B-D2: a sender's log line carries no recipient address).
 * SystemEmailService kept the address pattern in a private redactAddresses,
 * and W3-C2b-EMAIL-LOG-LEAK repeated it in TransactionalEmailService because
 * that file was outside its write set. Both senders now import the one helper
 * from this module. BEFORE_PATTERN is the literal both files carried before
 * the move: every input below redacts exactly as it did, and neither sender
 * keeps its own copy.
 */
describe('redactAddresses: the one address redactor both email senders log through (9B-D2, W4-HOUSEKEEPING)', () => {
  const BEFORE_PATTERN = /[^\s<>"'`(),;:[\]]+@[^\s<>"'`(),;:[\]]+/g;
  const CASES: Array<[string, string]> = [
    ['Resend rejected owner@example.test', 'Resend rejected <address>'],
    ['gmail 503 for owner@example.test', 'gmail 503 for <address>'],
    ['To: "Owner" <owner@example.test>, cc: second+tag@sub.example.test;', 'To: "Owner" <<address>>, cc: <address>;'],
    ['mailto:owner@example.test', 'mailto:<address>'],
    ["(owner@example.test) [team@example.test] 'a@b.example' `c@d.example`", "(<address>) [<address>] '<address>' `<address>`"],
    ['x@y@z', '<address>'],
    ['first@one.test\nsecond@two.test', '<address>\n<address>'],
    ['no address here', 'no address here'],
    ['@handle and user@ alone', '@handle and user@ alone'],
    ['V40A template stand-in has no invoice for owner@example.test', 'V40A template stand-in has no invoice for <address>'],
  ];

  it('9B-D2 W4-HOUSEKEEPING: every address-shaped token becomes <address>, and the rest of the text stays', () => {
    for (const [input, expected] of CASES) expect(redactAddresses(input), JSON.stringify(input)).toBe(expected);
  });

  it('9B-D2 W4-HOUSEKEEPING: the same inputs redact as under the pattern both senders carried before the move, call after call', () => {
    for (let round = 0; round < 2; round++) {
      for (const [input] of CASES) {
        expect(redactAddresses(input), JSON.stringify(input)).toBe(input.replace(BEFORE_PATTERN, '<address>'));
      }
    }
  });

  it('9B-D2 W4-HOUSEKEEPING: SystemEmailService and TransactionalEmailService both import it and keep no copy of the pattern', () => {
    const notifications = path.resolve(__dirname, '../../modules/notifications');
    for (const file of ['system-email.service.ts', 'transactional-email.service.ts']) {
      const src = readFileSync(path.join(notifications, file), 'utf8');
      expect(src, `${file} imports redactAddresses from core/security/redaction`).toMatch(
        /import\s*\{[^}]*\bredactAddresses\b[^}]*\}\s*from\s*'\.\.\/\.\.\/core\/security\/redaction'/,
      );
      expect(src.includes(BEFORE_PATTERN.source), `${file} carries no copy of the address pattern`).toBe(false);
      expect(src, `${file} defines no local redactAddresses`).not.toMatch(/function\s+redactAddresses\b/);
    }
  });
});

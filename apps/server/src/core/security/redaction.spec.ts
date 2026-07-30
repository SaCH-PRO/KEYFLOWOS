import { describe, it, expect } from 'vitest';
import { deepRedact, safeRedactedSnapshot, SENSITIVE_FIELD_PATTERNS } from './redaction';

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

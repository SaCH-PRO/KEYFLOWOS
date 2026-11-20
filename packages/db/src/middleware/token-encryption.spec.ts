/**
 * First tests this package has ever had.
 *
 * Why that matters: architecture/VERIFIED_STATE_2026-08-11.md records that the
 * tRPC social.listConnections token disclosure survived precisely because
 * "packages/* has no test script at all, so nothing said so." This file covers
 * the encryption layer that guards every stored OAuth token.
 *
 * One test below PINS a known defect rather than fixing it: packages/db is
 * the only enc:v1: implementation with NO production guard — with no key env
 * set it silently derives from a literal in this repository. Adding the throw
 * turns a silent weakness into a failed boot, so it needs a deploy that sets
 * the key first (a recorded decision, see the snapshot § "One enc:v1: marker,
 * four key schedules"). The pin means the day someone adds the guard, this
 * test fails and the flip is a visible, deliberate diff — not a silent
 * behavior change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as tokenEncryption from './token-encryption';
import { encryptToken, decryptToken } from './token-encryption';

const KEY_VARS = ['CONNECTOR_CREDENTIALS_KEY', 'CREDENTIALS_ENCRYPTION_KEY', 'JWT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of [...KEY_VARS, 'NODE_ENV']) saved[v] = process.env[v];
  for (const v of KEY_VARS) delete process.env[v];
});

afterEach(() => {
  for (const v of [...KEY_VARS, 'NODE_ENV']) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('encryptToken / decryptToken', () => {
  it('roundtrips under an explicit key and stamps the enc:v1: prefix', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = 'test-key-a';
    const ct = encryptToken('ya29.a0-super-secret');
    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain('super-secret');
    expect(decryptToken(ct)).toBe('ya29.a0-super-secret');
  });

  it('never double-encrypts: an enc:v1: value passes through unchanged', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = 'test-key-a';
    const once = encryptToken('secret')!;
    expect(encryptToken(once)).toBe(once);
  });

  it('handles null/undefined/empty without inventing values', () => {
    expect(encryptToken(null)).toBeNull();
    expect(encryptToken(undefined)).toBeNull();
    expect(decryptToken(null)).toBeNull();
    // A non-prefixed value is passed through, not treated as ciphertext —
    // this is what makes the extension safe on legacy plaintext rows.
    expect(decryptToken('plain-legacy-token')).toBe('plain-legacy-token');
  });

  it('GCM catches tampering: a flipped ciphertext byte throws, never returns garbage', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = 'test-key-a';
    const ct = encryptToken('secret')!;
    const raw = Buffer.from(ct.slice('enc:v1:'.length), 'base64');
    raw[raw.length - 1] ^= 0xff;
    const tampered = 'enc:v1:' + raw.toString('base64');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('a value encrypted under one key does not decrypt under another (attribution smoke)', () => {
    // The snapshot's warning made executable: one enc:v1: marker over multiple
    // key schedules means a ciphertext cannot name its key. The failure mode
    // is this exact throw — "Unsupported state or unable to authenticate
    // data" — which names neither the salt nor the file. If key rotation ever
    // half-lands, this is what production reads look like.
    process.env.CONNECTOR_CREDENTIALS_KEY = 'test-key-a';
    const ct = encryptToken('secret')!;
    process.env.CONNECTOR_CREDENTIALS_KEY = 'test-key-b';
    expect(() => decryptToken(ct)).toThrow();
  });

  it('the key chain is honored in order: CONNECTOR_CREDENTIALS_KEY wins over JWT_SECRET', () => {
    process.env.JWT_SECRET = 'jwt-secret';
    const underJwt = encryptToken('secret')!;
    process.env.CONNECTOR_CREDENTIALS_KEY = 'connector-key';
    // Now the primary is set; the JWT-derived ciphertext must no longer decrypt.
    expect(() => decryptToken(underJwt)).toThrow();
    delete process.env.CONNECTOR_CREDENTIALS_KEY;
    expect(decryptToken(underJwt)).toBe('secret');
  });

  it('PINNED DEFECT: with no key set, production mode still encrypts under the in-repo dev literal', () => {
    // The other four enc:v1: implementations refuse to start without a key;
    // this one scrypts 'dev-only-local-key-not-for-production'. DO NOT "fix"
    // this test by adding the throw casually: any production row already
    // encrypted under the fallback becomes undecryptable the moment the guard
    // lands. Sequence first: set the key in prod, verify no fallback
    // ciphertext exists, then add the guard and flip this assertion.
    process.env.NODE_ENV = 'production';
    const ct = encryptToken('secret');
    expect(ct).toMatch(/^enc:v1:/);
    expect(decryptToken(ct)).toBe('secret');
  });
});

/**
 * FU-DELIVERY-TOKEN-DECRYPT (V1-71). The extension decrypts only the top-level rows of a query on an encrypted model;
 * a row read as a nested include/select of another query keeps the stored ciphertext. decryptNestedRecord is the
 * decrypt step for such a row: the extension's own field map and key, so a nested row reads as a top-level one does.
 */
describe('decryptNestedRecord: the decrypt step for a nested row', () => {
  const { decryptNestedRecord, ENCRYPTED_FIELDS } = tokenEncryption as unknown as {
    decryptNestedRecord: <T>(model: string, row: T) => T;
    ENCRYPTED_FIELDS: Record<string, readonly string[]>;
  };
  const key = () => ['nested', 'row', 'key'].join('-');

  it('the field map names the four encrypted models and their columns', () => {
    expect(ENCRYPTED_FIELDS).toBeDefined();
    expect(Object.keys(ENCRYPTED_FIELDS).sort()).toEqual(['Business', 'ChannelConnection', 'SocialConnection', 'Webhook']);
    expect(ENCRYPTED_FIELDS.ChannelConnection).toEqual(['token', 'refreshToken']);
    expect(ENCRYPTED_FIELDS.SocialConnection).toEqual(['token', 'refreshToken']);
    expect(ENCRYPTED_FIELDS.Webhook).toEqual(['secret']);
    expect(ENCRYPTED_FIELDS.Business).toContain('gmailAccessToken');
    expect(ENCRYPTED_FIELDS.Business).toContain('calendarRefreshToken');
    expect(ENCRYPTED_FIELDS.Business).toHaveLength(16);
    expect(Object.isFrozen(ENCRYPTED_FIELDS) && Object.isFrozen(ENCRYPTED_FIELDS.ChannelConnection)).toBe(true);
  });

  it('decrypts every encrypted column of a nested ChannelConnection and leaves the rest as read, without changing the row in place', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = key();
    const stored = { id: 'cc_1', provider: 'EMAIL', token: encryptToken('access-1'), refreshToken: encryptToken('refresh-1'), accountEmail: 'a@b.example', providerMeta: { boundBy: 'u1' } };
    const out = decryptNestedRecord('ChannelConnection', stored);
    expect(out).toEqual({ ...stored, token: 'access-1', refreshToken: 'refresh-1' });
    expect(stored.token).toMatch(/^enc:v1:/);
    expect(out).not.toBe(stored);
  });

  it('reads a legacy plaintext value as itself, leaves null and missing columns alone, and maps a list relation row by row', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = key();
    expect(decryptNestedRecord('ChannelConnection', { id: 'x', token: 'legacy-plain', refreshToken: null })).toEqual({ id: 'x', token: 'legacy-plain', refreshToken: null });
    expect(decryptNestedRecord('Webhook', { id: 'w' })).toEqual({ id: 'w' });
    const rows = [{ token: encryptToken('s1') }, { token: encryptToken('s2') }];
    expect(decryptNestedRecord('SocialConnection', rows)).toEqual([{ token: 's1' }, { token: 's2' }]);
    expect(decryptNestedRecord('Business', { gmailAccessToken: encryptToken('g'), name: 'Biz' })).toEqual({ gmailAccessToken: 'g', name: 'Biz' });
  });

  it('passes null and undefined through, and refuses a model outside the field map', () => {
    expect(decryptNestedRecord('ChannelConnection', null)).toBeNull();
    expect(decryptNestedRecord('ChannelConnection', undefined)).toBeUndefined();
    expect(() => decryptNestedRecord('Contact', { token: 'x' })).toThrow(/Contact/);
  });
});

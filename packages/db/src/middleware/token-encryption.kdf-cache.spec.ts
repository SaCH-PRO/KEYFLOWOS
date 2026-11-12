/**
 * The scrypt key derivation runs once per secret, not once per token.
 *
 * getDerivedKey() used to call scryptSync on every encryptToken/decryptToken.
 * scryptSync is synchronous and deliberately slow (about 50-100 ms at Node's
 * default cost on a shared machine), so every OAuth token column read or
 * written blocked the event loop that long. A Business row carries several
 * such columns, which made one profile PATCH plus GET take 3-7 s under load
 * (found when identity-business-config.integration.test.ts R0-09-P12/P13 timed
 * out on the integrated branch).
 *
 * The derived key is a pure function of (secret, salt), so it is cached per
 * secret value. Rotation still works: a different secret derives (and caches)
 * its own key, and a value written under one secret does not open under
 * another.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('crypto')>();
  return { ...real, scryptSync: vi.fn(real.scryptSync) };
});

import * as crypto from 'crypto';
import { encryptToken, decryptToken } from './token-encryption';

const KEY_VARS = ['CONNECTOR_CREDENTIALS_KEY', 'CREDENTIALS_ENCRYPTION_KEY', 'JWT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};
const scrypt = crypto.scryptSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const v of KEY_VARS) saved[v] = process.env[v];
  for (const v of KEY_VARS) delete process.env[v];
  scrypt.mockClear();
});

afterEach(() => {
  for (const v of KEY_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('packages/db token encryption derives each key once', () => {
  it('ten encrypts and ten decrypts under one secret run scrypt at most once', () => {
    process.env.JWT_SECRET = 'kdf-cache-secret-one';
    const blobs = Array.from({ length: 10 }, (_, i) => encryptToken(`token-${i}`));
    blobs.forEach((b, i) => expect(decryptToken(b)).toBe(`token-${i}`));
    expect(scrypt.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('a new secret derives its own key, and a value written under the old one does not open under it', () => {
    process.env.JWT_SECRET = 'kdf-cache-secret-two';
    const underTwo = encryptToken('rotating');
    const callsAfterTwo = scrypt.mock.calls.length;

    process.env.JWT_SECRET = 'kdf-cache-secret-three';
    expect(() => decryptToken(underTwo)).toThrow();
    expect(scrypt.mock.calls.length).toBe(callsAfterTwo + 1);
    expect(decryptToken(encryptToken('fresh'))).toBe('fresh');

    // Switching back reuses the cached key: no further derivation.
    process.env.JWT_SECRET = 'kdf-cache-secret-two';
    const before = scrypt.mock.calls.length;
    expect(decryptToken(underTwo)).toBe('rotating');
    expect(scrypt.mock.calls.length).toBe(before);
  });

  it('the in-repo dev fallback (no key env) is cached too', () => {
    const a = encryptToken('dev-a');
    const b = encryptToken('dev-b');
    expect(decryptToken(a)).toBe('dev-a');
    expect(decryptToken(b)).toBe('dev-b');
    expect(scrypt.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

/**
 * core/crypto derives each key once per secret, not once per token (same
 * defect and fix as packages/db/src/middleware/token-encryption.ts; see
 * token-encryption.kdf-cache.spec.ts there). scryptSync is synchronous, so the
 * uncached version blocked the event loop on every encrypt and decrypt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('crypto')>();
  return { ...real, scryptSync: vi.fn(real.scryptSync) };
});

import { scryptSync } from 'crypto';
import { encryptToken, decryptToken } from './token-crypto';

const KEY_VARS = [
  'CONNECTOR_CREDENTIALS_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
  'DRIVE_TOKEN_ENCRYPTION_SECRET',
  'JWT_SECRET',
] as const;
const saved: Record<string, string | undefined> = {};
const scrypt = scryptSync as unknown as ReturnType<typeof vi.fn>;

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

describe('core/crypto token encryption derives each key once', () => {
  it('ten encrypts and ten decrypts under one secret run scrypt at most once', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = 'core-kdf-cache-one';
    const blobs = Array.from({ length: 10 }, (_, i) => encryptToken(`token-${i}`));
    blobs.forEach((b, i) => expect(decryptToken(b)).toBe(`token-${i}`));
    expect(scrypt.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('rotation still works: a new secret derives its own key and the old ciphertext does not open under it', () => {
    process.env.CONNECTOR_CREDENTIALS_KEY = 'core-kdf-cache-two';
    const underTwo = encryptToken('rotating');
    const callsAfterTwo = scrypt.mock.calls.length;

    process.env.CONNECTOR_CREDENTIALS_KEY = 'core-kdf-cache-three';
    expect(() => decryptToken(underTwo)).toThrow();
    expect(scrypt.mock.calls.length).toBe(callsAfterTwo + 1);

    process.env.CONNECTOR_CREDENTIALS_KEY = 'core-kdf-cache-two';
    const before = scrypt.mock.calls.length;
    expect(decryptToken(underTwo)).toBe('rotating');
    expect(scrypt.mock.calls.length).toBe(before);
  });
});

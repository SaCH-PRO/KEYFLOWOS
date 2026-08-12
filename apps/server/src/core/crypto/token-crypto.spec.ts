/**
 * `enc:v1:` is written by five different implementations with four different key
 * schedules, and nothing on disk says which one produced a given value.
 *
 * Measured across the tree:
 *
 *   file                                    salt                        prod guard
 *   core/crypto/token-crypto.ts             keyflow-token-salt-v1       throws
 *   packages/db .../token-encryption.ts     keyflow-token-salt-v1       NONE
 *   core/connectors/connector-credentials   connector-credentials-salt  throws
 *   modules/supplier/credentials.util.ts    supplier-credentials-salt   throws
 *   packages/api/src/lib/credentials.ts     supplier-credentials-salt   throws
 *
 * Separate salts for separate data is good practice. Separate salts behind ONE
 * version marker is not: a value beginning `enc:v1:` cannot be attributed to the
 * key that made it, so the only thing keeping the scheme working is that each
 * implementation happens to own storage no other one touches. Nobody was
 * asserting that, and it had already been broken once.
 *
 * WHAT THAT LOOKED LIKE. `modules/google-drive/token-crypto.util.ts` used salt
 * `keyflow-drive-token-salt` and encrypted Business.driveAccessToken — a column
 * that packages/db also encrypts, under a different salt, with the same prefix.
 * Verified against the compiled modules: a value written by one and read by the
 * other throws `Unsupported state or unable to authenticate data`, which names
 * neither the salt nor the file. It was dead code by then — its last importer
 * went in 736bafdf — so it was removed rather than reconciled.
 *
 * A SECOND DIVERGENCE, still present and deliberately left alone. core/crypto
 * and packages/db share salt `keyflow-token-salt-v1` and are meant to agree, but
 * core/crypto reads DRIVE_TOKEN_ENCRYPTION_SECRET and packages/db does not. Set
 * that variable alone and the two derive different keys from the same salt —
 * confirmed by execution. They do not collide today because core/crypto's only
 * caller (whatsapp) encrypts fields inside a JSON blob while the extension
 * handles scalar columns. Removing the variable would fix it, and would also
 * silently change the key wherever it IS the only one set, so it is recorded
 * here rather than changed blind.
 *
 * This spec is structural on purpose. Importing five modules and cross-decrypting
 * would need all of them built, and a stale dist is exactly how this codebase
 * has been fooled before.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { encryptToken, decryptToken } from './token-crypto';

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

/**
 * Every implementation of the `enc:v1:` scheme, with the salt it derives under.
 * Shrink-only in spirit: a new entry means a new key domain sharing the same
 * on-disk marker, which is a decision, not a detail.
 */
const IMPLEMENTATIONS: Record<string, string> = {
  'apps/server/src/core/crypto/token-crypto.ts': 'keyflow-token-salt-v1',
  'packages/db/src/middleware/token-encryption.ts': 'keyflow-token-salt-v1',
  'apps/server/src/core/connectors/connector-credentials.service.ts':
    'connector-credentials-salt',
  'apps/server/src/modules/supplier/credentials.util.ts': 'supplier-credentials-salt',
  'packages/api/src/lib/credentials.ts': 'supplier-credentials-salt',
};

/** Implementations that do NOT refuse to run in production without a real key. */
const NO_PRODUCTION_GUARD = ['packages/db/src/middleware/token-encryption.ts'];

function filesDeclaringThePrefix(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.next', 'coverage'].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith('.ts') && !/\.spec\.ts$/.test(e.name)) {
        if (/const PREFIX = 'enc:v1:'/.test(fs.readFileSync(p, 'utf8'))) {
          found.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    }
  };
  for (const d of ['apps/server/src', 'packages']) walk(path.join(ROOT, d));
  return found.sort();
}

/** The salt passed to scryptSync, read from the source. */
function saltOf(file: string): string | null {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const named = /scryptSync\([^,]+,\s*'([^']+)'/.exec(src);
  if (named) return named[1];
  const viaConst = /const SALT = '([^']+)'/.exec(src);
  return viaConst ? viaConst[1] : null;
}

describe('the enc:v1: scheme', () => {
  it('round-trips, and leaves already-encrypted values alone', () => {
    const secret = 'ya29.a0-an-access-token';
    const ct = encryptToken(secret);

    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain(secret);
    expect(decryptToken(ct)).toBe(secret);

    // Re-encrypting must be a no-op, or a value gets wrapped twice and the
    // second decrypt returns ciphertext that looks like a plausible token.
    expect(encryptToken(ct)).toBe(ct);

    // Two encryptions of the same input must differ — a fresh IV each time.
    expect(encryptToken(secret)).not.toBe(encryptToken(secret));
  });

  it('passes through values that were never encrypted', () => {
    // Rows written before the scheme existed have no prefix and must survive a
    // read rather than throwing or being mangled.
    expect(decryptToken('plain-legacy-value')).toBe('plain-legacy-value');
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
    expect(encryptToken(null)).toBeNull();
    expect(encryptToken('')).toBe('');
  });

  it('refuses to decrypt a tampered payload rather than returning garbage', () => {
    const ct = encryptToken('sensitive')!;
    // Flip a byte in the ciphertext body. GCM must reject it on the auth tag.
    const body = Buffer.from(ct.slice('enc:v1:'.length), 'base64');
    body[body.length - 1] ^= 0xff;
    const tampered = 'enc:v1:' + body.toString('base64');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('every enc:v1: implementation is accounted for, with its salt', () => {
    const found = filesDeclaringThePrefix();
    expect(found.length, 'no implementations found — the walker is broken').toBeGreaterThan(3);

    const unknown = found.filter((f) => !(f in IMPLEMENTATIONS));
    expect(
      unknown,
      'a new implementation of enc:v1: appeared. It shares an on-disk marker ' +
        'with every other one, so a value it writes cannot be told apart from a ' +
        'value it cannot read. Add it here with its salt, and check no other ' +
        'implementation touches the same column.',
    ).toEqual([]);

    const missing = Object.keys(IMPLEMENTATIONS).filter((f) => !found.includes(f));
    expect(missing, 'these are listed but no longer define the prefix — remove them').toEqual([]);
  });

  it('no implementation changes its salt without saying so', () => {
    // Changing a salt is a silent, unrecoverable migration: every value already
    // written becomes undecryptable, and the error names neither the salt nor
    // the file that moved.
    for (const [file, expected] of Object.entries(IMPLEMENTATIONS)) {
      expect(saltOf(file), `${file} derives under an unexpected salt`).toBe(expected);
    }
  });

  it('records which implementations will run in production without a real key', () => {
    const unguarded = Object.keys(IMPLEMENTATIONS).filter(
      (f) => !/NODE_ENV === 'production'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')),
    );

    expect(
      unguarded.sort(),
      'an implementation lost its production guard. Without one, a deployment ' +
        'missing CONNECTOR_CREDENTIALS_KEY / CREDENTIALS_ENCRYPTION_KEY / ' +
        'JWT_SECRET encrypts with a key derived from a constant in this ' +
        'repository, which is not encryption. packages/db is the existing ' +
        'exception and is listed; adding a throw there would turn a silent ' +
        'weakness into a failed boot, so it needs a deploy that sets the key ' +
        'first.',
    ).toEqual(NO_PRODUCTION_GUARD.sort());
  });
});

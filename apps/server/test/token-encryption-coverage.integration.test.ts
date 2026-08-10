/**
 * Which secret columns are encrypted at rest, and which deliberately are not.
 *
 * WHAT WAS LEAKING
 *
 * channel-connection.service.ts:277 and :291 read a SocialConnection and copy
 * `sc.token` / `sc.refreshToken` onto a ChannelConnection. SocialConnection is
 * covered by the token-encryption extension, so that READ decrypted them — and
 * the write then stored the plaintext in a table the extension did not cover.
 *
 * The same secret, encrypted in one table and in cleartext in another, put
 * there by our own sync. A database dump had the tokens regardless of the
 * encryption on the other side.
 *
 * WHY THIS FILE READS THE SCHEMA RATHER THAN LISTING MODELS
 *
 * A hand-written list of "models that hold secrets" is a list that goes stale
 * the next time someone adds a column. This derives the list from
 * schema.prisma, so a new `token` / `secret` / `credentials` column fails the
 * gate until someone decides, in writing, which of the three buckets it is in:
 *
 *   ENCRYPTED       covered by the extension
 *   LOOKUP_KEY      searched by value, so AES with a random IV would break it
 *   HANDLED_ELSEWHERE  encrypted or hashed by its own service
 *
 * The middle bucket is the one worth being explicit about. encryptToken uses
 * AES-256-GCM with a random IV, so the same plaintext yields different
 * ciphertext every time. Encrypting a column that is then queried by equality
 * does not merely fail to help — it breaks the lookup SILENTLY. The row is not
 * found, the customer's link stops working, and nothing logs an error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const schema = readFileSync(join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma'), 'utf8');
const extension = readFileSync(
  join(ROOT, 'packages', 'db', 'src', 'middleware', 'token-encryption.ts'),
  'utf8',
);

/** Columns whose NAME says they hold a secret. */
const SECRET_NAME = /^(token|secret|credentials?|password|apiKey|privateKey|accessKey|clientSecret|refreshToken|webhookSecret|signingKey)/i;

/**
 * Prisma's scalar types, listed explicitly.
 *
 * The obvious discriminator — "a relation has a capitalised type" — is wrong,
 * because every Prisma scalar is capitalised too (String, Json, DateTime). The
 * first version of this used it and excluded every column in the schema, which
 * the vacuity test above caught immediately.
 */
const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes',
]);

function modelsWithSecretColumns(): Array<{ model: string; fields: string[] }> {
  const out: Array<{ model: string; fields: string[] }> = [];
  for (const [, model, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields: string[] = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
      const m = /^(\w+)\s+(\w+)/.exec(t);
      if (m && SECRET_NAME.test(m[1]) && SCALARS.has(m[2])) fields.push(m[1]);
    }
    if (fields.length) out.push({ model, fields });
  }
  return out;
}

/**
 * Searched by value, so it cannot be AES-encrypted with a random IV.
 *
 * Each of these is a bearer link handed to a customer and then looked up with
 * `findUnique({ where: { token } })`. Protecting them needs a hash plus
 * lookup-by-hash plus showing the value once at issue — a schema change, a
 * migration, and a change to how links are issued. ApiKey already does exactly
 * that (`hashedKey` + `prefix`) and is the model to copy.
 */
const LOOKUP_KEY: Record<string, string> = {
  PortalAccess: 'bearer link, findUnique({ where: { token } }) in portal.service.ts',
  PaymentLink: 'bearer link, looked up by token on the public payment page',
  ContactExportJob: 'bearer link, looked up by token on the export download',
};

/** Encrypted or hashed by its own service rather than by the extension. */
const HANDLED_ELSEWHERE: Record<string, string> = {
  SupplierConnection: 'encryptCredentials/decryptCredentials in supplier/credentials.util',
  ConnectorAccount: 'column is refreshTokenEncrypted — already ciphertext by contract',
};

describe('every secret column has a decided home', () => {
  it('the schema scan finds something, or this whole file is vacuous', () => {
    const found = modelsWithSecretColumns();
    expect(
      found.length,
      'no secret-shaped columns were found — the scan broke and this gate now measures nothing',
    ).toBeGreaterThan(5);
  });

  it('no model holding a secret is silently uncovered', () => {
    const covered = (model: string) => {
      // The extension keys its hooks by the Prisma delegate name.
      const delegate = model[0].toLowerCase() + model.slice(1);
      return new RegExp(`^\\s{4}${delegate}: \\{`, 'm').test(extension);
    };

    const undecided = modelsWithSecretColumns()
      .filter(({ model }) => !covered(model) && !LOOKUP_KEY[model] && !HANDLED_ELSEWHERE[model])
      .map(({ model, fields }) => `${model}: ${fields.join(', ')}`);

    expect(
      undecided,
      'these hold secret-shaped columns and are in none of the three buckets. Either add ' +
        'the model to token-encryption.ts, or add it to LOOKUP_KEY / HANDLED_ELSEWHERE here ' +
        'with the reason. Silence is the one option that is not available.',
    ).toEqual([]);
  });

  it('ChannelConnection is encrypted, because our own sync copies decrypted tokens into it', () => {
    expect(extension).toMatch(/^\s{4}channelConnection: \{/m);
    expect(extension).toMatch(/CHANNEL_ENCRYPTED_FIELDS/);
  });

  it('Webhook.secret is encrypted', () => {
    expect(extension).toMatch(/^\s{4}webhook: \{/m);
    expect(extension).toMatch(/WEBHOOK_ENCRYPTED_FIELDS/);
  });

  it('every encrypting model hooks the writes AND the reads', () => {
    // A model hooked on create/update but not findMany stores ciphertext and
    // hands it back as ciphertext — the integration keeps working right up
    // until something tries to USE the token, and then fails at the provider
    // with an auth error that names nothing.
    for (const delegate of ['business', 'socialConnection', 'channelConnection', 'webhook']) {
      const at = extension.indexOf(`    ${delegate}: {`);
      expect(at, `${delegate} is not hooked`).toBeGreaterThan(-1);
      const next = extension.indexOf('\n    },', at);
      const block = extension.slice(at, next);
      for (const op of ['create', 'update', 'findUnique', 'findFirst', 'findMany']) {
        expect(block, `${delegate} does not hook ${op}`).toMatch(
          new RegExp(`async ${op}\\(`),
        );
      }
    }
  });
});

describe('the lookup-key exclusions are real, not an excuse', () => {
  it('each excluded model is genuinely searched by its token', () => {
    // If one of these stops being a lookup key, it should be encrypted like the
    // others rather than staying on an exemption list forever.
    const server = join(__dirname, '..', 'src');
    const { execSync } = require('node:child_process') as typeof import('node:child_process');

    for (const model of Object.keys(LOOKUP_KEY)) {
      const delegate = model[0].toLowerCase() + model.slice(1);
      let hits = '';
      try {
        hits = execSync(
          `grep -rn -A 3 "${delegate}\\.\\(findUnique\\|findFirst\\|updateMany\\)" "${server}" --include=*.ts`,
          { encoding: 'utf8' },
        );
      } catch {
        hits = '';
      }
      expect(
        /where:\s*\{\s*token|token:/.test(hits),
        `${model} is on the lookup-key exemption list but nothing looks it up by token — ` +
          'it should be encrypted instead',
      ).toBe(true);
    }
  });
});

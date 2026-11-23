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
 *   ENCRYPTED          covered by the extension
 *   LOOKUP_KEY         searched by value, so AES with a random IV would break it
 *   HANDLED_ELSEWHERE  encrypted or hashed by its own service
 *   NOT_A_CREDENTIAL   named like a secret, holds none (RR-BANK-TOKEN-ENCRYPT)
 *
 * RR-BANK-TOKEN-ENCRYPT (V1-72): the name scan was anchored on the START of the
 * field name, so BankConnection.accessToken, a bank provider's access token,
 * was never scanned and sat in no bucket while it was stored in plaintext. The
 * scan now also matches a name ENDING in Token or Secret(s), which covers every
 * *AccessToken / *RefreshToken column, and every model that wider scan newly
 * surfaced is classified below with its reason.
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
import * as encryption from '../../../packages/db/src/middleware/token-encryption';

const ROOT = join(__dirname, '..', '..', '..');
const schema = readFileSync(join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma'), 'utf8');
const extension = readFileSync(
  join(ROOT, 'packages', 'db', 'src', 'middleware', 'token-encryption.ts'),
  'utf8',
);

/** Columns whose NAME says they hold a secret. */
const SECRET_NAME =
  /^(token|secret|credentials?|password|apiKey|privateKey|accessKey|clientSecret|refreshToken|webhookSecret|signingKey)|(token|secrets?)$/i;

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
  // RR-BANK-TOKEN-ENCRYPT: surfaced by the suffix scan. Both are bearer links, looked up by value.
  Quote: 'bearer link to the customer quote page, quote.findFirst({ where: { viewToken: token } }) in commerce.service.ts',
  SitePageDraft: 'bearer preview link, sitePageDraft.findUnique({ where: { previewToken: token } }) in presence.service.ts',
};

/** The column each LOOKUP_KEY model is searched by (checked below against a real call site). */
const LOOKUP_FIELD: Record<string, string> = {
  PortalAccess: 'token',
  PaymentLink: 'token',
  ContactExportJob: 'token',
  Quote: 'viewToken',
  SitePageDraft: 'previewToken',
};

/** Encrypted or hashed by its own service rather than by the extension. */
const HANDLED_ELSEWHERE: Record<string, string> = {
  SupplierConnection: 'encryptCredentials/decryptCredentials in supplier/credentials.util',
  ConnectorAccount: 'column is refreshTokenEncrypted — already ciphertext by contract',
};

/**
 * Named like a secret, holds no credential (RR-BANK-TOKEN-ENCRYPT). Each entry says what the column holds, so
 * the day it starts holding a credential the reason is visibly false.
 */
const NOT_A_CREDENTIAL: Record<string, string> = {
  DriveSyncCursor:
    'pageToken is the Google Drive changes-feed page cursor (changes.list startPageToken): it names a position ' +
    'in the feed and grants no access; the OAuth tokens that do are Business.drive*Token, encrypted',
  IntellectualPropertyProfile:
    'tradeSecrets is business text (String[], the trade secrets an IP profile lists), not a credential; ' +
    'rest-scope-census.spec.ts classifies it the same way',
};

/** The extension hooks a model when it has a `    <delegate>: {` block. */
function hooks(extensionText: string, model: string): boolean {
  const delegate = model[0].toLowerCase() + model.slice(1);
  return new RegExp(`^\\s{4}${delegate}: \\{`, 'm').test(extensionText);
}

/** Every secret-shaped model in no bucket, as `Model: field, field`. */
function undecidedModels(extensionText: string): string[] {
  return modelsWithSecretColumns()
    .filter(
      ({ model }) =>
        !hooks(extensionText, model) && !LOOKUP_KEY[model] && !HANDLED_ELSEWHERE[model] && !NOT_A_CREDENTIAL[model],
    )
    .map(({ model, fields }) => `${model}: ${fields.join(', ')}`);
}

/** The extension text with one model's hook block cut out (the negative control). */
function withoutHookBlock(extensionText: string, delegate: string): string {
  const at = extensionText.indexOf(`    ${delegate}: {`);
  if (at < 0) return extensionText;
  const end = extensionText.indexOf('\n    },', at);
  return extensionText.slice(0, at) + extensionText.slice(end + '\n    },'.length);
}

describe('every secret column has a decided home', () => {
  it('the schema scan finds something, or this whole file is vacuous', () => {
    const found = modelsWithSecretColumns();
    expect(
      found.length,
      'no secret-shaped columns were found — the scan broke and this gate now measures nothing',
    ).toBeGreaterThan(5);
  });

  it('no model holding a secret is silently uncovered', () => {
    expect(
      undecidedModels(extension),
      'these hold secret-shaped columns and are in none of the four buckets. Either add ' +
        'the model to token-encryption.ts, or add it to LOOKUP_KEY / HANDLED_ELSEWHERE / NOT_A_CREDENTIAL ' +
        'here with the reason. Silence is the one option that is not available.',
    ).toEqual([]);
  });

  it('[V72S-C1] the scan sees a column whose name ENDS in AccessToken / RefreshToken / Token / Secret', () => {
    for (const name of ['accessToken', 'gmailAccessToken', 'bankRefreshToken', 'pageToken', 'clientSecret', 'tradeSecrets', 'hmacSecret']) {
      expect(SECRET_NAME.test(name), name).toBe(true);
    }
    for (const name of ['promptTokens', 'totalTokens', 'gmailTokenExpiry', 'previewExpiresAt']) {
      expect(SECRET_NAME.test(name), name).toBe(false);
    }
    const bank = modelsWithSecretColumns().find((m) => m.model === 'BankConnection');
    expect(bank?.fields, 'BankConnection.accessToken is scanned').toEqual(['accessToken']);
  });

  it('[V72S-C2] negative control: without its bankConnection hook block the extension leaves BankConnection undecided', () => {
    expect(hooks(extension, 'BankConnection'), 'the extension hooks bankConnection').toBe(true);
    const cut = withoutHookBlock(extension, 'bankConnection');
    expect(hooks(cut, 'BankConnection')).toBe(false);
    expect(undecidedModels(cut)).toEqual(['BankConnection: accessToken']);
  });

  it('[V72S-C3] a hooked model encrypts every secret-shaped column it has, not only some', () => {
    const { ENCRYPTED_FIELDS } = encryption as unknown as { ENCRYPTED_FIELDS: Record<string, readonly string[]> };
    const missing = modelsWithSecretColumns()
      .filter(({ model }) => hooks(extension, model))
      .flatMap(({ model, fields }) => fields.filter((f) => !(ENCRYPTED_FIELDS[model] ?? []).includes(f)).map((f) => `${model}.${f}`));
    expect(missing, 'hooked, but this secret-shaped column is not in ENCRYPTED_FIELDS').toEqual([]);
    expect(ENCRYPTED_FIELDS.BankConnection).toEqual(['accessToken']);
  });

  it('[V72S-C4] every bucket entry names a model the scan finds, in one bucket only', () => {
    const found = new Set(modelsWithSecretColumns().map((m) => m.model));
    const buckets = [LOOKUP_KEY, HANDLED_ELSEWHERE, NOT_A_CREDENTIAL];
    for (const bucket of buckets) {
      for (const model of Object.keys(bucket)) {
        expect(found.has(model), `${model} is in a bucket but the scan finds no secret-shaped column on it`).toBe(true);
        expect(hooks(extension, model), `${model} is in a bucket and also hooked by the extension`).toBe(false);
        expect(buckets.filter((b) => b[model]).length, `${model} is in more than one bucket`).toBe(1);
      }
    }
    expect(Object.keys(LOOKUP_FIELD).sort()).toEqual(Object.keys(LOOKUP_KEY).sort());
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
    for (const delegate of ['business', 'socialConnection', 'channelConnection', 'webhook', 'bankConnection']) {
      const at = extension.indexOf(`    ${delegate}: {`);
      expect(at, `${delegate} is not hooked`).toBeGreaterThan(-1);
      const next = extension.indexOf('\n    },', at);
      const block = extension.slice(at, next);
      for (const op of ['create', 'update', 'upsert', 'findUnique', 'findFirst', 'findMany']) {
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
      const field = LOOKUP_FIELD[model];
      let hits = '';
      try {
        hits = execSync(
          `grep -rn -A 3 "${delegate}\\.\\(findUnique\\|findFirst\\|updateMany\\)" "${server}" --include=*.ts`,
          { encoding: 'utf8' },
        );
      } catch {
        hits = '';
      }
      // `where: { <field> }` or `where: { <field>: <value> }` as the first predicate, the value not null.
      expect(
        new RegExp(`where:\\s*\\{\\s*${field}\\s*(?:[,}]|:\\s*(?!null\\b))`).test(hits),
        `${model} is on the lookup-key exemption list but nothing looks it up by ${field} — ` +
          'it should be encrypted instead',
      ).toBe(true);
    }
  });
});

import { Prisma } from "@prisma/client";
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getCrypto() {
  return crypto;
}

// The precedence chain, named once. getDerivedKey() and any external witness
// (the diagnostics key-source check) must agree on which env var is in force;
// a second hand-written copy of this order silently drifts, and the crypto
// production guard is gated on that witness reading `pass`.
const KEY_ENV_CHAIN = [
  'CONNECTOR_CREDENTIALS_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
  'JWT_SECRET',
] as const;

export type TokenEncryptionKeyVar = (typeof KEY_ENV_CHAIN)[number];

/**
 * Which env var this module's key derivation actually consults right now, or
 * null when none is set (the in-repo dev fallback). Derived from the SAME
 * chain getDerivedKey() uses, so a witness can never name a variable the
 * encryption layer no longer honors.
 */
export function tokenEncryptionKeySource(): TokenEncryptionKeyVar | null {
  return KEY_ENV_CHAIN.find((k) => process.env[k]) ?? null;
}

// scryptSync is synchronous and deliberately slow; deriving on every token read
// or write blocked the event loop once per OAuth column. The key is a pure
// function of (secret, salt), so it is derived once per secret value. A rotated
// secret is a new cache key, so rotation behaves exactly as before.
const derivedKeys = new Map<string, Buffer>();

function deriveOnce(secret: string): Buffer {
  let key = derivedKeys.get(secret);
  if (!key) {
    const { scryptSync } = getCrypto();
    key = scryptSync(secret, 'keyflow-token-salt-v1', 32);
    derivedKeys.set(secret, key);
  }
  return key;
}

const DEV_FALLBACK_SECRET = 'dev-only-local-key-not-for-production';
const CORE_CHAIN_EXTRA_VAR = 'DRIVE_TOKEN_ENCRYPTION_SECRET';

export type TokenEncryptionKeyLabel =
  | 'plaintext'
  | 'current'
  | 'fallback'
  | 'core-chain'
  | 'undecryptable';

function getDerivedKey(): Buffer {
  const source = tokenEncryptionKeySource();
  const secret = source ? process.env[source] : undefined;
  return deriveOnce(secret || DEV_FALLBACK_SECRET);
}

export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return plaintext ?? null;
  if (plaintext.startsWith(PREFIX)) return plaintext;
  return seal(plaintext);
}

/** AES-256-GCM with a random IV, in the 'enc:v1:' form. Always encrypts: a prefixed input is sealed like any other. */
function seal(plaintext: string): string {
  const { createCipheriv, randomBytes } = getCrypto();
  const key = getDerivedKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;
  const { createDecipheriv } = getCrypto();
  const data = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const key = getDerivedKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function canDecryptPayload(data: Buffer, secret: string): boolean {
  try {
    const { createDecipheriv } = getCrypto();
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const key = deriveOnce(secret);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    decipher.update(encrypted);
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies a stored token column value by which key decrypts it, returning ONLY
 * a label — never a key, secret, or plaintext.
 *
 *   'plaintext'     no enc:v1: prefix
 *   'current'       decrypts under the active packages/db env chain (only when an env var is set)
 *   'fallback'      decrypts under the in-repo dev fallback literal (including when no env var is set)
 *   'core-chain'    decrypts under the core/crypto-only DRIVE_TOKEN_ENCRYPTION_SECRET when it differs
 *   'undecryptable' prefixed payload that does not authenticate under any known key
 */
export function classifyStoredToken(value: string): TokenEncryptionKeyLabel {
  if (!value.startsWith(PREFIX)) return 'plaintext';

  const data = Buffer.from(value.slice(PREFIX.length), 'base64');
  // Minimum valid payload is 16-byte IV + 16-byte GCM auth tag.
  if (data.length < 32) return 'undecryptable';

  const source = tokenEncryptionKeySource();
  const activeSecret = source ? process.env[source] : undefined;
  if (activeSecret && activeSecret !== DEV_FALLBACK_SECRET) {
    if (canDecryptPayload(data, activeSecret)) return 'current';
  }

  if (canDecryptPayload(data, DEV_FALLBACK_SECRET)) return 'fallback';

  const coreExtra = process.env[CORE_CHAIN_EXTRA_VAR];
  if (coreExtra && coreExtra !== activeSecret && coreExtra !== DEV_FALLBACK_SECRET) {
    if (canDecryptPayload(data, coreExtra)) return 'core-chain';
  }

  return 'undecryptable';
}

/**
 * The extension's field map: for each model it hooks, the columns encrypted at rest. The hooks below are built
 * from it, and so is decryptNestedRecord, the decrypt step for a row of one of these models read as a NESTED
 * include or select of another query (which the hooks never see). One list, so a nested row and a top-level row
 * read the same columns as plaintext.
 *
 * Why each model is here is written on its set below.
 */
export const ENCRYPTED_FIELDS = Object.freeze({
  Business: Object.freeze([
    'driveAccessToken',
    'driveRefreshToken',
    'gmailAccessToken',
    'gmailRefreshToken',
    'calendarAccessToken',
    'calendarRefreshToken',
    'formsAccessToken',
    'formsRefreshToken',
    'contactsAccessToken',
    'contactsRefreshToken',
    'contactsSyncToken',
    'msContactsAccessToken',
    'msContactsRefreshToken',
    'msContactsDeltaLink',
    'bpAccessToken',
    'bpRefreshToken',
  ] as const),
  SocialConnection: Object.freeze(['token', 'refreshToken'] as const),
  ChannelConnection: Object.freeze(['token', 'refreshToken'] as const),
  Webhook: Object.freeze(['secret'] as const),
  BankConnection: Object.freeze(['accessToken'] as const),
});

export type EncryptedModel = keyof typeof ENCRYPTED_FIELDS;

// Fields on Business model that should be encrypted at rest
const BUSINESS_ENCRYPTED_FIELDS = new Set<string>(ENCRYPTED_FIELDS.Business);

// Fields on SocialConnection model that should be encrypted at rest
const SOCIAL_ENCRYPTED_FIELDS = new Set<string>(ENCRYPTED_FIELDS.SocialConnection);

/**
 * Fields on ChannelConnection that should be encrypted at rest.
 *
 * WHY THIS WAS ADDED, AND WHAT IT WAS LEAKING
 *
 * channel-connection.service.ts:277 and :291 read a SocialConnection and copy
 * `sc.token` and `sc.refreshToken` onto a ChannelConnection. Those SocialConnection
 * values are encrypted at rest — so the read below DECRYPTED them, and the write
 * then stored the plaintext in a table this extension did not cover.
 *
 * The same secret, protected in one table and in cleartext in another, put there
 * by our own sync. Anyone with a database dump had the tokens regardless of the
 * encryption on the other side.
 *
 * ChannelConnection.token is never a lookup key (measured: zero
 * `findUnique/findFirst ... where: { token }` call sites), which is what makes
 * encrypting it safe — see the note on the bearer-link tokens below.
 */
const CHANNEL_ENCRYPTED_FIELDS = new Set<string>(ENCRYPTED_FIELDS.ChannelConnection);

/**
 * Fields on Webhook that should be encrypted at rest.
 *
 * `secret` is the HMAC signing key for outbound webhook deliveries
 * (webhook-dispatcher.service.ts:265). It is loaded by webhook id and used to
 * sign; it is never itself a lookup key.
 */
const WEBHOOK_ENCRYPTED_FIELDS = new Set<string>(ENCRYPTED_FIELDS.Webhook);

/**
 * Fields on BankConnection that should be encrypted at rest.
 *
 * RR-BANK-TOKEN-ENCRYPT (V1-72; rulings D-261, D-262). `accessToken` is a bank
 * aggregator's access token (plaid, yodlee, salt_edge, open_banking): whoever
 * holds it can read the business's bank account through the provider.
 * BankConnectionService.create / update stored it as given, so the column held
 * plaintext even though the service strips it from every response.
 *
 * It is never a lookup key (measured: no `where` on accessToken anywhere), so
 * AES with a random IV is safe here. A row written before this hook still holds
 * plaintext; decryptToken passes an unprefixed value through, so those rows read
 * correctly until apps/server/scripts/encrypt-bank-connection-tokens.ts --apply
 * rewrites them (owner authority only; dry run by default).
 *
 * Every write seals the value, even one already shaped like ciphertext (see
 * encryptWith). The script writes plaintext only (it skips prefixed rows).
 *
 * delete is deliberately not hooked: its result is the row already gone, and
 * decrypting it would turn the removal of a row that does not decrypt into an
 * error after the commit (COR-V72S-R4-3). Callers discard the deleted token.
 *
 * Unlike the models above, every write and read operation that can carry the
 * column is hooked (createMany, updateMany and their AndReturn forms, the
 * OrThrow reads): a bulk write that named the token would otherwise
 * store plaintext with no error, and an OrThrow read would hand back ciphertext.
 */
const BANK_CONNECTION_ENCRYPTED_FIELDS = new Set<string>(ENCRYPTED_FIELDS.BankConnection);

/**
 * WHAT IS DELIBERATELY NOT ENCRYPTED HERE, AND WHY IT IS NOT AN OVERSIGHT
 *
 * PortalAccess.token, PaymentLink.token and ContactExportJob.token are all
 * looked up BY VALUE — `findUnique({ where: { token } })` — because they are
 * bearer links handed to a customer.
 *
 * encryptToken uses AES-256-GCM with a RANDOM IV, so the same plaintext
 * produces different ciphertext every time. Encrypting a column that is then
 * searched by equality does not merely fail to help; it breaks the lookup
 * silently — the query finds nothing and the customer's link stops working with
 * no error anywhere.
 *
 * Protecting those needs a different control: store a hash, look up by hash,
 * and show the token once at issue. That is a schema change, a migration and a
 * change to how links are issued, so it is not smuggled in here.
 *
 * ApiKey already does exactly that — it stores `hashedKey` and a `prefix`. It is
 * the model to copy when those three are done.
 */

/**
 * Encrypts the named fields of a write's data. `always` (BankConnection) seals every non-empty value, even one
 * already shaped like ciphertext: that model's token comes only from API input, never as a ciphertext copied from
 * another row, and passing a caller's 'enc:v1:...' through stored a value no read could decrypt (SEC-V72S-2).
 */
function encryptWith(fields: Set<string>, data: Record<string, unknown>, always = false): Record<string, unknown> {
  const enc = (v: string) => (always ? (v ? seal(v) : v) : encryptToken(v));
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (!fields.has(key)) continue;
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = enc(value);
    } else if (value && typeof value === 'object' && typeof (value as { set?: unknown }).set === 'string') {
      // Prisma's `{ set: value }` form of a scalar update writes the same column.
      result[key] = { ...(value as object), set: enc((value as { set: string }).set) };
    }
  }
  return result;
}

function decryptWith<T>(fields: Set<string>, data: T): T {
  if (!data || typeof data !== 'object') return data;
  const result = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(result)) {
    if (fields.has(key) && typeof result[key] === 'string') {
      result[key] = decryptToken(result[key] as string);
    }
  }
  return result as T;
}

const FIELD_SETS: Record<EncryptedModel, Set<string>> = {
  Business: BUSINESS_ENCRYPTED_FIELDS,
  SocialConnection: SOCIAL_ENCRYPTED_FIELDS,
  ChannelConnection: CHANNEL_ENCRYPTED_FIELDS,
  Webhook: WEBHOOK_ENCRYPTED_FIELDS,
  BankConnection: BANK_CONNECTION_ENCRYPTED_FIELDS,
};

/**
 * FU-DELIVERY-TOKEN-DECRYPT (V1-71): the decrypt step for a row of an encrypted model read as a NESTED include or
 * select of another query.
 *
 * The hooks below run on queries whose top-level model is encrypted, and decrypt the rows those queries return.
 * A row reached through a relation of another query (`outboundDelivery.findUnique({ include: { destination: {
 * include: { connection: true } } } })`) is never seen by them and comes back with the stored ciphertext:
 * DeliveryQueueService.claimDeliveries put 'enc:v1:...' in the bearer header of every queued Gmail and WhatsApp
 * send that way. A caller that USES such a value passes the nested row here: the same columns and the same key as
 * a top-level read. A list relation is decrypted row by row; null and undefined pass through; the row read is not
 * changed in place. A model outside the field map is refused, so a typo cannot pass a row through undecrypted.
 *
 * The plaintext is for the outbound call or decision that needs it: never put the returned row in a response, a
 * log line or a stored row. apps/server/src/core/prisma/nested-encrypted-reads.spec.ts is the census of the nested
 * reads that need this step.
 */
export function decryptNestedRecord<T>(model: EncryptedModel, record: T): T {
  const fields = FIELD_SETS[model];
  if (!fields) throw new Error(`decryptNestedRecord: ${String(model)} has no encrypted fields in the token-encryption field map`);
  if (Array.isArray(record)) return record.map((row) => decryptWith(fields, row)) as unknown as T;
  return decryptWith(fields, record);
}

function encryptBusinessData(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (BUSINESS_ENCRYPTED_FIELDS.has(key) && typeof result[key] === 'string') {
      result[key] = encryptToken(result[key] as string);
    }
  }
  return result;
}

function decryptBusinessData<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  const result = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(result)) {
    if (BUSINESS_ENCRYPTED_FIELDS.has(key) && typeof result[key] === 'string') {
      result[key] = decryptToken(result[key] as string);
    }
  }
  return result as T;
}

function encryptSocialData(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (SOCIAL_ENCRYPTED_FIELDS.has(key) && typeof result[key] === 'string') {
      result[key] = encryptToken(result[key] as string);
    }
  }
  return result;
}

function decryptSocialData<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  const result = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(result)) {
    if (SOCIAL_ENCRYPTED_FIELDS.has(key) && typeof result[key] === 'string') {
      result[key] = decryptToken(result[key] as string);
    }
  }
  return result as T;
}

export const tokenEncryptionExtension = Prisma.defineExtension({
  query: {
    business: {
      async create({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptBusinessData(args.data as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptBusinessData(result);
      },
      async update({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptBusinessData(args.data as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptBusinessData(result);
      },
      async upsert({ args, query }) {
        if (args.create) {
          args = { ...args, create: encryptBusinessData(args.create as Record<string, unknown>) as any };
        }
        if (args.update) {
          args = { ...args, update: encryptBusinessData(args.update as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptBusinessData(result);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        return decryptBusinessData(result);
      },
      async findFirst({ args, query }) {
        const result = await query(args);
        return decryptBusinessData(result);
      },
      async findMany({ args, query }) {
        const results = await query(args);
        return results.map(decryptBusinessData);
      },
    },
    socialConnection: {
      async create({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptSocialData(args.data as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptSocialData(result);
      },
      async update({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptSocialData(args.data as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptSocialData(result);
      },
      async upsert({ args, query }) {
        if (args.create) {
          args = { ...args, create: encryptSocialData(args.create as Record<string, unknown>) as any };
        }
        if (args.update) {
          args = { ...args, update: encryptSocialData(args.update as Record<string, unknown>) as any };
        }
        const result = await query(args);
        return decryptSocialData(result);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        return decryptSocialData(result);
      },
      async findFirst({ args, query }) {
        const result = await query(args);
        return decryptSocialData(result);
      },
      async findMany({ args, query }) {
        const results = await query(args);
        return results.map(decryptSocialData);
      },
    },
    channelConnection: {
      async create({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(CHANNEL_ENCRYPTED_FIELDS, args.data as Record<string, unknown>) as any };
        }
        return decryptWith(CHANNEL_ENCRYPTED_FIELDS, await query(args));
      },
      async update({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(CHANNEL_ENCRYPTED_FIELDS, args.data as Record<string, unknown>) as any };
        }
        return decryptWith(CHANNEL_ENCRYPTED_FIELDS, await query(args));
      },
      async upsert({ args, query }) {
        if (args.create) {
          args = { ...args, create: encryptWith(CHANNEL_ENCRYPTED_FIELDS, args.create as Record<string, unknown>) as any };
        }
        if (args.update) {
          args = { ...args, update: encryptWith(CHANNEL_ENCRYPTED_FIELDS, args.update as Record<string, unknown>) as any };
        }
        return decryptWith(CHANNEL_ENCRYPTED_FIELDS, await query(args));
      },
      async findUnique({ args, query }) {
        return decryptWith(CHANNEL_ENCRYPTED_FIELDS, await query(args));
      },
      async findFirst({ args, query }) {
        return decryptWith(CHANNEL_ENCRYPTED_FIELDS, await query(args));
      },
      async findMany({ args, query }) {
        const results = await query(args);
        return results.map((r) => decryptWith(CHANNEL_ENCRYPTED_FIELDS, r));
      },
    },
    webhook: {
      async create({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(WEBHOOK_ENCRYPTED_FIELDS, args.data as Record<string, unknown>) as any };
        }
        return decryptWith(WEBHOOK_ENCRYPTED_FIELDS, await query(args));
      },
      async update({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(WEBHOOK_ENCRYPTED_FIELDS, args.data as Record<string, unknown>) as any };
        }
        return decryptWith(WEBHOOK_ENCRYPTED_FIELDS, await query(args));
      },
      async upsert({ args, query }) {
        if (args.create) {
          args = { ...args, create: encryptWith(WEBHOOK_ENCRYPTED_FIELDS, args.create as Record<string, unknown>) as any };
        }
        if (args.update) {
          args = { ...args, update: encryptWith(WEBHOOK_ENCRYPTED_FIELDS, args.update as Record<string, unknown>) as any };
        }
        return decryptWith(WEBHOOK_ENCRYPTED_FIELDS, await query(args));
      },
      async findUnique({ args, query }) {
        return decryptWith(WEBHOOK_ENCRYPTED_FIELDS, await query(args));
      },
      async findFirst({ args, query }) {
        return decryptWith(WEBHOOK_ENCRYPTED_FIELDS, await query(args));
      },
      async findMany({ args, query }) {
        const results = await query(args);
        return results.map((r) => decryptWith(WEBHOOK_ENCRYPTED_FIELDS, r));
      },
    },
    bankConnection: {
      async create({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true) as any };
        }
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async createMany({ args, query }) {
        if (args.data) {
          const data = Array.isArray(args.data)
            ? args.data.map((d) => encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, d as Record<string, unknown>, true))
            : encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true);
          args = { ...args, data: data as any };
        }
        return query(args);
      },
      async update({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true) as any };
        }
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async updateMany({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true) as any };
        }
        return query(args);
      },
      async upsert({ args, query }) {
        if (args.create) {
          args = { ...args, create: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.create as Record<string, unknown>, true) as any };
        }
        if (args.update) {
          args = { ...args, update: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.update as Record<string, unknown>, true) as any };
        }
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async findUnique({ args, query }) {
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async findFirst({ args, query }) {
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async findMany({ args, query }) {
        const results = await query(args);
        return results.map((r) => decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, r));
      },
      async findUniqueOrThrow({ args, query }) {
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async findFirstOrThrow({ args, query }) {
        return decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, await query(args));
      },
      async createManyAndReturn({ args, query }) {
        if (args.data) {
          const data = Array.isArray(args.data)
            ? args.data.map((d) => encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, d as Record<string, unknown>, true))
            : encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true);
          args = { ...args, data: data as any };
        }
        const results = await query(args);
        return results.map((r) => decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, r));
      },
      async updateManyAndReturn({ args, query }) {
        if (args.data) {
          args = { ...args, data: encryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, args.data as Record<string, unknown>, true) as any };
        }
        const results = await query(args);
        return results.map((r) => decryptWith(BANK_CONNECTION_ENCRYPTED_FIELDS, r));
      },
    },
  },
});

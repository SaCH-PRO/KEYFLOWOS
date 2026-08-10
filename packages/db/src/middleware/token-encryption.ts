import { Prisma } from "@prisma/client";
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getCrypto() {
  return crypto;
}

function getDerivedKey(): Buffer {
  const secret =
    process.env.CONNECTOR_CREDENTIALS_KEY ||
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET;
  if (!secret) {
    const { scryptSync } = getCrypto();
    return scryptSync('dev-only-local-key-not-for-production', 'keyflow-token-salt-v1', 32);
  }
  const { scryptSync } = getCrypto();
  return scryptSync(secret, 'keyflow-token-salt-v1', 32);
}

export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return plaintext ?? null;
  if (plaintext.startsWith(PREFIX)) return plaintext;
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

// Fields on Business model that should be encrypted at rest
const BUSINESS_ENCRYPTED_FIELDS = new Set([
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
]);

// Fields on SocialConnection model that should be encrypted at rest
const SOCIAL_ENCRYPTED_FIELDS = new Set([
  'token',
  'refreshToken',
]);

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
const CHANNEL_ENCRYPTED_FIELDS = new Set([
  'token',
  'refreshToken',
]);

/**
 * Fields on Webhook that should be encrypted at rest.
 *
 * `secret` is the HMAC signing key for outbound webhook deliveries
 * (webhook-dispatcher.service.ts:265). It is loaded by webhook id and used to
 * sign; it is never itself a lookup key.
 */
const WEBHOOK_ENCRYPTED_FIELDS = new Set(['secret']);

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

function encryptWith(fields: Set<string>, data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (fields.has(key) && typeof result[key] === 'string') {
      result[key] = encryptToken(result[key] as string);
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
  },
});

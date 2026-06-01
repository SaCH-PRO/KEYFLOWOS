import { Prisma } from "@prisma/client";

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

// Lazy-load crypto to avoid issues in browser/edge environments where this file might be imported
let _crypto: typeof import('crypto') | null = null;
function getCrypto(): typeof import('crypto') {
  if (!_crypto) _crypto = require('crypto');
  return _crypto!;
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
  'bpAccessToken',
  'bpRefreshToken',
]);

// Fields on SocialConnection model that should be encrypted at rest
const SOCIAL_ENCRYPTED_FIELDS = new Set([
  'token',
  'refreshToken',
]);

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
  },
});

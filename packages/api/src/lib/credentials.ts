import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

function getDerivedKey(): Buffer {
  const secret = process.env['CREDENTIALS_ENCRYPTION_KEY'] || process.env['JWT_SECRET'] || 'default-insecure-key-change-in-production';
  return scryptSync(secret, 'supplier-credentials-salt', KEY_LENGTH);
}

export function encryptCredentials(data: Record<string, unknown>): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + combined.toString('base64');
}

export function decryptCredentials(encrypted: string): Record<string, unknown> {
  if (!encrypted || !encrypted.startsWith(PREFIX)) {
    try {
      return typeof encrypted === 'string' ? JSON.parse(encrypted) : {};
    } catch {
      return {};
    }
  }

  const key = getDerivedKey();
  const data = Buffer.from(encrypted.slice(PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

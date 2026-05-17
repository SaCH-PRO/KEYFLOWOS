import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';
const SALT = 'keyflow-drive-token-salt';

function getDerivedKey(): Buffer {
  const secret =
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET ||
    process.env.CONNECTOR_CREDENTIALS_KEY ||
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DRIVE_TOKEN_ENCRYPTION_SECRET or CONNECTOR_CREDENTIALS_KEY or JWT_SECRET must be set in production',
      );
    }
    return scryptSync('dev-only-local-key', SALT, KEY_LENGTH);
  }
  return scryptSync(secret, SALT, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string. Returns a prefixed base64 blob.
 * Safe to store in the database.
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a token. Handles:
 * 1. Properly encrypted tokens (prefixed with enc:v1:)
 * 2. Legacy plaintext tokens (backwards compatible)
 */
export function decryptToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith(PREFIX)) {
    // Legacy plaintext token — return as-is for backwards compatibility
    return ciphertext;
  }
  const data = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const key = getDerivedKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Returns true if the token appears to be encrypted.
 */
export function isTokenEncrypted(ciphertext: string | null | undefined): boolean {
  return !!ciphertext && ciphertext.startsWith(PREFIX);
}

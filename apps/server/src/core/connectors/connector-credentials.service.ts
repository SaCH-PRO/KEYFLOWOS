import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectorCredentialField, ConnectorType } from './connector.interface';

/**
 * Stores per-connector credentials (API keys, access tokens, OAuth tokens, etc.) inside
 * `ConnectorStatus.metadata.encryptedCredentials` using AES-256-GCM. This replaces the legacy
 * pattern of writing plaintext keys onto `Business.metaData`.
 *
 * The plaintext is never returned to clients — only `getMaskedCredentials` is exposed via
 * the API, which returns a "•••• <last4>" preview per secret field. Connectors call
 * `getCredentials` server-side to read the raw values when they need to make API calls.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';
const SALT = 'connector-credentials-salt';

@Injectable()
export class ConnectorCredentialsService {
  private readonly logger = new Logger(ConnectorCredentialsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Encrypt + persist credentials for a connector. Marks the ConnectorStatus row as
   * connected and records the optional `accountLabel` for display in the dashboard.
   */
  async setCredentials(
    businessId: string,
    connectorType: ConnectorType,
    values: Record<string, string>,
    opts: { accountLabel?: string } = {},
  ): Promise<void> {
    const encrypted = encrypt(values);
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType } },
      select: { metadata: true },
    });
    const merged = {
      ...(typeof existing?.metadata === 'object' && existing?.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : {}),
      encryptedCredentials: encrypted,
    };
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType } },
      create: {
        businessId,
        connectorType,
        status: 'connected',
        connectedAt: new Date(),
        connectedAccount: opts.accountLabel ?? null,
        metadata: merged,
      },
      update: {
        status: 'connected',
        connectedAt: new Date(),
        connectedAccount: opts.accountLabel ?? undefined,
        metadata: merged,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
      },
    });
  }

  /**
   * Decrypt and return the stored credentials. Returns `null` if no credentials exist.
   */
  async getCredentials(
    businessId: string,
    connectorType: ConnectorType,
  ): Promise<Record<string, string> | null> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType } },
      select: { metadata: true },
    });
    if (!row?.metadata || typeof row.metadata !== 'object') return null;
    const raw = (row.metadata as Record<string, unknown>).encryptedCredentials;
    if (typeof raw !== 'string' || !raw.length) return null;
    try {
      return decrypt(raw);
    } catch (err: any) {
      this.logger.error(`Failed to decrypt ${connectorType} credentials for ${businessId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Returns a per-field preview suitable for sending back to the browser:
   *  - Secret fields (`secret: true`) are masked: `•••• <last4>` (or empty when not set).
   *  - Non-secret fields are returned as-is so the user can confirm what's stored.
   */
  async getMaskedCredentials(
    businessId: string,
    connectorType: ConnectorType,
    schema: ConnectorCredentialField[],
  ): Promise<Record<string, string>> {
    const stored = (await this.getCredentials(businessId, connectorType)) ?? {};
    const out: Record<string, string> = {};
    for (const field of schema) {
      const raw = stored[field.key];
      if (!raw) {
        out[field.key] = '';
      } else if (field.secret) {
        out[field.key] = raw.length > 4 ? `•••• ${raw.slice(-4)}` : '••••';
      } else {
        out[field.key] = raw;
      }
    }
    return out;
  }

  async hasCredentials(businessId: string, connectorType: ConnectorType): Promise<boolean> {
    const creds = await this.getCredentials(businessId, connectorType);
    if (!creds) return false;
    return Object.values(creds).some((v) => typeof v === 'string' && v.length > 0);
  }

  async clearCredentials(businessId: string, connectorType: ConnectorType): Promise<void> {
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType } },
      select: { metadata: true },
    });
    const meta = (typeof existing?.metadata === 'object' && existing?.metadata !== null
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    delete meta.encryptedCredentials;
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType } },
      create: { businessId, connectorType, status: 'disconnected', metadata: meta },
      update: { status: 'disconnected', metadata: meta, connectedAccount: null, connectedAt: null },
    });
  }

  /**
   * Helper that connectors use to read a single credential value with backwards-compatible
   * fallback to `Business.metaData[<legacyKey>]`. This allows existing dev/test installs
   * (which used the manually-pasted token pattern) to keep working while we migrate.
   */
  async readCredential(
    businessId: string,
    connectorType: ConnectorType,
    key: string,
    legacyMetaKey?: string,
  ): Promise<string | null> {
    const stored = await this.getCredentials(businessId, connectorType);
    const fromStore = stored?.[key];
    if (fromStore) return fromStore;
    if (!legacyMetaKey) return null;
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown> | null) ?? {};
    const legacy = meta[legacyMetaKey];
    return typeof legacy === 'string' && legacy.length ? legacy : null;
  }
}

function getDerivedKey(): Buffer {
  const secret =
    process.env.CONNECTOR_CREDENTIALS_KEY ||
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CONNECTOR_CREDENTIALS_KEY or JWT_SECRET must be set in production');
    }
    return scryptSync('dev-only-local-key', SALT, KEY_LENGTH);
  }
  return scryptSync(secret, SALT, KEY_LENGTH);
}

function encrypt(data: Record<string, unknown>): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload: string): Record<string, string> {
  if (!payload.startsWith(PREFIX)) {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  const data = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const key = getDerivedKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed = JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Connectors Certification — cross-tenant attack suite: credential resolver (REAL database).
 *
 * ConnectorCredentialsService is the central choke point that stores and returns
 * connector credentials (used by connectors and the form webhook). This is the
 * permanent regression harness proving credential resolution is tenant-isolated,
 * encrypted at rest, and masked for display.
 *
 * EXIT CRITERIA (Tenant Isolation / Credential Security — credential resolver path):
 *   [x] Business A cannot obtain Business B's credentials for the same connector type
 *   [x] A missing connector for A returns nothing even when B has that connector
 *   [x] Stored credentials are ciphertext at rest (plaintext secret absent from the row)
 *   [x] Masked display never returns the full secret
 * Nothing on the isolation/crypto boundary is mocked; only sentinel values are used
 * and the secret is never printed.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tcc_';
const SECRET_A = 'whsec_tenantA_do_not_leak';
const SECRET_B = 'whsec_tenantB_do_not_leak';
const ID = { userA: `${P}userA`, userB: `${P}userB`, bizA: `${P}bizA`, bizB: `${P}bizB` };

let db: any;
let svc: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM connector_statuses WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  svc = new ConnectorCredentialsService(new PrismaService() as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });

  // Both businesses connect the SAME connector type with DIFFERENT secrets.
  await svc.setCredentials(ID.bizA, 'typeform', { webhookSecret: SECRET_A });
  await svc.setCredentials(ID.bizB, 'typeform', { webhookSecret: SECRET_B });
  // Only B connects stripe.
  await svc.setCredentials(ID.bizB, 'stripe', { apiKey: 'sk_B_secret' });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('Connector credential resolver — tenant isolation', () => {
  it('returns each business its OWN credentials, never the other tenant\'s', async () => {
    const a = await svc.getCredentials(ID.bizA, 'typeform');
    const b = await svc.getCredentials(ID.bizB, 'typeform');
    expect(a.webhookSecret).toBe(SECRET_A);
    expect(b.webhookSecret).toBe(SECRET_B);
    expect(a.webhookSecret).not.toBe(SECRET_B);
  });

  it('does not surface a connector that only the other business configured', async () => {
    // Business A never connected stripe; B did. A must see nothing.
    expect(await svc.getCredentials(ID.bizA, 'stripe')).toBeNull();
    expect(await svc.hasCredentials(ID.bizA, 'stripe')).toBe(false);
    expect(await svc.hasCredentials(ID.bizB, 'stripe')).toBe(true);
  });
});

describe('Connector credential resolver — credential security', () => {
  it('stores credentials as ciphertext at rest (plaintext secret absent from the row)', async () => {
    const row = await db.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId: ID.bizA, connectorType: 'typeform' } },
      select: { metadata: true },
    });
    const blob = JSON.stringify(row.metadata);
    expect(blob.includes('encryptedCredentials')).toBe(true);
    expect(blob.includes(SECRET_A)).toBe(false); // never stored in plaintext
  });

  it('masked display returns only a masked value, never the full secret', async () => {
    const masked = await svc.getMaskedCredentials(ID.bizA, 'typeform', [
      { key: 'webhookSecret', secret: true },
    ]);
    expect(masked.webhookSecret).not.toBe(SECRET_A);
    expect(masked.webhookSecret.includes(SECRET_A.slice(-4))).toBe(true); // shows last-4 only
    expect(masked.webhookSecret.startsWith('••••')).toBe(true);
  });
});

/**
 * Phase 2 Increment 6 — webhook ingress secret redaction (REAL database).
 *
 * The form-webhook handler authenticates with a per-business webhook secret
 * carried in `x-keyflow-signature`, then logged the request headers verbatim via
 * WebhookIngressLoggerService. On valid requests that header value EQUALS the
 * stored webhookSecret, so the plaintext secret was persisted into the
 * webhook_delivery_logs table.
 *
 * These tests prove sensitive headers are redacted before persistence while
 * non-sensitive headers survive. A sentinel secret is used and never printed.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't6_';
const SECRET = 'whsec_sentinel_do_not_leak';

let db: any;
let logger: any;

async function cleanup() {
  try { await db.$executeRawUnsafe(`DELETE FROM webhook_delivery_logs WHERE business_id LIKE '${P}%'`); } catch { /* best-effort */ }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  logger = new WebhookIngressLoggerService(new PrismaService() as any);
  await cleanup();
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('WebhookIngressLogger redacts sensitive headers before persisting', () => {
  it('does not store the raw x-keyflow-signature value', async () => {
    await logger.log({
      businessId: `${P}bizA`,
      connectorType: 'typeform',
      payload: { ok: true },
      headers: { 'x-keyflow-signature': SECRET, 'content-type': 'application/json' },
      statusCode: 200,
    });
    const row = await db.webhookDeliveryLog.findFirst({ where: { businessId: `${P}bizA` }, orderBy: { createdAt: 'desc' } });
    expect(row).not.toBeNull();
    const headers = row.headers as Record<string, unknown>;
    expect(headers['x-keyflow-signature']).not.toBe(SECRET);
    expect(headers['x-keyflow-signature']).toBe('[REDACTED]');
    // Non-sensitive headers are preserved.
    expect(headers['content-type']).toBe('application/json');
  });

  it('serialized log JSON never contains the secret', async () => {
    const row = await db.webhookDeliveryLog.findFirst({ where: { businessId: `${P}bizA` }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(row).includes(SECRET)).toBe(false);
  });
});
